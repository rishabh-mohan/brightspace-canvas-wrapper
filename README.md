# Canvas-style wrapper for Brightspace

A browser extension that shows your Brightspace courses in Canvas's layout. It is read-only: it never submits, posts or changes anything on Brightspace. Anything that writes (submitting work, taking a quiz, replying to a discussion) opens the real Brightspace page.

Background and decisions: [docs/brightspace-vs-canvas-wrapper-plan.md](docs/brightspace-vs-canvas-wrapper-plan.md).

## What it does

**Global navigation** (left rail): Account, Dashboard, Courses, Calendar, Inbox, Help, and a Brightspace switch that shows the original page.

**Dashboard**
- Card View: this term's course cards with a colour, picture, shortcuts and unread badges. The ⋮ button sets a nickname and colour.
- List View: a planner of dated work, grouped by day and opened on today. Items can be ticked off.
- Recent Activity: recent announcements and newly posted grades.
- Sidebar: To Do (overdue first, each item dismissible), Recent Feedback, View Grades.
- **+ To Do** adds your own item, for work that lives outside Brightspace such as Gradescope or publisher sites. Your items appear in To Do, List View and the Calendar.

**Courses**
- Home: recent announcements, modules, and a To Do and feedback sidebar.
- Announcements: searchable list and a page per announcement.
- Assignments: assignments, quizzes and discussions in one list, by date or by grade category, with search, submission status and an External Tools group.
- Assignment, quiz and discussion pages: instructions, dates, points, your submission and files, your grade and feedback, quiz attempts, and discussion posts as a thread.
- Grades: every item with due date and score, group subtotals, the released total or a labelled estimate, group weights, What-If scores, arranging by group, due date or title, and a course switcher.
- People, Files, Syllabus (course overview plus a summary of dated work), Quizzes, Discussions, Modules.

**Calendar**: month and agenda views, a checkbox per course, and your own To Do items.

**Preferences** (Account): light, dark or automatic theme, and whether to show current courses or all. Preferences and your To Do items are stored in the extension, in this browser only.

The wrapper stands in for the Brightspace home page, course home pages, and Brightspace's own Grades, Assignments, Announcements, Quizzes, Discussions, Classlist and Content list pages. On every other Brightspace page a small "← Canvas view" button leads back.

## Limits

- **External tools are links.** Work in Gradescope or publisher sites is not read; add it yourself with **+ To Do**.
- **Inbox** cannot read Brightspace mail. It links to Brightspace Email and lists recent announcements instead.
- **Estimated totals** come from graded items, ignore dropped-score rules and are not official.
- **Discussions in To Do** cannot tell whether you have already posted.
- **Not yet checked against real Brightspace:** quiz attempts, discussion posts, the course overview, the Inbox address, and the addresses of the pages the wrapper stands in for. The probe (below) checks the first three.

## Load it

- **Firefox (primary, 121 or later):** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `extension/manifest.json`. It is removed when Firefox closes; use **Reload** on that page after code changes. If the wrapper does not appear, open `about:addons`, select the extension, and under **Permissions** allow access to `brightspace.com`.
- **Chrome or Edge:** open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the `extension` folder. Chrome shows a harmless warning about `background.scripts`.

Then sign in to Brightspace and open its home page.

The toolbar button runs the **access probe**: it lists which Brightspace endpoints your session can read and offers a report (statuses and field names only, no personal data) to save into `fixtures/`.

## Develop without signing in

```
node tools/dev-server.js          # then open http://localhost:8765/d2l/home
node tests/data.test.js           # data-layer test against a stubbed Brightspace
powershell -File tools\shots.ps1  # opens every page in headless Chrome or Edge and checks it rendered
```

`tools/dev-server.js` runs the extension's scripts against a made-up Brightspace (`tools/fake-brightspace.js`) with invented courses and grades. `tools/shots.ps1 -Out <folder>` also saves a screenshot of each page listed in `tools/pages.json`; add `-Theme dark` for the dark theme.

## Layout

| Path | Role |
| --- | --- |
| `extension/src/client.js` | Talks to the Brightspace API: versions, paging, throttling, a two-minute cache |
| `extension/src/data.js` | Adapters that turn Brightspace responses into Canvas-shaped objects |
| `extension/src/ui-core.js` | Frame, navigation, trays, routing, preferences, shared helpers |
| `extension/src/ui-dashboard.js` | Dashboard views, all courses, all grades, the To Do sidebar |
| `extension/src/ui-course.js` | Every page inside a course |
| `extension/src/ui-calendar.js` | Calendar |
| `extension/src/styles.js`, `icons.js` | Look: light and dark themes, icons |
| `extension/probe.js` | Access probe, run from the toolbar button |
| `fixtures/` | Probe reports |
| `tools/`, `tests/` | Dev server, fake Brightspace, page check, data test |
| `docs/` | The plan, plus a reference pack on how Brightspace works (from a separate planner app; not used at runtime) |
