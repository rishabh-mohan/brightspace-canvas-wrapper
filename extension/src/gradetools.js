// Grade tools: plain functions, so tests can run them without a browser.
//   - postedAgo: how long since the newest grade was posted ("Last grade posted N days ago").
//   - the "What do I need?" final-grade solver (letter scales, schemes, solving over data.results).
BSX.gradetools = (() => {
  const DAY = 864e5;

  // ---- last grade posted ------------------------------------------------------
  // Past this many days a course's last grade counts as stale and is emphasised.
  const STALE_DAYS = 14;
  // { days, text, stale, title } for an ISO date, or null without one. Days are whole
  // calendar days in local time, so "today" and "yesterday" follow the clock, not 24-hour spans.
  function postedAgo(iso, now = new Date()) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return null;
    const then = new Date(t);
    const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.max(0, Math.round((start(now) - start(then)) / DAY));
    const text = days === 0 ? 'Last grade posted today' : days === 1 ? 'Last grade posted yesterday' : `Last grade posted ${days} days ago`;
    const title = `Newest grade posted ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    return { days, text, stale: days > STALE_DAYS, title };
  }

  // ---- "What do I need?" solver ----------------------------------------------
  // The score needed on remaining work for a target grade. It is solved numerically over the
  // same estimate the What-If total uses (data.estimate / data.results), so the two always agree.
  const EPS = 1e-9;

  // Whether blank grades count as 0 in the total (and so in the solver): the student's "based
  // only on graded assignments" choice (`option`: true = count blanks, undefined = not chosen),
  // else the course's own setting. Switching What-If on does not change it: as in Canvas, a
  // blank stays out until a score is typed into it (data.estimate counts typed scores anyway).
  const countsBlanks = ({ option, nullIsZero, canEstimate }) => Boolean((option ?? nullIsZero) && canEstimate);

  // Common US cut-offs, highest first, for courses whose scheme is not readable.
  const COMMON_SCALE = [['A+', 97], ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77], ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60], ['F', 0]].map(([symbol, start]) => ({ symbol, start }));
  // A letter grade: A to F with an optional plus or minus (a typographic minus counts too).
  const LETTER = /^[A-F][+\-\u2212\u2013]?$/i;

  // The letter scale to solve against: the course's scheme (data.gradeScheme) when it is a letter
  // scheme, else the common cut-offs. { ranges: [{ symbol, start }] highest first, fromCourse, note }.
  function gradeScale(scheme) {
    const ranges = scheme && Array.isArray(scheme.ranges) ? scheme.ranges.filter((r) => r && Number.isFinite(Number(r.start))) : [];
    if (ranges.length >= 2 && ranges.every((r) => LETTER.test(String(r.symbol).trim()))) {
      const name = String(scheme.name || '').trim();
      return {
        ranges: ranges.map((r) => ({ symbol: String(r.symbol).trim(), start: Number(r.start) })).sort((a, b) => b.start - a.start),
        fromCourse: true,
        note: name ? `Using the course’s grade scheme “${name}”.` : 'Using the course’s grade scheme.',
      };
    }
    return { ranges: COMMON_SCALE.map((r) => ({ ...r })), fromCourse: false, note: 'Using common cut-offs (A 93, A- 90, …); check your syllabus.' };
  }

  // The letter a percent earns on a scale (its lowest letter below every cut-off).
  const letterFor = (percent, ranges) => (ranges.find((r) => percent >= r.start - EPS) || ranges[ranges.length - 1] || {}).symbol || null;

  // A sensible default target: the lowest cut-off above `percent` (the next letter up), or the
  // top one when the percent already clears them all. Only cut-offs above 0 are targets.
  function nextGoal(percent, ranges) {
    const goals = ranges.filter((r) => r.start > 0);
    if (!goals.length) return null;
    if (!Number.isFinite(percent)) return goals[0];
    const above = goals.filter((r) => r.start > percent + EPS);
    return above.length ? above[above.length - 1] : goals[0];
  }

  // Items the solver can aim at: ungraded (no score, none filled in by an outside copy in
  // `filled`), countable (`estimable`, i.e. data.estimable), not bonus, not a category total row.
  // Returns { items: [{ id, name, pp, group }], byId, choices: [{ key, label, ids, what }] }, where a
  // choice is one item, all remaining items in a category (2 or more), or all remaining items.
  function solverTargets(g, { estimable = globalThis.BSX?.data?.estimable, filled = new Map() } = {}) {
    const items = [];
    for (const group of g.groups || []) {
      for (const i of group.items || []) {
        if (i.bonus || i.total || (i.value && i.value.score != null) || filled.has(i.id)) continue;
        if (!estimable || !estimable(g, i)) continue;
        const pp = i.value?.points_possible ?? i.points_possible;
        if (!(pp > 0)) continue;
        items.push({ id: i.id, name: i.name || 'Untitled item', pp, group });
      }
    }
    const choices = [];
    const plural = (n) => `${n} remaining item${n === 1 ? '' : 's'}`;
    const groups = [...new Set(items.map((t) => t.group))];
    if (items.length >= 2 && groups.length >= 2) choices.push({ key: 'all', label: `All remaining ungraded items (${items.length})`, ids: items.map((t) => t.id), what: `all ${plural(items.length)}` });
    for (const group of groups) {
      const mine = items.filter((t) => t.group === group);
      if (mine.length < 2) continue;
      const name = group.name || 'Ungrouped';
      choices.push({ key: `group:${group.id ?? name}`, label: `All remaining in ${name} (${mine.length})`, ids: mine.map((t) => t.id), what: `the ${plural(mine.length)} in ${name}` });
    }
    for (const t of items) choices.push({ key: `item:${t.id}`, label: t.name, ids: [t.id], what: t.name });
    return { items, byId: new Map(items.map((t) => [t.id, t])), choices };
  }

  // The default choice: a single item called "final", else the first choice.
  const defaultChoice = (choices) => choices.find((c) => c.ids.length === 1 && /\bfinal\b/i.test(c.label)) || choices[0] || null;

  // Solve for the fraction f of full marks needed on every target (each gets f × its points) so
  // the estimate reaches `goal` percent. `estimate(overrides)` is the What-If engine (returns
  // { score, points_possible } or null); `base` holds the other overrides (outside scores and
  // What-If scores). Scans in steps, then bisects, so the smallest f that works is found even
  // where drop rules make the total move unevenly.
  // Returns { status: 'guaranteed' | 'reachable' | 'unreachable' | 'none', fraction, over,
  // atZero, atFull, points: [{ id, pp, needed }] }. `over`: the fraction above 1 an unreachable
  // goal would take, when at most `max`.
  function solve({ estimate, targets, goal, base = new Map(), max = 2, step = 0.01 }) {
    const percentAt = (f) => {
      const m = new Map(base);
      for (const t of targets) m.set(t.id, f * t.pp);
      const e = estimate(m);
      return e && e.points_possible > 0 ? (e.score / e.points_possible) * 100 : null;
    };
    const meets = (f) => {
      const p = percentAt(f);
      return p != null && p >= goal - EPS;
    };
    // The smallest f in (lo, hi] that meets the goal, or null.
    const first = (lo, hi) => {
      let prev = lo;
      for (let f = lo + step; f <= hi + EPS; f += step) {
        const at = Math.min(f, hi);
        if (meets(at)) {
          let a = prev, b = at;
          for (let n = 0; n < 60; n++) {
            const mid = (a + b) / 2;
            if (meets(mid)) b = mid;
            else a = mid;
          }
          return b;
        }
        prev = at;
      }
      return null;
    };
    const points = (f) => targets.map((t) => ({ id: t.id, pp: t.pp, needed: f * t.pp }));
    const atZero = targets.length ? percentAt(0) : null;
    const atFull = targets.length ? percentAt(1) : null;
    if (atZero == null || atFull == null || !Number.isFinite(goal)) return { status: 'none', fraction: null, over: null, atZero, atFull, points: [] };
    if (atZero >= goal - EPS) return { status: 'guaranteed', fraction: 0, over: null, atZero, atFull, points: points(0) };
    if (atFull < goal - EPS) {
      const over = max > 1 ? first(1, max) : null;
      return { status: 'unreachable', fraction: null, over, atZero, atFull, points: over != null ? points(over) : [] };
    }
    const f = first(0, 1) ?? 1;
    return { status: 'reachable', fraction: f, over: null, atZero, atFull, points: points(f) };
  }

  // One decimal, rounded up (a needed score) or down (a reached total), so a shown need always
  // suffices and a shown total never overstates.
  const up1 = (n) => Math.ceil(n * 10 - 1e-6) / 10;
  const down1 = (n) => Math.floor(n * 10 + 1e-6) / 10;
  const fmt1 = (n) => String(Math.round(n * 10) / 10);

  // A solve() result in words: { tone: 'ok' | 'need' | 'no', head, lines: [] }. `goalText` names the
  // target ("B (83%)" or "85%"), `what` the remaining work, `targets` its items ({ id, name, pp }).
  function describeSolve(res, { goalText, what, targets = [] }) {
    const single = targets.length === 1 ? targets[0] : null;
    const each = (f) => targets.slice(0, 8).map((t) => `${t.name}: ${fmt1(up1(f * t.pp))} / ${fmt1(t.pp)}`).concat(targets.length > 8 ? [`and ${targets.length - 8} more`] : []);
    if (res.status === 'guaranteed') {
      return { tone: 'ok', head: 'Already guaranteed', lines: [`Even with 0 on ${what}, you’d have ${fmt1(down1(res.atZero))}%, which reaches ${goalText}.`] };
    }
    if (res.status === 'reachable') {
      const f = res.fraction;
      if (single) {
        const pts = up1(f * single.pp);
        return { tone: 'need', head: `${fmt1(pts)} / ${fmt1(single.pp)} (${fmt1(up1((pts / single.pp) * 100))}%)`, lines: [`needed on ${single.name} for ${goalText}.`] };
      }
      return { tone: 'need', head: `An average of ${fmt1(up1(f * 100))}%`, lines: [`on ${what} for ${goalText}.`, ...each(f)] };
    }
    if (res.status === 'unreachable') {
      const lines = [`Even 100% on ${what} gives ${fmt1(down1(res.atFull))}%, short of ${goalText}.`];
      if (res.over != null) lines.push(`It would take ${fmt1(up1(res.over * 100))}% of full marks${single ? ` (${fmt1(up1(res.over * single.pp))} / ${fmt1(single.pp)})` : ' on each'}.`);
      return { tone: 'no', head: 'Not reachable', lines };
    }
    return { tone: 'no', head: 'Can’t work this out', lines: ['There is nothing counted toward a total yet.'] };
  }

  return { STALE_DAYS, postedAgo, countsBlanks, COMMON_SCALE, gradeScale, letterFor, nextGoal, solverTargets, defaultChoice, solve, describeSolve, up1, down1 };
})();
