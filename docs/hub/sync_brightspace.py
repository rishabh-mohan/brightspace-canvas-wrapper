#!/usr/bin/env python3
"""
sync_brightspace.py - run a Brightspace sync from the command line.

Defaults to DRY RUN. Nothing is written unless you pass --live.

The feed URL comes from the BRIGHTSPACE_ICS_URL environment variable (set it
in .env, never on the command line where it lands in shell history). A local
.ics path can be passed instead for testing.

    python3 scripts/sync_brightspace.py --db data/assignments.db
    python3 scripts/sync_brightspace.py --db data/assignments.db --live
    python3 scripts/sync_brightspace.py --db data/assignments.db --feed feed.ics
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import services_brightspace as bs   # noqa: E402

LABELS = {
    "fetched": "events in feed",
    "ignored": "skipped (on ignore list)",
    "informational": "informational, not tracked",
    "stale": "out-of-semester dates refused",
    "known_unchanged": "already correct",
    "due_updated": "deadlines updated from Brightspace",
    "due_blocked_by_override": "blocked by your manual override",
    "auto_joined": "auto-linked to existing assignment",
    "parked_for_review": "sent to Review for your decision",
    "created": "new assignments created",
    "source_missing": "source vanished from feed >24h",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/assignments.db")
    ap.add_argument("--feed", default=None,
                    help="local .ics path; defaults to $BRIGHTSPACE_ICS_URL")
    ap.add_argument("--live", action="store_true",
                    help="actually write changes (default is dry run)")
    a = ap.parse_args()

    source = a.feed or os.environ.get("BRIGHTSPACE_ICS_URL", "").strip()
    if not source:
        sys.exit("No feed. Set BRIGHTSPACE_ICS_URL in .env or pass --feed <file.ics>")

    con = sqlite3.connect(a.db)
    rep = bs.sync(con, source, dry_run=not a.live)
    con.close()

    mode = "LIVE" if a.live else "DRY RUN (nothing written)"
    print(f"Brightspace sync - {mode}\n")
    for key, label in LABELS.items():
        val = getattr(rep, key)
        if val:
            print(f"  {val:>5}  {label}")
    if rep.errors:
        print("\n  errors:")
        for e in rep.errors:
            print(f"    {e}")
    if not a.live:
        print("\nRe-run with --live to apply.")


if __name__ == "__main__":
    main()
