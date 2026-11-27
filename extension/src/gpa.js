// Semester GPA calculator on the all-courses Grades page: this term's courses, their credit hours
// (typed in and saved, 3 by default), the letter each total points to (or a what-if letter, kept
// in memory only), the term GPA on the standard US 4.0 scale and, from a prior GPA and credit
// hours the student enters, a cumulative GPA. Loads before BSX.ui exists, so the page parts are
// reached inside functions only.
BSX.gpa = (() => {
  // ---- maths (pure) -----------------------------------------------------------
  const LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
  const POINTS = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
  // Common US percentage cut-offs for LETTERS; a course's own syllabus may differ.
  const CUTS = [97, 93, 90, 87, 83, 80, 77, 73, 70, 67, 63, 60, 0];
  const MAX_CREDITS = 30; // per course
  const DEFAULT_CREDITS = 3; // a course the student has typed nothing for

  // "B+", " b + ", "B−" (a typographic minus) -> "B+"; anything else -> null.
  function letter(text) {
    if (typeof text !== 'string') return null;
    const t = text.replace(/\s+/g, '').replace(/[\u2212\u2013\u2014]/g, '-').toUpperCase();
    return Object.prototype.hasOwnProperty.call(POINTS, t) ? t : null;
  }
  const points = (l) => (letter(l) == null ? null : POINTS[letter(l)]);
  // The letter a displayed grade starts with: "A- (91 %)", "B+ 88%", "C" -> "A-", "B+", "C";
  // words such as "Pass" or "Fail" -> null.
  function leadingLetter(text) {
    if (typeof text !== 'string') return null;
    const m = /^\s*([A-F])\s*([+\-\u2212\u2013\u2014]?)(?![A-Za-z])/i.exec(text);
    return m ? letter(m[1] + m[2]) : null;
  }
  // `ranges` (optional): a course's letter scheme, [{ symbol, start }] highest first, used
  // instead of the common cut-offs.
  function letterOfPercent(p, ranges) {
    if (typeof p !== 'number' || !Number.isFinite(p)) return null;
    if (Array.isArray(ranges) && ranges.length) {
      const r = ranges.find((x) => p >= x.start - 1e-9) || ranges[ranges.length - 1];
      if (letter(r.symbol)) return letter(r.symbol);
    }
    return LETTERS[CUTS.findIndex((c) => p >= c)];
  }

  // The letter a course total points to: the final grade (its displayed letter when Brightspace
  // shows one, else its percentage), else the estimate. { letter, percent, from } or null.
  // `ranges`: as letterOfPercent.
  function letterOfTotal(t, ranges) {
    if (!t) return null;
    for (const from of ['final', 'estimate']) {
      const g = t[from];
      if (!g) continue;
      const shown = letter(g.displayed) || leadingLetter(g.displayed);
      const percent = g.score != null && g.points_possible > 0 ? (g.score / g.points_possible) * 100 : null;
      if (shown) return { letter: shown, percent, from };
      if (percent != null && Number.isFinite(percent)) return { letter: letterOfPercent(percent, ranges), percent, from };
    }
    return null;
  }

  // A credit-hour value typed or stored: a number from 0 to 30, else null ('' too).
  function credits(v) {
    if (v == null || (typeof v === 'string' && !v.trim())) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= MAX_CREDITS ? n : null;
  }
  // A course's credit hours from the saved preferences: what was typed, else the default.
  function creditsFor(prefs, id) {
    const v = prefs && prefs.credits ? prefs.credits[id] : undefined;
    return typeof v === 'number' && credits(v) != null ? v : DEFAULT_CREDITS;
  }
  // Saves typed credit hours into prefs.credits: blank is kept as 0 (the course is left out),
  // the default is not stored, and a value that isn't a number from 0 to 30 changes nothing.
  // Returns the hours now in effect, or null for a bad value.
  function setCredits(prefs, id, text) {
    const blank = text == null || (typeof text === 'string' && !text.trim());
    const v = blank ? 0 : credits(text);
    if (v == null) return null;
    if (v === DEFAULT_CREDITS) delete prefs.credits[id];
    else prefs.credits[id] = v;
    return v;
  }

  // Rows { letter, credits } -> the term's figures. Rows without a letter or with no (or 0)
  // credits are left out, with the reason.
  function term(rows) {
    let hours = 0;
    let quality = 0;
    const counted = [];
    const skipped = [];
    for (const r of rows || []) {
      const l = letter(r && r.letter);
      const c = credits(r && r.credits);
      if (l == null) skipped.push({ ...r, why: 'letter' });
      else if (!c) skipped.push({ ...r, why: 'credits' });
      else {
        hours += c;
        quality += POINTS[l] * c;
        counted.push(r);
      }
    }
    return { gpa: hours ? quality / hours : null, credits: hours, points: quality, counted, skipped };
  }

  // A prior GPA (0–4) and its credit hours (0 or more): each checked on its own, so the form can
  // say which one is wrong. Blank is not an error, just missing.
  function prior(gpa, hours) {
    const blank = (v) => v == null || (typeof v === 'string' && !v.trim());
    const g = blank(gpa) ? null : Number(gpa);
    const c = blank(hours) ? null : Number(hours);
    const out = { gpa: null, credits: null, errors: {} };
    if (g != null) Number.isFinite(g) && g >= 0 && g <= 4 ? (out.gpa = g) : (out.errors.gpa = 'GPA must be between 0 and 4.');
    if (c != null) Number.isFinite(c) && c >= 0 && c <= 1000 ? (out.credits = c) : (out.errors.credits = 'Credit hours must be 0 or more.');
    return out;
  }

  // The term's figures combined with prior work: (prior × priorCredits + termPoints) /
  // (priorCredits + termCredits). Without a usable prior, the term GPA; null when nothing counts.
  function cumulative(t, p) {
    const tp = t && Number.isFinite(t.points) ? t.points : 0;
    const tc = t && Number.isFinite(t.credits) ? t.credits : 0;
    const ok = p && typeof p.gpa === 'number' && p.gpa >= 0 && p.gpa <= 4 && typeof p.credits === 'number' && p.credits >= 0;
    const pc = ok ? p.credits : 0;
    const total = pc + tc;
    return total ? ((ok ? p.gpa * pc : 0) + tp) / total : null;
  }

  // The saved preferences, cleaned: { credits: { courseId: hours }, prior: { gpa, credits } }.
  function clean(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const list = s.credits && typeof s.credits === 'object' && !Array.isArray(s.credits) ? Object.entries(s.credits) : [];
    const p = s.prior && typeof s.prior === 'object' ? prior(s.prior.gpa, s.prior.credits) : prior(null, null);
    return { credits: Object.fromEntries(list.filter(([, v]) => typeof v === 'number' && credits(v) != null)), prior: { gpa: p.gpa, credits: p.credits } };
  }

  const fixed = (n, d = 2) => (n == null ? '–' : n.toFixed(d));

  // ---- the panel ----------------------------------------------------------------
  const overrides = new Map(); // course id -> what-if letter ('' = none); this visit only
  let saveTimer = null;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => BSX.ui.saveSettings(), 400);
  };

  function panel(courses, totals) {
    const ui = BSX.ui;
    const { h, settings } = ui;
    const prefs = (settings.gpa = clean(settings.gpa));
    const now = (courses || []).filter((c) => c.current_term === true);
    const list = now.length ? now : courses || [];
    const byId = new Map((totals || []).map((t) => [t.course_id, t]));
    // A course's own letter scheme, only when its Grades page has already read it (no request).
    const D = BSX.data;
    const GT = BSX.gradetools;
    const scaleOf = (t) => {
      const s = t && D && D.knownScheme ? D.knownScheme(t.course_id, t.scheme_id) : null;
      const sc = s && GT && GT.gradeScale ? GT.gradeScale(s) : null;
      return sc && sc.fromCourse ? sc : null;
    };

    const rows = list.map((c) => {
      const total = byId.get(c.id);
      const scale = scaleOf(total);
      const est = letterOfTotal(total, scale && scale.ranges);
      const row = { course: c, est, scale, letter: null, credits: null };
      const sel = h('select', { class: 'txt pick', 'aria-label': `Letter for ${ui.nameOf(c)}` },
        h('option', { value: '' }, '—'), LETTERS.map((l) => h('option', { value: l }, l)));
      const hrs = h('input', { class: 'wi', type: 'number', min: '0', max: String(MAX_CREDITS), step: '0.5', inputmode: 'decimal', 'aria-label': `Credit hours for ${ui.nameOf(c)}` });
      const qp = h('td', { class: 'num' });
      Object.assign(row, { sel, hrs, qp });
      hrs.value = String(creditsFor(prefs, c.id));
      sel.addEventListener('change', () => {
        if (sel.value === (est ? est.letter : '')) overrides.delete(c.id);
        else overrides.set(c.id, sel.value);
        update();
      });
      hrs.addEventListener('input', () => {
        // Part-way through something unparsable ("e"), the field reads '': save nothing yet.
        if (hrs.validity && hrs.validity.badInput) return;
        const v = setCredits(prefs, c.id, hrs.value);
        hrs.setCustomValidity(v == null ? `0 to ${MAX_CREDITS}` : '');
        if (v != null) saveSoon();
        update();
      });
      return row;
    });

    const out = {
      gpa: h('strong', { class: 'gpa-term' }),
      credits: h('span'),
      skipped: h('p', { class: 'muted small' }),
      cum: h('strong', { class: 'gpa-cum' }),
      cumNote: h('span', { class: 'muted small' }),
      errors: h('p', { class: 'small bad', role: 'alert' }),
    };
    const reset = ui.button('Reset to estimates', () => {
      overrides.clear();
      update();
    });
    const pg = h('input', { class: 'wi', type: 'number', min: '0', max: '4', step: '0.01', inputmode: 'decimal', 'aria-label': 'Prior cumulative GPA', value: prefs.prior.gpa != null ? String(prefs.prior.gpa) : null });
    const pc = h('input', { class: 'wi', type: 'number', min: '0', step: '1', inputmode: 'decimal', 'aria-label': 'Prior credit hours', value: prefs.prior.credits != null ? String(prefs.prior.credits) : null });
    const priorInput = () => {
      const p = prior(pg.value, pc.value);
      pg.setCustomValidity(p.errors.gpa || '');
      pc.setCustomValidity(p.errors.credits || '');
      prefs.prior = { gpa: p.gpa, credits: p.credits };
      saveSoon();
      update();
    };
    pg.addEventListener('input', priorInput);
    pc.addEventListener('input', priorInput);

    function update() {
      for (const r of rows) {
        const o = overrides.get(r.course.id);
        r.letter = o !== undefined ? o || null : r.est ? r.est.letter : null;
        if (r.sel.value !== (r.letter || '')) r.sel.value = r.letter || '';
        r.sel.classList.toggle('changed', o !== undefined);
        r.credits = credits(r.hrs.value);
        const p = points(r.letter);
        r.qp.textContent = p != null && r.credits ? fixed(p * r.credits) : '–';
      }
      const t = term(rows.map((r) => ({ letter: r.letter, credits: r.credits, name: ui.nameOf(r.course) })));
      out.gpa.textContent = fixed(t.gpa);
      out.credits.textContent = ` over ${ui.num(t.credits)} credit hour${t.credits === 1 ? '' : 's'}`;
      const noLetter = t.skipped.filter((s) => s.why === 'letter').map((s) => s.name);
      const noHours = t.skipped.filter((s) => s.why === 'credits').map((s) => s.name);
      out.skipped.textContent = [
        noLetter.length ? `Left out, no letter yet: ${noLetter.join(', ')}.` : '',
        noHours.length ? `Left out, no credit hours: ${noHours.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
      const p = prior(pg.value, pc.value);
      out.errors.textContent = [p.errors.gpa, p.errors.credits].filter(Boolean).join(' ');
      const have = p.gpa != null && p.credits != null;
      out.cum.textContent = have ? fixed(cumulative(t, p)) : '–';
      out.cumNote.textContent = have ? ` over ${ui.num(p.credits + t.credits)} credit hours` : out.errors.textContent ? '' : ' Enter your GPA and credit hours before this term.';
      reset.disabled = !overrides.size;
    }

    const body = rows.length
      ? [
          h('table', { class: 'grid gpa' },
            h('thead', null, h('tr', null, h('th', null, 'Course'), h('th', { class: 'num' }, 'Current'), h('th', null, 'Letter'), h('th', null, 'Credits'), h('th', { class: 'num' }, 'Points'))),
            h('tbody', null, rows.map((r) => h('tr', null,
              h('td', null, h('span', { class: 'dot', style: `background:${ui.colorOf(r.course.id)}` }), ' ', ui.nameOf(r.course)),
              h('td', { class: 'num', title: r.scale ? 'Letter from the course’s grade scheme' : null }, r.est ? [r.est.percent != null ? `${Math.round(r.est.percent * 10) / 10}% ` : '', r.est.letter, r.est.from === 'estimate' ? [' ', ui.tag('estimate')] : null] : h('span', { class: 'muted' }, 'No total')),
              h('td', null, r.sel),
              h('td', null, r.hrs),
              r.qp)))),
          h('p', null, 'Term GPA: ', out.gpa, out.credits, ' ', reset),
          out.skipped,
          h('p', null, 'Before this term: GPA ', pg, ' over ', pc, ' credit hours. Cumulative GPA: ', out.cum, out.cumNote),
          out.errors,
        ]
      : [ui.empty('No courses this term.')];
    const ownScale = rows.filter((r) => r.scale).map((r) => ui.nameOf(r.course));
    const scaleNote = ownScale.length
      ? `each course's own grade scheme where its Grades page has read it (${ownScale.join(', ')}) and common cut-offs (A 93, A- 90, …) for the rest`
      : 'common cut-offs (A 93, A- 90, …; your syllabus may differ, and a course whose Grades page you have opened uses its own scheme)';
    const el = h('section', { class: 'gpacalc' },
      h('h2', { class: 'sect' }, 'Semester GPA'),
      body,
      h('p', { class: 'muted small' }, `Unofficial: points use the standard US 4.0 scale (A+ and A 4.0, A- 3.7, B+ 3.3, …; your school's may differ). Letters come from current totals and ${scaleNote}. Credit hours are ${DEFAULT_CREDITS} per course until you type your own, which are saved. Pick a letter to try a what-if; picks are not saved. Credits of 0 leave a course out.`));
    update();
    return el;
  }

  return { LETTERS, POINTS, CUTS, DEFAULT_CREDITS, letter, leadingLetter, points, letterOfPercent, letterOfTotal, credits, creditsFor, setCredits, term, prior, cumulative, clean, panel };
})();
