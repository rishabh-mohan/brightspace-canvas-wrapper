// A small made-up Brightspace for development: answers the API routes the extension
// calls, with invented courses and grades. Shapes follow fixtures/brightspace-probe-report.json.
// Dates are relative to "now" so there is always upcoming and past work.
const DAY = 864e5;
const now = Date.now();
const at = (days, h = 23, m = 59) => {
  const d = new Date(now + days * DAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const rich = (html) => ({ Text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), Html: html });

function termCode(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return m >= 8 ? `${y + 1}10` : m <= 5 ? `${y}20` : `${y}30`;
}
const T = termCode();

const COURSES = [
  { id: 101, name: 'Fall 2026 CS 25100-LE1 LEC - Data Structures and Algorithms', code: `wl.${T}.CS.25100.LE1`, system: 'Points', hw: 'Project', tool: 'Gradescope', final: false },
  { id: 102, name: 'Fall 2026 MA 26100 - Multivariate Calculus', code: `wl.${T}.MA.26100.050`, system: 'Weighted', hw: 'Homework', tool: 'MyLab Math', final: true },
  { id: 103, name: 'Fall 2026 STAT 35000 - Introduction to Statistics', code: `wl.${T}.STAT.35000.130`, system: 'Weighted', hw: 'Homework', tool: null, final: false },
  { id: 104, name: 'Fall 2026 ENGL 10600 - First-Year Composition', code: `wl.${T}.ENGL.10600.Y12`, system: 'Points', hw: 'Essay', tool: null, final: true },
  { id: 105, name: 'Fall 2026 PHYS 17200 - Modern Mechanics', code: `wl.${T}.PHYS.17200.001`, system: 'Points', hw: 'Lab Report', tool: 'WebAssign', final: false },
  { id: 201, name: 'Purdue Civics Literacy', code: 'wl.nc.civics.2', system: 'Points', hw: 'Module', tool: null, final: false, extra: true },
  { id: 202, name: '2026 Orientation Programs', code: 'wl.nc.2026Purdue102Fall', system: 'Points', hw: 'Task', tool: null, final: false, extra: true },
];
const course = (ou) => COURSES.find((c) => c.id === Number(ou));

// ---- per-course content -----------------------------------------------------
function build(c) {
  const n = c.extra ? 2 : 7;
  const folders = [];
  const quizzes = [];
  const items = [];
  const values = [];
  const cat = { hw: c.id * 1000 + 1, quiz: c.id * 1000 + 2, exam: c.id * 1000 + 3 };
  const score = (i, max) => Math.round(max * (0.72 + ((c.id * 7 + i * 13) % 27) / 100) * 10) / 10;
  const value = (id, name, num, den, weight, type = 1) => ({
    PointsNumerator: num, PointsDenominator: den, WeightedNumerator: weight ? (num / den) * weight : null, WeightedDenominator: weight || null,
    GradeObjectIdentifier: String(id), GradeObjectName: name, GradeObjectType: type, GradeObjectTypeName: type === 9 ? 'Category' : 'Numeric',
    DisplayedGrade: `${Math.round((num / den) * 1000) / 10} %`, Comments: rich(num / den < 0.8 ? '<p>Check the rubric for where points were lost.</p>' : ''), PrivateComments: rich(''),
    LastModified: at(-((id * 3) % 20) - 1, 14, 5), LastModifiedBy: null, ReleasedDate: null,
  });
  const item = (id, name, max, category, weight) => ({
    MaxPoints: max, CanExceedMaxPoints: false, IsBonus: false, ExcludeFromFinalGradeCalculation: false, GradeSchemeId: null, GradeSchemeUrl: '',
    Id: id, Name: name, ShortName: '', GradeType: 'Numeric', CategoryId: category, Description: rich(''), Weight: weight, AssociatedTool: null, IsHidden: false,
  });

  for (let i = 1; i <= n; i++) {
    const due = -38 + i * 8; // days from now; the last two are in the future
    const gid = c.id * 1000 + 100 + i;
    const max = c.hw === 'Essay' ? 100 : 20;
    folders.push({
      Id: c.id * 100 + i, CategoryId: null, Name: `${c.hw} ${i}`,
      CustomInstructions: rich(`<p>Complete <strong>${c.hw} ${i}</strong> and upload one PDF.</p><ul><li>Show your work.</li><li>Late work loses 10% per day.</li></ul><p>See the <a href="https://example.edu/rubric">rubric</a>.</p>`),
      Attachments: i % 2 ? [{ FileId: i, FileName: `${c.hw.toLowerCase().replace(/ /g, '-')}-${i}.pdf`, Size: 184320 }] : [],
      TotalFiles: 0, UnreadFiles: 0, FlaggedFiles: 0, TotalUsers: 0, TotalUsersWithSubmissions: 0, TotalUsersWithFeedback: 0, Availability: null, IsHidden: false,
      Assessment: { ScoreDenominator: max, Rubrics: i % 2 ? [rubric(c.id * 100 + i, max)] : [] }, DropboxType: 2, GroupTypeId: null, DueDate: at(due), DisplayInCalendar: true, NotificationEmail: null,
      LinkAttachments: [], ActivityId: '', IsAnonymous: false, SubmissionType: 0, CompletionType: 0, AllowableFileType: 0, CustomAllowableFileTypes: null,
      GradeItemId: gid, AllowOnlyUsersWithSpecialAccess: null, SubmissionsRule: 2,
    });
    items.push(item(gid, `${c.hw} ${i}`, max, cat.hw, 30 / n));
    // One piece of STAT homework is left unsubmitted and ungraded, to exercise "overdue".
    if (due < -3 && !(c.id === 103 && i === 4)) values.push(value(gid, `${c.hw} ${i}`, score(i, max), max, c.system === 'Weighted' ? 30 / n : null));
  }
  const nq = c.extra ? 0 : 5;
  for (let i = 1; i <= nq; i++) {
    const due = -30 + i * 9;
    const gid = c.id * 1000 + 200 + i;
    const text = (html) => ({ Text: rich(html), IsDisplayed: true });
    quizzes.push({
      QuizId: c.id * 100 + 50 + i, Name: `Quiz ${i}`, AutoExportToGrades: true, IsActive: true, GradeItemId: gid, IsAutoSetGraded: true,
      Instructions: text('<p>Closed book. One attempt.</p>'), Description: text(`<p>Covers weeks ${i * 2 - 1} and ${i * 2}.</p>`), Header: text(''), Footer: text(''),
      StartDate: at(due - 3, 8, 0), EndDate: at(due + 1), DueDate: at(due), DisplayInCalendar: true, SortOrder: i,
      SubmissionTimeLimit: { IsEnforced: true, ShowClock: true, TimeLimitValue: 30 }, SubmissionGracePeriod: 0,
      LateSubmissionInfo: { LateSubmissionOption: 0, LateLimitMinutes: null }, AttemptsAllowed: { IsUnlimited: false, NumberOfAttemptsAllowed: i % 2 ? 1 : 2 },
      Password: null, AllowHints: false, CalcTypeId: 1, CategoryId: 0, ActivityId: '',
    });
    items.push(item(gid, `Quiz ${i}`, 10, cat.quiz, 20 / nq));
    if (due < -1) values.push(value(gid, `Quiz ${i}`, score(i + 3, 10), 10, c.system === 'Weighted' ? 20 / nq : null));
  }
  if (!c.extra) {
    items.push(item(c.id * 1000 + 301, 'Midterm Exam', 100, cat.exam, 20));
    values.push(value(c.id * 1000 + 301, 'Midterm Exam', score(2, 100), 100, c.system === 'Weighted' ? 20 : null));
    items.push(item(c.id * 1000 + 302, 'Final Exam', 100, cat.exam, 30));
    items.push({ ...item(c.id * 1000 + 303, 'Participation', 10, 0, 0), IsBonus: true });
  }
  const category = (id, name, weight) => ({ Id: id, Name: name, ShortName: '', Weight: weight, MaxPoints: 0, Grades: items.filter((x) => x.CategoryId === id), CanExceedMax: false, ExcludeFromFinalGrade: false, NumberOfLowestToDrop: 0 });
  const categories = c.extra ? [category(cat.hw, c.hw + 's', 100)] : [category(cat.hw, c.hw + 's', 30), category(cat.quiz, 'Quizzes', 20), category(cat.exam, 'Exams', 50)];
  for (const k of categories) {
    const graded = values.filter((v) => k.Grades.some((g) => String(g.Id) === v.GradeObjectIdentifier));
    if (graded.length) values.push(value(k.Id, k.Name, graded.reduce((s, v) => s + v.PointsNumerator, 0), graded.reduce((s, v) => s + v.PointsDenominator, 0), null, 9));
  }
  const real = values.filter((v) => v.GradeObjectType === 1);
  const final = c.final ? { ...value(c.id * 1000 + 999, 'Final Calculated Grade', real.reduce((s, v) => s + v.PointsNumerator, 0), real.reduce((s, v) => s + v.PointsDenominator, 0), null, 7), GradeObjectTypeName: null } : null;

  const forums = c.extra ? [] : [{ ForumId: c.id * 10 + 1, Name: 'Weekly Discussion', Description: rich(''), IsHidden: false, IsLocked: false }];
  const topics = c.extra ? [] : [1, 2, 3].map((i) => ({
    ForumId: c.id * 10 + 1, TopicId: c.id * 100 + 80 + i, Name: `Week ${i * 4} reflection`, Description: rich(`<p>Post a reflection on week ${i * 4} and reply to one classmate.</p>`),
    DueDate: i === 2 ? null : at(-20 + i * 12), StartDate: null, EndDate: null, IsLocked: false, IsHidden: false, MustPostToParticipate: i === 3, ScoreOutOf: i === 2 ? null : 5, ActivityId: '',
  }));
  const posts = [
    { PostId: 1, ParentPostId: null, ThreadId: 1, Subject: 'Recursion finally clicked', Message: rich('<p>The call-stack drawing from lecture made it obvious. Anyone else?</p>'), PostingUserDisplayName: 'Avery Chen', DatePosted: at(-6, 10, 12), IsAnonymous: false, IsDeleted: false },
    { PostId: 2, ParentPostId: 1, ThreadId: 1, Subject: 'Re: Recursion finally clicked', Message: rich('<p>Same. Drawing the frames helped more than the code.</p>'), PostingUserDisplayName: 'Jordan Patel', DatePosted: at(-6, 13, 40), IsAnonymous: false, IsDeleted: false },
    { PostId: 3, ParentPostId: 2, ThreadId: 1, Subject: 'Re: Recursion finally clicked', Message: rich('<p>Try the visualiser linked in Week 3.</p>'), PostingUserDisplayName: 'Sam Rivera (TA)', DatePosted: at(-5, 9, 2), IsAnonymous: false, IsDeleted: false },
    { PostId: 4, ParentPostId: null, ThreadId: 4, Subject: 'Question about the midterm format', Message: rich('<p>Is it multiple choice or free response?</p>'), PostingUserDisplayName: 'Riley Kim', DatePosted: at(-4, 18, 30), IsAnonymous: false, IsDeleted: false },
  ];

  const news = (c.extra ? [1] : [1, 2, 3, 4]).map((i) => ({
    Id: c.id * 10 + i, IsHidden: false, Attachments: i === 3 ? [{ FileId: 1, FileName: 'solutions.pdf', Size: 220000 }] : [], CreatedBy: 1, CreatedDate: at(-i * 5 + 3, 9, 15), LastModifiedDate: at(-i * 5 + 3, 9, 15), Title: ['Exam room change', 'Office hours moved this week', 'Homework solutions posted', 'Welcome to the course'][i - 1],
    Body: rich(['<p>The exam is now in <strong>WALC 1055</strong>. Bring a photo ID.</p><p>Seating chart: <a href="https://example.edu/seats">example.edu/seats</a></p>', '<p>Office hours move to Thursday 2–4pm in LWSN B146.</p>', '<p>Solutions for the last homework are in Content under Week 5.</p><ul><li>Check problem 3 carefully.</li><li>Regrade requests close Friday.</li></ul>', '<p>Welcome! Read the syllabus and complete the intro survey.</p><script>alert(1)</script><img src="x" alt="campus photo">'][i - 1]),
    StartDate: at(-i * 5 + 3, 9, 15), EndDate: null, IsGlobal: false, IsPublished: true, ShowOnlyInCourseOfferings: false, IsAuthorInfoShown: true, IsPinned: i === 4, IsStartDateShown: true, SortOrder: i,
  }));

  let tid = c.id * 1000;
  const topic = (title, type, url) => ({ IsExempt: false, IsHidden: false, SortOrder: 0, IsLocked: false, IsBroken: false, ActivityId: '', TopicId: ++tid, Identifier: String(tid), TypeIdentifier: type, Title: title, Bookmarked: false, Unread: tid % 3 === 0, Url: url, LastModifiedDate: at(-10), Description: rich('') });
  const mod = (id, title, topicsIn, subs = []) => ({ IsHidden: false, SortOrder: id, IsLocked: false, ModuleId: c.id * 100 + id, Title: title, Modules: subs, Topics: topicsIn, LastModifiedDate: at(-10), Description: rich('') });
  const toc = {
    Modules: [
      mod(1, 'Start Here', [topic('Syllabus', 'File', '/content/syllabus.pdf'), topic('Course Schedule', 'File', '/content/schedule.pdf'), ...(c.tool ? [topic(c.tool, 'Link', `/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${c.id}&type=lti&rcode=abc`)] : [])]),
      ...(c.extra ? [] : [1, 2, 3].map((w) => mod(1 + w, `Week ${w}`, [topic(`Lecture ${w * 2 - 1} slides`, 'File', '/content/l.pdf'), topic(`Lecture ${w * 2} slides`, 'File', '/content/l2.pdf'), topic('Reading: chapter ' + w, 'Link', 'https://example.edu/reading'), topic(`${c.hw} ${w}`, 'Link', `/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${c.id}&type=dropbox&rcode=x`), topic(`Quiz ${w}`, 'Link', `/d2l/common/dialogs/quickLink/quickLink.d2l?ou=${c.id}&type=quiz&rcode=y`)], w === 1 ? [mod(9, 'Extra practice', [topic('Practice problems', 'File', '/content/p.pdf')])] : []))),
    ],
  };

  const names = ['Avery Chen', 'Jordan Patel', 'Riley Kim', 'Sam Rivera', 'Morgan Lee', 'Casey Nguyen', 'Taylor Brooks', 'Jamie Ortiz', 'Quinn Adams', 'Drew Park', 'Alex Johnson', 'Skyler Wright', 'Peyton Hall', 'Reese Turner', 'Rowan Scott', 'Emerson Young', 'Finley King', 'Harper Green'];
  const classlist = names.map((nm, i) => ({ Identifier: String(500 + i), ProfileIdentifier: 'x', DisplayName: nm, Username: null, OrgDefinedId: null, Email: `${nm.split(' ')[0].toLowerCase()}@example.edu`, FirstName: nm.split(' ')[0], LastName: nm.split(' ')[1], RoleId: i === 3 ? 2 : i === 0 ? 1 : 3, LastAccessed: null, IsOnline: false, ClasslistRoleDisplayName: i === 3 ? 'Teaching Assistant' : i === 0 ? 'Instructor' : 'Student' }));

  const events = [
    ...folders.map((f) => ({ id: f.Id, title: f.Name, at: f.DueDate, link: `/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${c.id}` })),
    ...quizzes.map((q) => ({ id: q.QuizId, title: q.Name, at: q.DueDate, link: `/d2l/lms/quizzing/quizzing.d2l?ou=${c.id}&qi=${q.QuizId}` })),
  ].map((e) => ({ CalendarEventId: e.id, OrgUnitId: c.id, Title: e.title, Description: '', CalendarEventViewUrl: `/d2l/le/calendar/${c.id}/event/${e.id}/detailsview`, IsAllDayEvent: false, StartDateTime: e.at, EndDateTime: e.at, OrgUnitName: c.name, OrgUnitCode: c.code, IsAssociatedWithEntity: true, AssociatedEntity: { AssociatedEntityType: 'x', AssociatedEntityId: e.id, Link: e.link } }));

  return { folders, quizzes, items, values, categories, final, forums, topics, posts, news, toc, classlist, events };
}
// A points rubric with three criteria and four levels, shaped as Brightspace's Rubric.Rubric.
function rubric(id, max) {
  const part = max / 4;
  const levels = [['Exemplary', 1], ['Proficient', 0.75], ['Developing', 0.5], ['Missing', 0]];
  const crit = (cid, name, weight, words) => ({ Id: cid, Name: name, Cells: levels.map(([, f], k) => ({ Points: Math.round(part * weight * f * 10) / 10, Description: rich(words[k]), Feedback: rich('') })) });
  return {
    RubricId: id, Name: 'Grading rubric', Description: rich(''), RubricType: 1, ScoringMethod: 1, IsScoreVisibleToAssessedUsers: true,
    CriteriaGroups: [{ Name: 'Criteria', Levels: levels.map(([n], k) => ({ Id: k + 1, Name: n, Points: null })), Criteria: [
      crit(id * 10 + 1, 'Correctness', 2, ['All parts correct', 'Minor errors', 'Several errors', 'Not attempted']),
      crit(id * 10 + 2, 'Shows work', 1, ['Every step shown', 'Most steps shown', 'Few steps shown', 'No work shown']),
      crit(id * 10 + 3, 'Presentation', 1, ['Clear and tidy', 'Mostly clear', 'Hard to follow', 'Illegible']),
    ] }],
    OverallLevels: [],
  };
}

const DATA = new Map(COURSES.map((c) => [c.id, build(c)]));
const handedIn = new Map(); // folder id -> submissions made through the dev server

// Quiz attempts are refused to students in this course, as at Purdue; the summary page answers instead.
const NO_ATTEMPTS_API = 102;
function quizSummary(query) {
  const c = course(query.get('ou'));
  const q = c && DATA.get(c.id).quizzes.find((k) => k.QuizId === Number(query.get('qi')));
  if (!q) return null;
  const allowed = q.AttemptsAllowed.NumberOfAttemptsAllowed;
  const done = Date.parse(q.DueDate) < now ? 1 : 0;
  return `<!doctype html><html><body><h1>${q.Name} - Summary</h1><div class="d2l-box"><table><tr><th>Due Date</th><td>${q.DueDate}</td></tr><tr><th>Attempts</th><td>Allowed - ${allowed}, Completed - ${done}</td></tr><tr><th>Time Limit</th><td>30 minutes</td></tr></table></div><button>Start Quiz!</button></body></html>`;
}

// POST .../dropbox/folders/{id}/submissions/mysubmissions/ with a multipart/mixed body.
function submit(pathname, body, contentType) {
  const m = pathname.match(/^\/d2l\/api\/le\/[\d.]+\/(\d+)\/dropbox\/folders\/(\d+)\/submissions\/mysubmissions\/$/);
  if (!m || !/^multipart\/mixed;\s*boundary=/i.test(contentType || '')) return { status: 400, type: 'text/plain', body: 'Bad request' };
  const text = body.toString('latin1');
  const name = (text.match(/filename="([^"]*)"/) || [])[1];
  const json = (text.match(/Content-Type: application\/json\r\n\r\n([^\r]*)/) || [])[1];
  if (!name) return { status: 405, type: 'text/plain', body: 'A submission needs a file.' };
  const list = handedIn.get(Number(m[2])) || [];
  list.push({ Id: 100 + list.length, SubmittedBy: { Identifier: '42', DisplayName: 'Student One' }, SubmissionDate: new Date().toISOString(), Comment: rich(json ? JSON.parse(json).Text : ''), Files: [{ IsRead: false, IsFlagged: false, IsDeleted: false, FileId: 500 + list.length, FileName: name, Size: body.length }] });
  handedIn.set(Number(m[2]), list);
  return { status: 200, type: 'application/json', body: '{}' };
}

function submissions(c, d, folderId) {
  const f = d.folders.find((x) => x.Id === Number(folderId));
  if (!f) return null;
  const mine = handedIn.get(f.Id);
  if (mine) return [{ Entity: { DisplayName: 'Student One', EntityId: 42, EntityType: 'User', Active: true }, Status: 1, Feedback: null, Submissions: mine, CompletionDate: mine[mine.length - 1].SubmissionDate }];
  const due = Date.parse(f.DueDate);
  if (due > now + 5 * DAY) return []; // furthest-out work: nothing yet
  if (due > now) return [{ Entity: {}, Status: 2, Feedback: null, Submissions: [{ Id: 1, SubmissionDate: null, Comment: rich(''), Files: [] }], CompletionDate: null }];
  const graded = d.values.find((v) => v.GradeObjectIdentifier === String(f.GradeItemId));
  if (!graded && (f.Id % 2 || f.Id === 10304)) return []; // some recent work left unsubmitted
  return [{
    Entity: { DisplayName: 'Student One', EntityId: 42, EntityType: 'User', Active: true }, Status: graded ? 3 : 1,
    Feedback: graded ? {
      Files: f.Id % 2 ? [{ FileId: 77, FileName: 'marked-up.pdf', Size: 96000 }] : [], Links: [], Score: graded.PointsNumerator, Feedback: rich('<p>Solid work. Watch the edge cases in part 2.</p>'),
      RubricAssessments: f.Assessment.Rubrics.map((rb) => ({
        RubricId: rb.RubricId, UserId: 42, ObjectType: 'Dropbox', ObjectId: f.Id,
        OverallOutcome: { LevelId: null, Score: graded.PointsNumerator, ScoreIsOverridden: false, Feedback: rich(''), FeedbackIsOverridden: false },
        CriteriaOutcome: rb.CriteriaGroups[0].Criteria.map((cr, k) => ({ CriterionId: cr.Id, LevelId: k === 0 ? 2 : 1, Score: cr.Cells[k === 0 ? 1 : 0].Points, ScoreIsOverridden: false, Feedback: rich(k === 0 ? 'Part 2 misses the empty-input case.' : ''), FeedbackIsOverridden: false })),
      })),
      IsGraded: true, GradedSymbol: null } : null,
    Submissions: [{ Id: 9, SubmittedBy: { Identifier: '42', DisplayName: 'Student One' }, SubmissionDate: new Date(due - 5 * 36e5).toISOString(), Comment: rich(''), Files: [{ IsRead: true, IsFlagged: false, IsDeleted: false, FileId: 1, FileName: `${f.Name.toLowerCase().replace(/ /g, '-')}.pdf`, Size: 412000 }] }],
    CompletionDate: new Date(due - 5 * 36e5).toISOString(),
  }];
}

const image = (id) => {
  const hue = (id * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},45%,30%)"/></linearGradient></defs><rect width="600" height="300" fill="url(#g)"/><circle cx="470" cy="80" r="120" fill="rgba(255,255,255,.12)"/><circle cx="120" cy="260" r="160" fill="rgba(0,0,0,.12)"/></svg>`;
};

// Returns { status, type, body } for an API path, or null when the path is not an API route.
function handle(pathname, query) {
  const m = pathname.match(/^\/d2l\/api\/(.*)$/);
  if (!m) return null;
  const json = (body) => (body == null ? { status: 404, type: 'text/html', body: 'Not found' } : { status: 200, type: 'application/json', body: JSON.stringify(body) });
  const rest = m[1];
  if (rest === 'versions/') return json([{ ProductCode: 'lp', LatestVersion: '1.64' }, { ProductCode: 'le', LatestVersion: '1.100' }]);
  let r;
  if ((r = rest.match(/^lp\/[\d.]+\/(.*)$/))) {
    const p = r[1];
    if (p === 'users/whoami') return json({ Identifier: '42', FirstName: 'Student', LastName: 'One', Pronouns: '', UniqueName: 'student1', ProfileIdentifier: 'x' });
    if (p === 'enrollments/myenrollments/') {
      const unit = (id, code, name, ucode, pin) => ({ OrgUnit: { Id: id, Type: { Id: 3, Code: code, Name: code }, Name: name, Code: ucode, HomeUrl: '', ImageUrl: '' }, Access: { IsActive: true, StartDate: null, EndDate: null, CanAccess: true, ClasslistRoleName: 'Student', LISRoles: [], LastAccessed: at(-(id % 9)) }, PinDate: pin ? at(-30) : null });
      return json({ PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: [unit(6606, 'Organization', 'Purdue', 'purdue'), ...COURSES.map((c) => unit(c.id, 'Course Offering', c.name, c.code, false)), unit(900, 'Group', 'Lab group 4', 'grp')] });
    }
    if ((r = p.match(/^courses\/(\d+)\/image$/))) return { status: 200, type: 'image/svg+xml', body: image(Number(r[1])) };
    return json(null);
  }
  if (!(r = rest.match(/^le\/[\d.]+\/(.*)$/))) return json(null);
  const p = r[1];
  if (p === 'overdueItems/myItems') {
    const d = DATA.get(103);
    return json({ Objects: [{ UserId: 42, OrgUnitId: 103, ItemId: d.folders[3].Id, ItemName: d.folders[3].Name, DueDate: d.folders[3].DueDate }], Next: null });
  }
  if (p === 'calendar/events/myEvents/') {
    const ids = (query.get('orgUnitIdsCSV') || '').split(',').map(Number);
    const from = Date.parse(query.get('startDateTime'));
    const to = Date.parse(query.get('endDateTime'));
    return json({ Objects: ids.flatMap((id) => DATA.get(id)?.events || []).filter((e) => Date.parse(e.StartDateTime) >= from && Date.parse(e.StartDateTime) <= to), Next: null });
  }
  if (!(r = p.match(/^(\d+)\/(.*)$/))) return json(null);
  const c = course(r[1]);
  const d = c && DATA.get(c.id);
  if (!d) return json(null);
  const t = r[2];
  let x;
  if (t === 'dropbox/folders/') return json(d.folders);
  if ((x = t.match(/^dropbox\/folders\/(\d+)\/submissions\/mysubmissions\/$/))) return json(submissions(c, d, x[1]));
  if (t === 'quizzes/') return json({ Objects: d.quizzes, Next: null });
  if (/^dropbox\/folders\/\d+\/(attachments\/\d+|feedback\/user\/\d+\/attachments\/\d+|submissions\/\d+\/files\/\d+)$/.test(t) || /^news\/\d+\/attachments\/\d+$/.test(t)) {
    return { status: 200, type: 'text/plain; charset=utf-8', body: 'Made-up file contents.' };
  }
  if ((x = t.match(/^quizzes\/(\d+)\/attempts\/$/))) {
    if (c.id === NO_ATTEMPTS_API) return { status: 403, type: 'application/problem+json', body: '{"title":"Forbidden"}' };
    const q = d.quizzes.find((k) => k.QuizId === Number(x[1]));
    if (!q) return json(null);
    return json({ Objects: Date.parse(q.DueDate) < now ? [{ AttemptId: 1, UserId: 42, AttemptNumber: 1 }] : [], Next: null });
  }
  if (t === 'discussions/forums/') return json(d.forums);
  if ((x = t.match(/^discussions\/forums\/(\d+)\/topics\/$/))) return json(d.topics.filter((k) => k.ForumId === Number(x[1])));
  if ((x = t.match(/^discussions\/forums\/(\d+)\/topics\/(\d+)\/posts\/$/))) return json(d.posts);
  if (t === 'grades/') return json(d.items);
  if (t === 'grades/categories/') return json(d.categories);
  if (t === 'grades/setup/') return json({ GradingSystem: c.system, IsNullGradeZero: false, DefaultGradeSchemeId: 1 });
  if (t === 'grades/values/myGradeValues/') return json(d.values);
  if (t === 'grades/final/values/myGradeValue') return json(d.final);
  if (t === 'news/') return json(d.news);
  if (t === 'content/toc') return json(d.toc);
  if ((x = t.match(/^content\/topics\/(\d+)\/file$/))) {
    return { status: 200, type: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><body style="font:16px Georgia,serif;margin:40px;max-width:640px"><h1>Made-up file ${x[1]}</h1><p>This stands in for a PDF or page stored in the course's Content. In the real thing the browser shows the file itself here.</p><ol><li>First point</li><li>Second point</li></ol></body>` };
  }
  if (t === 'classlist/') return json(d.classlist);
  if (t === 'overview') return json(c.extra ? null : { Description: rich(`<p><strong>${c.name}</strong></p><p>Lectures Monday, Wednesday and Friday. Grading: ${d.categories.map((k) => `${k.Name} ${k.Weight}%`).join(', ')}.</p><p>Late work loses 10% per day. Email the instructor before a deadline if you need an extension.</p>`), HasAttachment: true });
  if (t === 'updates/myUpdates') return json({ OrgUnitId: String(c.id), UserId: '42', UnreadDiscussions: c.id % 3, UnapprovedDiscussions: 0, UnreadAssignmentFeedback: c.id % 2, UnattemptedQuizzes: c.extra ? 0 : 1, UnreadAssignmentSubmissions: 0, UngradedQuizzes: 0, PendingEnrollmentRequests: 0 });
  return json(null);
}

// A made-up Gradescope, with the same page structure the reader in src/gradescope.js expects.
// Returns the HTML for /account or /courses/555, or null.
function gradescope(path) {
  const stamp = (days) => {
    const d = new Date(now + days * DAY);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 23:59:00 -0500`;
  };
  if (path === '/account') {
    return `<html><body><div id="account-show"><h1 class="pageHeading">Your Courses</h1><div class="courseList">
      <div class="courseList--term">Fall 2026</div><div class="courseList--coursesForTerm">
        <a class="courseBox" href="/courses/555"><h3 class="courseBox--shortname">wl.${T}.CS.25100.LE1</h3><div class="courseBox--name">Data Structures and Algorithms</div><div class="courseBox--assignments">4 assignments</div></a>
        <a class="courseBox" href="/courses/556"><h3 class="courseBox--shortname">Some Other Course</h3><div class="courseBox--name">Unrelated</div><div class="courseBox--assignments">1 assignment</div></a>
      </div></div></div></body></html>`;
  }
  if (path === '/courses/555') {
    const dates = (due) => `<td><div class="submissionTimeChart"><time class="submissionTimeChart--releaseDate" datetime="${stamp(due - 7)}">released</time><time class="submissionTimeChart--dueDate" datetime="${stamp(due)}">due</time></div></td>`;
    return `<html><body><table id="assignments-student-table"><thead><tr role="row"><th>Name</th><th>Status</th><th>Released / Due</th></tr></thead><tbody>
      <tr role="row"><th class="table--primaryLink" scope="row"><a href="/courses/555/assignments/1/submissions/91">Written Homework 1</a></th><td class="submissionStatus"><div class="submissionStatus--score">9.0 / 10.0</div></td>${dates(-20)}</tr>
      <tr role="row"><th class="table--primaryLink" scope="row"><a href="/courses/555/assignments/2/submissions/92">Written Homework 2</a></th><td class="submissionStatus"><div class="submissionStatus--text">Submitted</div></td>${dates(-6)}</tr>
      <tr role="row"><th class="table--primaryLink" scope="row">Written Homework 3</th><td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>${dates(-2)}</tr>
      <tr role="row"><th class="table--primaryLink" scope="row"><button class="js-submitAssignment" data-assignment-id="4" type="button">Written Homework 4</button></th><td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>${dates(4)}</tr>
      <tr role="row"><td colspan="3" class="dropzonePreview--fileNameHeader">Name</td></tr>
    </tbody></table></body></html>`;
  }
  return null;
}

module.exports = { handle, gradescope, quizSummary, submit };
