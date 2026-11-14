// Phase 1 access probe. Runs in the Brightspace tab as the signed-in user.
// Read-only: every call is a GET, except one optional token request (see getToken).
// The downloadable report holds statuses and response SHAPES only, never values,
// so it contains no names, grades or course titles.
(() => {
  const PANEL_ID = 'bsx-probe';
  const MAX_COURSES = 3;
  const DAY = 864e5;

  document.getElementById(PANEL_ID)?.remove();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let bearer = null;

  async function call(path) {
    const out = { status: 0 };
    try {
      const res = await fetch(path, {
        credentials: 'same-origin',
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      });
      out.status = res.status;
      const type = res.headers.get('content-type') || '';
      out.contentType = type.split(';')[0];
      if (res.ok && type.includes('json')) out.body = await res.json();
    } catch (e) {
      out.error = String(e);
    }
    await sleep(150); // stay gentle on the server
    return out;
  }

  // Fallback used only if plain session cookies are refused: ask for the same
  // short-lived token Brightspace's own pages use. Recorded in the report as authMode.
  async function getToken() {
    try {
      const xsrf = localStorage.getItem('XSRF.Token');
      if (!xsrf) return null;
      const res = await fetch('/d2l/lp/auth/oauth2/token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Csrf-Token': xsrf },
        body: 'scope=*:*:*',
      });
      if (!res.ok) return null;
      return (await res.json()).access_token || null;
    } catch {
      return null;
    }
  }

  // Types and structure only. Arrays keep their length and the shape of the first element.
  function shape(v, depth = 0) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return { _array: v.length, _of: v.length && depth < 6 ? shape(v[0], depth + 1) : null };
    if (typeof v === 'object') {
      if (depth >= 6) return 'object';
      return Object.fromEntries(Object.keys(v).map((k) => [k, shape(v[k], depth + 1)]));
    }
    return typeof v;
  }

  function count(body) {
    if (Array.isArray(body)) return body.length;
    const list = body && (body.Items || body.Objects || body.Modules);
    return Array.isArray(list) ? list.length : undefined;
  }

  // ---- panel -------------------------------------------------------------
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:2147483647;width:520px;max-height:85vh;overflow:auto;' +
    'background:#fff;color:#111;border:1px solid #888;border-radius:8px;padding:12px 14px;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.25)';
  const el = (tag, text, css) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (css) n.style.cssText = css;
    return n;
  };
  const title = el('div', 'Brightspace access probe', 'font-weight:600;font-size:15px;margin-bottom:6px');
  const statusLine = el('div', 'Starting…', 'margin-bottom:8px;color:#444');
  const rows = el('div');
  const buttons = el('div', null, 'margin-top:10px;display:flex;gap:8px');
  panel.append(title, statusLine, rows, buttons);
  document.body.append(panel);

  const button = (label, onClick) => {
    const b = el('button', label, 'padding:4px 10px;border:1px solid #888;border-radius:6px;background:#f3f3f3;color:#111;cursor:pointer');
    b.addEventListener('click', onClick);
    buttons.append(b);
  };
  button('Close', () => panel.remove());

  const heading = (text) => rows.append(el('div', text, 'font-weight:600;margin-top:10px'));
  const row = (label, r) => {
    const ok = r.status >= 200 && r.status < 300;
    const n = count(r.body);
    const line = el('div', null, 'display:flex;gap:8px;border-top:1px solid #eee;padding:2px 0');
    line.append(
      el('span', String(r.status || 'ERR'), `width:34px;font-weight:600;color:${ok ? '#0a7a2f' : '#b3261e'}`),
      el('span', label, 'flex:1'),
      el('span', n === undefined ? '' : `${n} items`, 'color:#666')
    );
    rows.append(line);
  };

  // ---- probe -------------------------------------------------------------
  const report = { generatedAt: new Date().toISOString(), authMode: 'none', versions: null, results: [] };

  async function probe(group, label, template, path) {
    statusLine.textContent = `Checking ${label}…`;
    const r = await call(path);
    row(label, r);
    report.results.push({
      group,
      label,
      endpoint: template,
      status: r.status,
      contentType: r.contentType,
      error: r.error,
      count: count(r.body),
      shape: r.body === undefined ? undefined : shape(r.body),
    });
    return r;
  }

  async function run() {
    const versions = await call('/d2l/api/versions/');
    if (!Array.isArray(versions.body)) {
      statusLine.textContent =
        `Could not read /d2l/api/versions/ (status ${versions.status || 'error'}). ` +
        'Open a Brightspace page while signed in, then click the extension button again.';
      return;
    }
    const latest = (code) => versions.body.find((p) => p.ProductCode === code)?.LatestVersion;
    const lpV = latest('lp');
    const leV = latest('le');
    report.versions = { lp: lpV, le: leV, all: versions.body };
    if (!lpV || !leV) {
      statusLine.textContent = 'Versions list did not include lp and le.';
      return;
    }
    const lp = `/d2l/api/lp/${lpV}`;
    const le = `/d2l/api/le/${leV}`;

    // Decide how we are authenticated.
    let who = await call(`${lp}/users/whoami`);
    if (who.status === 200) {
      report.authMode = 'session';
    } else {
      bearer = await getToken();
      if (bearer) {
        who = await call(`${lp}/users/whoami`);
        if (who.status === 200) report.authMode = 'token';
      }
    }
    if (report.authMode === 'none') {
      statusLine.textContent = `Not authorised (whoami returned ${who.status || 'error'}). Sign in and try again.`;
      return;
    }

    heading(`Account (auth: ${report.authMode}, lp ${lpV}, le ${leV})`);
    await probe('account', 'Current user', 'lp/users/whoami', `${lp}/users/whoami`);

    // Enrolments, all pages (capped).
    const enrolments = [];
    let bookmark = '';
    for (let page = 0; page < 10; page++) {
      const q = bookmark ? `?bookmark=${encodeURIComponent(bookmark)}` : '';
      const r =
        page === 0
          ? await probe('account', 'My enrolments', 'lp/enrollments/myenrollments/', `${lp}/enrollments/myenrollments/${q}`)
          : await call(`${lp}/enrollments/myenrollments/${q}`);
      enrolments.push(...(r.body?.Items || []));
      if (!r.body?.PagingInfo?.HasMoreItems) break;
      bookmark = r.body.PagingInfo.Bookmark;
    }
    const typeCodes = {};
    for (const e of enrolments) {
      const code = e.OrgUnit?.Type?.Code || 'unknown';
      typeCodes[code] = (typeCodes[code] || 0) + 1;
    }
    report.enrolmentTypeCounts = typeCodes; // org unit type names and counts only

    const now = Date.now();
    const offerings = enrolments.filter((e) => e.OrgUnit?.Type?.Code === 'Course Offering');
    const current = offerings.filter(
      (e) => e.Access?.CanAccess !== false && e.Access?.IsActive !== false && (!e.Access?.EndDate || Date.parse(e.Access.EndDate) > now)
    );
    const pool = (current.length ? current : offerings).sort(
      (a, b) => Date.parse(b.Access?.LastAccessed || 0) - Date.parse(a.Access?.LastAccessed || 0)
    );
    const courses = pool.slice(0, MAX_COURSES);
    report.courseCounts = { enrolments: enrolments.length, offerings: offerings.length, current: current.length, probed: courses.length };

    const start = new Date(now - 30 * DAY).toISOString();
    const end = new Date(now + 60 * DAY).toISOString();
    const range = `startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;

    await probe('account', 'Due items (all courses)', 'le/content/myItems/due/', `${le}/content/myItems/due/`);
    await probe('account', 'Overdue items (all courses)', 'le/overdueItems/myItems', `${le}/overdueItems/myItems`);
    if (courses.length) {
      const csv = courses.map((c) => c.OrgUnit.Id).join(',');
      await probe(
        'account',
        'Calendar (all probed courses)',
        'le/calendar/events/myEvents/?orgUnitIdsCSV&startDateTime&endDateTime',
        `${le}/calendar/events/myEvents/?orgUnitIdsCSV=${csv}&${range}`
      );
    }

    for (let i = 0; i < courses.length; i++) {
      const ou = courses[i].OrgUnit.Id;
      const group = `course-${i + 1}`;
      heading(`Course ${i + 1}: ${courses[i].OrgUnit.Name}`); // name shown on screen only, not in the report
      const c = (label, tail, base = le) => probe(group, label, `${base === le ? 'le' : 'lp'}/{ou}/${tail}`, `${base}/${ou}/${tail}`);

      await probe(group, 'Course image', 'lp/courses/{ou}/image', `${lp}/courses/${ou}/image`);
      await c('Content table of contents', 'content/toc');
      await c('Content root modules', 'content/root/');
      const folders = await c('Assignment folders', 'dropbox/folders/');
      const quizzes = await c('Quizzes', 'quizzes/');
      const forums = await c('Discussion forums', 'discussions/forums/');
      await c('Grade items', 'grades/');
      await c('Grade categories', 'grades/categories/');
      await c('Grade setup', 'grades/setup/');
      await c('My grade values', 'grades/values/myGradeValues/');
      await c('My final grade', 'grades/final/values/myGradeValue');
      await c('Announcements', 'news/');
      await c('Calendar events', `calendar/events/myEvents/?${range}`);
      await c('Classlist', 'classlist/');
      await c('My updates', 'updates/myUpdates');
      await c('Course overview (syllabus)', 'overview');
      const cats = await c('Group categories', 'groupcategories/', lp);
      const catId = Array.isArray(cats.body) && cats.body[0]?.GroupCategoryId;
      if (catId) await probe(group, 'Groups (first category)', 'lp/{ou}/groupcategories/{id}/groups/', `${lp}/${ou}/groupcategories/${catId}/groups/`);

      const folderId = Array.isArray(folders.body) && folders.body[0]?.Id;
      if (folderId) {
        await probe(
          group,
          'My submissions (first folder)',
          'le/{ou}/dropbox/folders/{id}/submissions/mysubmissions/',
          `${le}/${ou}/dropbox/folders/${folderId}/submissions/mysubmissions/`
        );
      }
      const quizId = quizzes.body?.Objects?.[0]?.QuizId;
      if (quizId) {
        await probe(group, 'My quiz attempts (first quiz)', 'le/{ou}/quizzes/{id}/attempts/', `${le}/${ou}/quizzes/${quizId}/attempts/`);
        // The quiz summary page, read where the attempts list is refused. Records only which
        // attempt labels the page has and whether a number follows each, not the numbers.
        statusLine.textContent = 'Checking quiz summary page…';
        try {
          const res = await fetch(`/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${quizId}&ou=${ou}`, { credentials: 'same-origin' });
          const text = (await res.text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
          const near = (word) => {
            const m = text.match(new RegExp(`.{0,25}\\b${word}\\b.{0,25}`, 'i'));
            return m ? m[0].replace(/\d/g, '#') : null; // digits masked
          };
          const r = { status: res.status, contentType: res.headers.get('content-type') };
          row('Quiz summary page (first quiz)', r);
          report.results.push({ group, label: 'Quiz summary page (first quiz)', endpoint: '/d2l/lms/quizzing/user/quiz_summary.d2l?qi={id}&ou={ou}', status: res.status, contentType: r.contentType, redirectedToLogin: /\/d2l\/login/i.test(res.url), labels: { allowed: near('Allowed'), completed: near('Completed'), remaining: near('Remaining') } });
        } catch (e) {
          report.results.push({ group, label: 'Quiz summary page (first quiz)', error: String(e) });
        }
      }
      const forumId = Array.isArray(forums.body) && forums.body[0]?.ForumId;
      if (forumId) {
        const topics = await probe(
          group,
          'Discussion topics (first forum)',
          'le/{ou}/discussions/forums/{id}/topics/',
          `${le}/${ou}/discussions/forums/${forumId}/topics/`
        );
        const topicId = Array.isArray(topics.body) && topics.body[0]?.TopicId;
        if (topicId) {
          await probe(
            group,
            'Discussion posts (first topic)',
            'le/{ou}/discussions/forums/{id}/topics/{id}/posts/',
            `${le}/${ou}/discussions/forums/${forumId}/topics/${topicId}/posts/`
          );
        }
      }
    }

    const ok = report.results.filter((r) => r.status >= 200 && r.status < 300).length;
    statusLine.textContent = `Done: ${ok} of ${report.results.length} endpoints readable across ${courses.length} course(s).`;
    button('Download report', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'brightspace-probe-report.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  run().catch((e) => {
    statusLine.textContent = `Probe failed: ${e}`;
  });
})();
