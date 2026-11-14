"""brightspace.py - Phase 4: Brightspace ICS ingestion and reconciliation.

Implements handoff section 10. The design priorities, in order:

  1. NEVER lose or silently corrupt canonical data. A false merge is worse
     than an unresolved item (handoff 10.4), so ambiguous matches go to
     Review rather than being guessed at.
  2. NEVER let a manual override be overwritten (handoff section 11). If the
     user edited due_at by hand, Brightspace can only raise a review item.
  3. NEVER let an out-of-semester date overwrite a valid 2026 deadline
     (handoff 10.7). The feed is known to contain 2020/2024 junk.
  4. Every change is written to change_history with old and new values.

The Brightspace token is a secret. It is read from the environment and is
never logged, never written to the database, and never included in any
error message: _redact() strips it from anything that could surface.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from icalendar import Calendar
from .course_map import course_for_event
from .titles import canonical_due, explain_match, normalize
from zoneinfo import ZoneInfo

# Canonical timezone (handoff section 32). The feed arrives in UTC.
TZ = ZoneInfo("America/Indiana/Indianapolis")

# Fall 2026. Anything outside this window is treated as copied/stale content
# and is never allowed to overwrite a canonical deadline.
SEMESTER_START = "2026-08-01"
SEMESTER_END = "2026-12-31"

# Confidence thresholds for joining an unknown feed event to an existing
# canonical assignment (handoff 10.3 / 10.4).
AUTO_JOIN_MIN = 92      # >= this: join automatically, log an AUTO_JOINED review
REVIEW_MIN = 70         # >= this but < AUTO_JOIN_MIN: park in Review, do not join
                        # < REVIEW_MIN: treat as a genuinely new item

# A known UID that vanishes from the feed is not deleted. After this long we
# ask the user what to do (handoff 10.6).
SOURCE_MISSING_HOURS = 24

# Summary suffixes Brightspace appends to describe an event's role.
KIND_SUFFIXES = [
    ("- Due", "DUE"),
    ("- Availability Ends", "AVAILABILITY_ENDS"),
    ("- Available", "AVAILABLE"),
]

# Words that make an untagged event actionable anyway (handoff 10.1).
ACTIONABLE_WORDS = re.compile(
    r"\b(assignment|quiz|exam|homework|hw\d|lab|upload|submit|submission|"
    r"survey|reflection|worksheet|project|milestone|paper|draft|report|"
    r"required|attendance)\b", re.I)

# Words that mark an event as informational even if it looks actionable.
INFORMATIONAL_WORDS = re.compile(
    r"\b(callout|open house|seminar|panel|fair|social|club|break|holiday|"
    r"welcome|meeting|office hours|announcement|slides|resource|day at|"
    r"roundtable|night|reception|info session)\b", re.I)


def _redact(text: str) -> str:
    """Strip anything token-shaped out of a string before it is logged."""
    text = re.sub(r"(token=)[^&\s]+", r"\1<redacted>", text, flags=re.I)
    return re.sub(r"https://\S+", "<url redacted>", text)


# ---------------------------------------------------------------------------
# parsing
# ---------------------------------------------------------------------------
@dataclass
class FeedEvent:
    uid: str
    summary: str
    kind: str                  # DUE | AVAILABLE | AVAILABILITY_ENDS | OTHER
    start_at: str | None       # local ISO
    end_at: str | None
    location: str | None
    description: str | None
    raw_hash: str
    in_semester: bool
    actionable: bool

    @property
    def base_title(self) -> str:
        """Summary with the Brightspace role suffix removed."""
        s = self.summary
        for suffix, _ in KIND_SUFFIXES:
            if s.endswith(suffix):
                return s[: -len(suffix)].strip()
        return s.strip()


def classify(summary: str) -> tuple[str, bool]:
    """Return (kind, actionable)."""
    s = (summary or "").strip()
    kind = "OTHER"
    for suffix, k in KIND_SUFFIXES:
        if s.endswith(suffix):
            kind = k
            break

    if kind == "DUE":
        return kind, True
    if kind in ("AVAILABLE", "AVAILABILITY_ENDS"):
        # Lifecycle markers. Useful as source records for an assignment we
        # already know about, but they must never create one on their own.
        return kind, False
    # Untagged: decide on wording. Informational wins ties, because inventing
    # a fake assignment is worse than missing an optional one.
    if INFORMATIONAL_WORDS.search(s):
        return kind, False
    if ACTIONABLE_WORDS.search(s):
        return kind, True
    return kind, False


def _iso(dt) -> str | None:
    """Normalize a feed timestamp to canonical LOCAL time.

    Brightspace publishes DTSTART in UTC (trailing Z). Treating that as local
    silently shifts every deadline by the UTC offset -- 4 hours during EDT --
    which would rewrite the entire semester and bury the review queue. So any
    timezone-aware value is converted to America/Indiana/Indianapolis and then
    written naive, matching how the rest of the database stores time.
    """
    if dt is None:
        return None
    if not hasattr(dt, "strftime"):
        return None
    if getattr(dt, "tzinfo", None) is not None:
        dt = dt.astimezone(TZ).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def same_instant(a: str | None, b: str | None) -> bool:
    """Compare two local ISO timestamps at MINUTE granularity.

    Brightspace ends its deadlines at :59 seconds ("23:59:59") while the
    canonical tracker stores "23:59:00". Those are the same deadline, and
    comparing to the second would report ~137 phantom changes on every sync.
    """
    if a is None or b is None:
        return a == b
    return a[:16] == b[:16]


def parse_feed(ics_bytes: bytes) -> list[FeedEvent]:
    cal = Calendar.from_ical(ics_bytes)
    out: list[FeedEvent] = []
    for ev in cal.walk("VEVENT"):
        uid = str(ev.get("UID") or "").strip()
        if not uid:
            continue
        summary = str(ev.get("SUMMARY") or "").strip()
        start = _iso(ev.get("DTSTART").dt if ev.get("DTSTART") else None)
        end = _iso(ev.get("DTEND").dt if ev.get("DTEND") else None)
        kind, actionable = classify(summary)
        raw = f"{summary}|{start}|{end}"
        out.append(FeedEvent(
            uid=uid,
            summary=summary,
            kind=kind,
            start_at=start,
            end_at=end,
            location=str(ev.get("LOCATION") or "").strip() or None,
            description=str(ev.get("DESCRIPTION") or "").strip() or None,
            raw_hash=hashlib.sha256(raw.encode()).hexdigest()[:16],
            in_semester=bool(start and SEMESTER_START <= start[:10] <= SEMESTER_END),
            actionable=actionable,
        ))
    return out


def fetch(url_or_path: str) -> bytes:
    """Read the feed from a URL or a local file. Errors are redacted so the
    token never reaches a log line or a review-queue row."""
    if url_or_path.startswith(("http://", "https://")):
        try:
            req = urllib.request.Request(
                url_or_path, headers={"User-Agent": "AssignmentHub/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            raise RuntimeError(f"Brightspace fetch failed: {_redact(str(e))}") from None
    with open(url_or_path, "rb") as fh:
        return fh.read()


def score_match(feed_title: str, cand_title: str) -> int:
    return explain_match(feed_title, cand_title)["score"]


# ---------------------------------------------------------------------------
# reconciliation
# ---------------------------------------------------------------------------
@dataclass
class SyncReport:
    fetched: int = 0
    ignored: int = 0
    informational: int = 0
    stale: int = 0
    known_unchanged: int = 0
    due_updated: int = 0
    due_blocked_by_override: int = 0
    auto_joined: int = 0
    parked_for_review: int = 0
    created: int = 0
    source_missing: int = 0
    errors: list = field(default_factory=list)
    weekly: list = field(default_factory=list)      # added by itself (weekly_series)

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["errors"] = list(self.errors)
        d["weekly"] = list(self.weekly)
        return d


def _has_override(con, aid: str, field_name: str) -> bool:
    return con.execute(
        "SELECT 1 FROM manual_overrides WHERE assignment_id=? AND field_name=? AND active=1",
        (aid, field_name)).fetchone() is not None


def _review(con, review_type, aid, uid, confidence, old, new, details, *,
            episode_start: str | None = None) -> None:
    """Raise a review item without nagging.

    * An OPEN item for the same (type, assignment, event) is refreshed in
      place, so it always shows the latest Brightspace value instead of
      whatever it said the first time.
    * A decision you already made is remembered: if you dismissed/resolved the
      same item and nothing has changed since (same new value, or -- for
      SOURCE_MISSING -- the same disappearance episode), it is not re-raised.
      Before this, dismissing "source missing" brought it straight back on the
      next 15-minute sync.
    """
    key = (review_type, aid, uid)
    row = con.execute(
        """SELECT id FROM review_queue WHERE status='OPEN' AND review_type=?
           AND IFNULL(assignment_id,'')=IFNULL(?,'')
           AND IFNULL(source_external_id,'')=IFNULL(?,'')""", key).fetchone()
    if row:
        con.execute(
            """UPDATE review_queue SET new_value=?, details=?,
                   confidence=COALESCE(?, confidence),
                   old_value=COALESCE(old_value, ?)
               WHERE id=?""",
            (new, _redact(details), confidence, old, row[0]))
        return
    if episode_start is not None:
        decided = con.execute(
            """SELECT 1 FROM review_queue WHERE status<>'OPEN' AND review_type=?
               AND IFNULL(assignment_id,'')=IFNULL(?,'')
               AND IFNULL(source_external_id,'')=IFNULL(?,'')
               AND IFNULL(resolved_at,'') >= ?""", key + (episode_start,)).fetchone()
    else:
        decided = con.execute(
            """SELECT 1 FROM review_queue WHERE status<>'OPEN' AND review_type=?
               AND IFNULL(assignment_id,'')=IFNULL(?,'')
               AND IFNULL(source_external_id,'')=IFNULL(?,'')
               AND IFNULL(new_value,'')=IFNULL(?,'')""", key + (new,)).fetchone()
    if decided:
        return
    con.execute(
        """INSERT INTO review_queue
           (review_type, assignment_id, source_type, source_external_id,
            confidence, old_value, new_value, details, status)
           VALUES (?,?,'BRIGHTSPACE',?,?,?,?,?,'OPEN')""",
        (review_type, aid, uid, confidence, old, new, _redact(details)))


def _table_exists(con, name: str) -> bool:
    return con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                       (name,)).fetchone() is not None


def course_rules(con) -> dict[str, str]:
    """course code -> 'review' | 'auto' | 'ignore' for new Brightspace items.
    Courses without a rule use 'review'."""
    if not _table_exists(con, "course_rules"):
        return {}
    return {r[0]: r[1] for r in con.execute("SELECT code, rule FROM course_rules")}


# ---- weekly series ---------------------------------------------------------------
# 10/11, the student: "By now you should be able to notice some things." Every week
# SCI 101 posts "LAB NN : PDF FILE UPLOAD" (it only opens once the .ipynb is
# in), "WEEK NN SURVEYS", "AI SURVEY COMPLETION Quiz NN" and the weekend
# "EXTRA CREDIT : WEEKLY AI USE SURVEY", and every week each one waited in
# Review until they added it by hand -- some after they were due. Two weeks of
# the extra-credit survey were never seen at all: Brightspace posted them
# only as "Availability Ends", which wasn't treated as a deadline.
SERIES_MIN = 2                  # instances they has added before
SERIES_SPREAD = timedelta(days=5)
SERIES_NEAR = timedelta(days=2)
_MONTH_DAY = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b")


# "Section 114 - ICA 3A Dropbox", "Attendance Class 2B - Section 221&222": codes
# are 3 characters ("115", "SC3"), never "Section 5.4".
_SECTION_CODE = r"(?=[A-Z\d]{3}\b)[A-Z]{0,2}\d{1,3}(?!\.\d)"
_SECTIONS = re.compile(rf"\bSections?\s+({_SECTION_CODE}(?:\s*(?:&|,|and)\s*{_SECTION_CODE})*)")


def other_section(con, course: str | None, title: str) -> bool:
    """An event for sections the student isn't in. ENG 110's Brightspace is one
    merged course, so every section's dropboxes reach their feed (11/1: 13 "Section
    112/114/SC3 - ICA" items in the Hub; they's in 115, per their timetable)."""
    m = _SECTIONS.search(title or "")
    if not course or not m:
        return False
    mine = {r[0] for r in con.execute("SELECT s.section FROM class_schedule s JOIN courses c ON c.id=s.course_id "
                                      "WHERE c.code=? AND s.section IS NOT NULL", (course,))}
    return bool(mine) and not mine & set(re.split(r"\s*(?:&|,|and)\s*", m.group(1)))


def series_key(title: str) -> str:
    """'LAB 07 : PDF FILE UPLOAD' -> 'lab # : pdf file upload'."""
    t = _MONTH_DAY.sub("<date>", (title or "").lower())
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", t)).strip()


def _base(summary: str) -> str:
    for suffix, _ in KIND_SUFFIXES:
        if (summary or "").endswith(suffix):
            return summary[: -len(suffix)].strip()
    return (summary or "").strip()


def _clock() -> datetime:
    """Now (tests set it). A past deadline is never added by itself: the first
    sync would otherwise fill the list with weeks long gone."""
    return datetime.now()


def _dt(stamp: str) -> datetime:
    return datetime.fromisoformat(canonical_due(stamp))


def weekly_series(con, course: str, title: str, due: str | None, ignored_keys: set) -> bool:
    """A new instance of something they adds every week: they has added at least
    two before, on different weeks, ignored none, and none is due within two
    days of this one (that would be the same assignment, not a new week).
    Section dropboxes all due on one placeholder date, or attendance events they
    sometimes ignored, don't count."""
    key = series_key(title)
    if not due or not key or key in ignored_keys:
        return False
    try:
        new = datetime.fromisoformat(canonical_due(due))
    except (TypeError, ValueError):
        return False
    dues = []
    for t, d in con.execute("SELECT a.title, a.due_at FROM assignments a JOIN courses c ON c.id=a.course_id "
                            "WHERE c.code=? AND a.archived=0 AND a.due_at IS NOT NULL", (course,)):
        if series_key(t) == key:
            try:
                dues.append(datetime.fromisoformat(d))
            except ValueError:
                continue
    if len(dues) < SERIES_MIN or max(dues) - min(dues) < SERIES_SPREAD:
        return False
    return all(abs(d - new) >= SERIES_NEAR for d in dues)


def _series_note(title: str, opens: str | None) -> str:
    bits = []
    if re.search(r"pdf file upload", title, re.I):
        bits.append("The same file as the .ipynb, uploaded as a PDF. Its dropbox only opens once the .ipynb is in.")
    if opens:
        bits.append(f"Opens {datetime.fromisoformat(opens):%a %b %-d %-I:%M %p}.")
    return " ".join(bits + ["Added by itself: you add this every week."])


def sync(con: sqlite3.Connection, feed_source: str, *, dry_run: bool = True) -> SyncReport:
    rep = SyncReport()
    events = parse_feed(fetch(feed_source))
    rep.fetched = len(events)
    stamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    ignored_uids = {r[0] for r in con.execute(
        "SELECT external_id FROM ignored_events WHERE source_type='BRIGHTSPACE'")}
    known = {r[0]: r[1] for r in con.execute(
        "SELECT external_id, assignment_id FROM assignment_sources "
        "WHERE source_type='BRIGHTSPACE' AND external_id IS NOT NULL AND active=1")}
    # Pairs you said were NOT the same assignment ("Undo" / "Not this one").
    rejected: set[tuple[str, str]] = set()
    if _table_exists(con, "rejected_matches"):
        rejected = {(r[0], r[1]) for r in con.execute(
            "SELECT uid, assignment_id FROM rejected_matches")}
    rejected_uids = {u for u, _ in rejected}
    # A deactivated link stays out of the way (e.g. the seed's parked Industry
    # Night mapping) -- unless it was deactivated by rejecting a match, in
    # which case the event is genuinely unmatched and should be re-considered.
    inactive_uids = {r[0] for r in con.execute(
        "SELECT external_id FROM assignment_sources WHERE source_type='BRIGHTSPACE' "
        "AND external_id IS NOT NULL AND active=0")} - set(known) - rejected_uids
    rules = course_rules(con)

    # Which assignments are already bound to a live Brightspace DUE event.
    # A second, different DUE event joining the same assignment is how
    # "AI TEST PREP PLATFORM : EXAM 1" got merged into the real Exam 1.
    feed_kind = {ev.uid: ev.kind for ev in events}
    live_due: dict[str, set] = {}
    for uid, aid in known.items():
        if feed_kind.get(uid) == "DUE":
            live_due.setdefault(aid, set()).add(uid)

    # weekly series (weekly_series): what they's ignored, which titles have a
    # real "Due" in this feed (its "Availability Ends" twin isn't a second one),
    # and when each one opens
    ignored_keys = {series_key(_base(r[0])) for r in con.execute(
        "SELECT b.summary FROM ignored_events i JOIN brightspace_events b ON b.uid=i.external_id "
        "WHERE i.source_type='BRIGHTSPACE'")}
    due_titles: dict[str, list] = {}
    for ev in events:
        if ev.kind == "DUE" and ev.start_at:
            due_titles.setdefault(normalize(ev.base_title), []).append(_dt(ev.start_at))
    opens_at = {}
    for ev in events:
        if ev.kind == "AVAILABLE" and ev.start_at:
            opens_at.setdefault(normalize(ev.base_title), []).append(ev.start_at)

    seen_uids: set[str] = set()
    # What the mirror already holds: an unchanged event isn't written again.
    # Rewriting all ~140 every sync (only to stamp last_seen_at, which
    # nothing reads) was 16,000 writes and 24 MB of change log a day, and
    # each sync made every page rebuild its plan from scratch.
    mirror = {r[0]: tuple(r)[1:] for r in con.execute(
        "SELECT uid, raw_hash, event_kind, semester_relevant, missing_since FROM brightspace_events")}

    for ev in events:
        seen_uids.add(ev.uid)

        if ev.uid in ignored_uids or ev.uid in inactive_uids:
            rep.ignored += 1
            continue

        # Mirror the raw event regardless of what we do with it, so change
        # detection and audits have something to compare against next run.
        if not dry_run and mirror.get(ev.uid) != (ev.raw_hash, ev.kind, 1 if ev.in_semester else 0, None):
            con.execute(
                """INSERT INTO brightspace_events
                   (uid, summary, description, location, event_kind, start_at, end_at,
                    raw_hash, semester_relevant, actionable_score, last_seen_at, missing_since)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)
                   ON CONFLICT(uid) DO UPDATE SET
                     summary=excluded.summary, start_at=excluded.start_at,
                     end_at=excluded.end_at, raw_hash=excluded.raw_hash,
                     event_kind=excluded.event_kind,
                     description=excluded.description, location=excluded.location,
                     semester_relevant=excluded.semester_relevant,
                     last_seen_at=excluded.last_seen_at, missing_since=NULL""",
                (ev.uid, ev.summary, ev.description, ev.location, ev.kind,
                 ev.start_at, ev.end_at, ev.raw_hash,
                 1 if ev.in_semester else 0, 100 if ev.actionable else 0, stamp))

        aid = known.get(ev.uid)

        # ---------- known UID: possible update ----------
        if aid:
            if ev.kind != "DUE":
                rep.known_unchanged += 1
                continue
            if not ev.in_semester:
                rep.stale += 1
                if not dry_run:
                    _review(con, "STALE_DATE", aid, ev.uid, None, None, ev.start_at,
                            "Feed reports a date outside Fall 2026 for an assignment "
                            "already linked to this course. Not applied.")
                continue

            row = con.execute("SELECT due_at, title, archived FROM assignments WHERE id=?",
                              (aid,)).fetchone()
            if row is None:
                continue
            if row[2]:                     # archived (a dropped class): nothing to ask about
                rep.known_unchanged += 1
                continue
            current_due = row[0]
            if same_instant(current_due, ev.start_at):
                rep.known_unchanged += 1
                continue

            if _has_override(con, aid, "due_at"):
                rep.due_blocked_by_override += 1
                if not dry_run:
                    _review(con, "MANUAL_OVERRIDE_CONFLICT", aid, ev.uid, None,
                            current_due, ev.start_at,
                            "Brightspace moved this deadline, but you set it by hand "
                            "so nothing was changed. Keep yours, or take theirs.")
                continue

            rep.due_updated += 1
            new_due = canonical_due(ev.start_at)
            if not dry_run:
                con.execute(
                    "UPDATE assignments SET due_at=?, due_rule='FIXED', due_text=NULL, "
                    "updated_at=? WHERE id=?",
                    (new_due, stamp, aid))
                con.execute(
                    """INSERT INTO change_history
                       (assignment_id, action, field_name, old_value, new_value, source, metadata)
                       VALUES (?,'UPDATE','due_at',?,?,'BRIGHTSPACE',?)""",
                    (aid, current_due, new_due, json.dumps({"uid": ev.uid})))
                _review(con, "BRIGHTSPACE_CHANGED", aid, ev.uid, None,
                        current_due, new_due,
                        "Brightspace moved this deadline and it was applied automatically.")
            continue

        # ---------- unknown UID ----------
        ends_only = (ev.kind == "AVAILABILITY_ENDS" and ev.start_at is not None
                     and not any(abs(d - _dt(ev.start_at)) < SERIES_NEAR
                                 for d in due_titles.get(normalize(ev.base_title), [])))
        if not ev.actionable and not ends_only:
            rep.informational += 1
            continue

        # Resolve which class this event belongs to from its Brightspace
        # org-unit id. Titles collide across courses ("Week 1 Attendance Quiz"
        # exists in several), so matching without this produced cross-course
        # merges at 100% confidence. When the course is known, ONLY that
        # course's assignments are considered.
        ev_course = course_for_event(ev.description, ev.location)
        rule = rules.get(ev_course or "", "review")
        if rule == "ignore" or other_section(con, ev_course, ev.summary):
            # Your standing decision for this course: never ask. Not written to
            # ignored_events, so switching the rule back brings items back.
            rep.ignored += 1
            continue

        if not ev.in_semester and not ev.actionable:
            rep.informational += 1
            continue
        if not ev.in_semester:
            rep.stale += 1
            if not dry_run:
                _review(con, "SUSPICIOUS_EVENT", None, ev.uid, None, None, ev.start_at,
                        f"New actionable-looking event dated outside Fall 2026: "
                        f"{ev.summary[:70]}. Not added.")
            continue

        if ev_course:
            candidates = con.execute(
                """SELECT a.id, a.title, a.due_at FROM assignments a
                   JOIN courses c ON c.id = a.course_id
                   WHERE a.archived=0 AND c.code = ?""", (ev_course,)).fetchall()
        else:
            candidates = con.execute(
                "SELECT id, title, due_at FROM assignments WHERE archived=0").fetchall()

        best_id, best_title, best_due, best = None, None, None, {"score": 0, "capped": False}
        for cid, ctitle, cdue in candidates:
            if (ev.uid, cid) in rejected:
                continue
            m = explain_match(ev.base_title, ctitle)
            if live_due.get(cid) and ev.kind == "DUE" and m["score"] > 75:
                m = {**m, "score": 75, "capped": True}
            if m["score"] > best["score"]:
                best_id, best_title, best_due, best = cid, ctitle, cdue, m
        best_score = best["score"]

        # Same title AND same due minute inside the same course is a very
        # strong identity signal; nudge it over the auto-join line -- unless a
        # safety cap is what's holding the score down.
        if (best_id and ev_course and ev.start_at and not best["capped"]
                and best_score >= 80 and best_due and same_instant(best_due, ev.start_at)):
            best_score = max(best_score, 95)

        weekly = (bool(ev_course) and bool(ev.start_at) and _dt(ev.start_at) > _clock()
                  and weekly_series(con, ev_course, ev.base_title, ev.start_at, ignored_keys))
        if not ev.actionable and not weekly:
            rep.informational += 1                   # an availability date, nothing they adds
            continue
        same_one = (best_score >= AUTO_JOIN_MIN and best_due and ev.start_at
                    and abs(datetime.fromisoformat(canonical_due(best_due))
                            - datetime.fromisoformat(canonical_due(ev.start_at))) < SERIES_NEAR)
        if weekly and not same_one:
            rep.created += 1
            if not dry_run:
                from . import db as _db
                try:
                    due = canonical_due(ev.start_at)
                    opens = max((o for o in opens_at.get(normalize(ev.base_title), [])
                                 if canonical_due(o) <= due and
                                 datetime.fromisoformat(due) - datetime.fromisoformat(canonical_due(o)) < timedelta(days=9)),
                                default=None)
                    new_id = _db.create_from_feed(con, uid=ev.uid, title=ev.base_title, due=due,
                                                  course_code=ev_course, entry="weekly series", commit=False)
                    con.execute("UPDATE assignments SET notes=? WHERE id=?",
                                (_series_note(ev.base_title, opens), new_id))
                    if re.search(r"pdf file upload", ev.base_title, re.I):
                        con.execute("UPDATE assignments SET effort_minutes=10 WHERE id=?", (new_id,))
                    known[ev.uid] = new_id
                    rep.weekly.append(ev.base_title)
                except ValueError as e:
                    rep.errors.append(_redact(str(e)))
        elif best_score >= AUTO_JOIN_MIN:
            rep.auto_joined += 1
            if not dry_run:
                con.execute(
                    """INSERT OR IGNORE INTO assignment_sources
                       (assignment_id, source_type, external_id, source_title,
                        source_due_at, match_confidence, match_method, active, last_seen_at)
                       VALUES (?,'BRIGHTSPACE',?,?,?,?,'auto title match',1,?)""",
                    (best_id, ev.uid, ev.summary, ev.start_at, best_score, stamp))
                known[ev.uid] = best_id
                if ev.kind == "DUE":
                    live_due.setdefault(best_id, set()).add(ev.uid)
                _review(con, "AUTO_JOINED", best_id, ev.uid, best_score, best_title,
                        ev.summary,
                        "Linked automatically to an existing assignment. Undo if wrong.")
        elif best_score >= REVIEW_MIN:
            rep.parked_for_review += 1
            if not dry_run:
                _review(con, "AMBIGUOUS_MATCH", best_id, ev.uid, best_score,
                        best_title, ev.summary,
                        "Looks similar to an existing assignment but not similar "
                        "enough to link automatically. Your call.")
        else:
            # Genuinely new. Handoff 10.1 says auto-add strongly actionable
            # items, but only DUE events are trustworthy enough for that --
            # and only in a course you've told the hub to auto-add from.
            if ev.kind == "DUE" and rule == "auto" and ev_course:
                rep.created += 1
                if not dry_run:
                    from . import db as _db
                    try:
                        new_id = _db.create_from_feed(
                            con, uid=ev.uid, title=ev.base_title, due=canonical_due(ev.start_at),
                            course_code=ev_course, entry="auto-add rule", commit=False)
                        known[ev.uid] = new_id
                    except ValueError as e:
                        rep.errors.append(_redact(str(e)))
            elif ev.kind == "DUE":
                rep.parked_for_review += 1
                if not dry_run:
                    _review(con, "AMBIGUOUS_MATCH", None, ev.uid, best_score, None,
                            f"{ev.summary} @ {ev.start_at}",
                            "New Brightspace deadline with no match in your tracker. "
                            "Add it as a new assignment, or ignore it.")
            else:
                rep.informational += 1

    # ---------- UIDs that disappeared from the feed ----------
    # Not for archived work or a course they said to ignore (10/11: seven FYE-EYM
    # attendance events -- "they open and close new ones all the time" -- asked
    # to be reviewed after leaving the feed).
    quiet = {r[0] for r in con.execute(
        "SELECT a.id FROM assignments a JOIN courses c ON c.id=a.course_id "
        "LEFT JOIN course_rules r ON r.code=c.code WHERE a.archived=1 OR r.rule='ignore'")}
    for uid, aid in known.items():
        if uid in seen_uids or uid in ignored_uids or aid in quiet:
            continue
        row = con.execute(
            "SELECT missing_since FROM brightspace_events WHERE uid=?", (uid,)).fetchone()
        first_missing = row[0] if row and row[0] else stamp
        if not dry_run and not (row and row[0]):        # first time it's missed only
            con.execute(
                "UPDATE brightspace_events SET missing_since=? WHERE uid=? AND missing_since IS NULL",
                (stamp, uid))
        gone_for = datetime.fromisoformat(stamp) - datetime.fromisoformat(first_missing)
        if gone_for >= timedelta(hours=SOURCE_MISSING_HOURS):
            rep.source_missing += 1
            if not dry_run:
                _review(con, "SOURCE_MISSING", aid, uid, None, None, None,
                        f"This Brightspace event has been gone from the feed for over "
                        f"{SOURCE_MISSING_HOURS}h. The assignment was kept. Keep, archive, "
                        f"or stop tracking the source.",
                        episode_start=first_missing)

    if not dry_run and rep.weekly:
        from . import push
        pdf = [t for t in rep.weekly if re.search(r"pdf file upload", t, re.I)]
        push.queue(con, "Added by itself" if not pdf else "PDF upload is open",
                   ("Upload the same file as a PDF: " + ", ".join(pdf) + ". " if pdf else "")
                   + "On your list now: " + ", ".join(rep.weekly)[:200], url="/work?view=tasks", tag="weekly-series")
    if not dry_run:
        con.execute(
            "INSERT OR REPLACE INTO sync_state (key,value) VALUES ('last_brightspace_sync',?)",
            (stamp,))
        con.execute(
            "INSERT OR REPLACE INTO sync_state (key,value) VALUES ('last_brightspace_result',?)",
            (json.dumps(rep.as_dict()),))
        con.commit()

    return rep
