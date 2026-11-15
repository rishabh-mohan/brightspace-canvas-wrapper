# Canvas-style wrapper for Brightspace

A browser extension that shows your Brightspace courses in Canvas's layout. It changes things on Brightspace only when you press a button for it: **Submit Assignment** (hands in a file) and **Post Reply** (posts in a discussion). Taking a quiz and text submissions happen on Brightspace's own page, shown inside the wrapper.

Background and decisions: [docs/brightspace-vs-canvas-wrapper-plan.md](docs/brightspace-vs-canvas-wrapper-plan.md).

## What it does

**Global navigation** (left rail): Account, Dashboard, Courses, Calendar, Inbox, Help, and a Brightspace switch that shows the original page.

**Dashboard**
- Card View: this term's course cards with a colour, picture, shortcuts and unread badges. The â‹® button sets a nickname and colour.
- List View: a planner of dated work, grouped by day and opened on today. Items can be ticked off.
- Recent Activity: recent announcements and newly posted grades.
- Sidebar: To Do (overdue first, each item dismissible), Recent Feedback, View Grades.
- **+ To Do** adds your own item, for anything that lives outside Brightspace. Your items appear in To Do, List View and the Calendar.

**Courses**
- Home: recent announcements, modules, and a sidebar with View Course Stream (the course's recent announcements and grades), View Course Calendar, View Course Notifications, To Do and Recent Feedback.
- Announcements: searchable list and a page per announcement.
- Assignments: assignments, quizzes and discussions in one list, by date or by grade category, with search, submission status and an External Tools group.
- Assignment pages: instructions and attached files, the rubric (with your ratings, points and per-criterion comments once marked), your submitted files, your grade, and feedback comments and files. Every file downloads in place.
- **Start Assignment / New Attempt**: choose one file, add an optional comment, press Submit Assignment. It is sent to Brightspace's student submission route (one file per submission, as Brightspace allows) with the same short-lived token Brightspace's own pages use. Shown only for file-upload assignments that are open; "only one submission" assignments hide it once you have submitted. If Brightspace refuses, the page says why and links to the Brightspace page.
- Quiz pages: attempts completed and remaining (from Brightspace's quiz summary page where, as at Purdue, the attempts list is refused to students), time limit, availability, grade.
- Discussion pages: posts as a thread, with your own posts marked.
- Announcement pages include their attachments.
- Grades: every item with due date and score, group subtotals, the released total or a labelled estimate, group weights, What-If scores, Canvas's "Calculate based only on graded assignments" switch (untick to count ungraded work as zero), arranging by group, due date or title, and a course switcher.
- Modules, led by a **Course Home** module (the instructor's Brightspace course homepage, shown in a frame, and the syllabus), with each item opening inside the wrapper: files in a viewer, external tools in a frame, links as a card, each with Previous and Next.
- Syllabus: the course's syllabus tool (Simple Syllabus at Purdue) shown in place, found as a Content link or on the course navigation bar, then the course overview and a summary of dated work.
- People, Files, Quizzes, Discussions.

**Calendar**: month and agenda views, a checkbox per course, and your own To Do items.

**Inbox**: Brightspace's own Email tool shown in a frame, with recent announcements underneath.

**Gradescope** (optional, off by default; Account â†’ Gradescope; in Firefox, the first time, press **Allow Gradescope access** where it appears and allow gradescope.com): for courses with a Gradescope link, reads your Gradescope assignments, due dates and scores and shows them in Assignments, Grades, To Do, List View and the Calendar. It uses your own Gradescope sign-in, reads two kinds of page, and changes nothing there. Open Gradescope once from a course if it says you are signed out.

**Preferences** (Account): light, dark or automatic theme, and whether to show current courses or all. Preferences and your To Do items are stored in the extension, in this browser only.

**Groups** (left rail): the groups you belong to, with their course, category and members where Brightspace lets a student see them.

**Keyboard shortcuts**: press `?` for the list (`g` then `d`/`c`/`l`/`i`/`g`/`p` to jump, `/` to search, `j`/`k` to move through items, `[`/`]` for module items, `r` to refresh).

**Toolbar badge**: the extension icon counts new grades and announcements since you last opened the Dashboard.

**Look and motion**: set in Lato, Canvas's typeface (bundled in `extension/fonts/` under the SIL Open Font Licence). Canvas-style Dashboard Options menu (views and colour overlay), flash alerts for actions, grey placeholder bars while data loads, and short transitions on trays, dialogs, menus and collapsing groups. All motion is switched off when the system asks for reduced motion.

**Speed**: the last answer from each Brightspace address is kept in extension storage (this browser only, up to a week, about 4 MB), so pages appear at once from your previous visit while fresh data loads; the page redraws in place if anything changed. Refresh always waits for Brightspace. Signing out of Brightspace clears the kept copy.

**Every other Brightspace page opens inside the wrapper**: quiz pages, discussion pages, Brightspace's own tools, and every "Open in Brightspace" link show in a frame under Canvas's navigation, with Brightspace's own top bar hidden. Opening such a page directly (a bookmark, an email link) goes to the wrapper with that page inside. **Without Canvas view** at the top shows the page on its own. Sign-in pages and quiz attempts in progress are never wrapped.

**Discussions**: Reply and threaded replies are posted to Brightspace from the discussion page.

**Calendar**: events that are not assignments (exams, office hours) open a detail panel with time, place and description.

The wrapper stands in for the Brightspace home page, course home pages, and Brightspace's own Grades, Assignments, Announcements, Quizzes, Discussions, Classlist and Content list pages. On every other Brightspace page a small "â† Canvas view" button leads back. The layout adapts down to phone width.

## Scope and limits

- **Student view only.** There are no instructor pages (gradebook editing, SpeedGrader, course settings): they need an instructor role and would have to write to Brightspace.
- **Other external tools are frames or links.** Only Gradescope is read. Publisher sites (MyLab, WebAssign and so on) open in a frame or a new tab; add their work yourself with **+ To Do**.
- **Estimated totals** come from graded items, apply each group's drop-lowest and drop-highest rules, and are not official.
- **No wiki pages.** Brightspace has none; HTML pages in Content open in the file viewer.

## What has been checked, and how

| Checked | How |
| --- | --- |
| Every page and interaction renders | Headless Chrome against the made-up Brightspace (`tools/shots.ps1`) |
| The extension itself loads and runs in Firefox and Edge | Installed as a temporary add-on (Firefox 160 via `web-ext`, Edge via `--load-extension`) against the made-up Brightspace |
| Brightspace API routes and fields | Your probe report in `fixtures/` for most; D2L's API documentation for quiz attempts, discussion posts, course overview and topic files |
| Brightspace page addresses for Announcements, Classlist, Discussions, Content, course home and Email | A university's published list of Brightspace link templates ([University of Limerick](https://ul.ie/node/82179)) |
| Gradescope page structure | The public `gradescope-api` project's parser, and a made-up Gradescope in the dev server |

Not yet checked on a real account: finding the Simple Syllabus and notification-settings links on a course home page (the probe now reports both), the wording of the quiz summary page (the probe now records its attempt labels with digits masked), submitting a file (the request follows D2L's documented format and is exercised against the made-up Brightspace), rubric and feedback-file fields on a marked assignment, the student addresses of Brightspace's Grades, Assignments and Quizzes list pages, whether Brightspace and external tools allow being shown in a frame, and the Gradescope reader against real Gradescope. Each has a fallback: a page that is not recognised stays as plain Brightspace, and every frame has an "open in a new tab" button.

## Load it

- **Firefox (primary, 140 or later; Firefox for Android 142 or later):** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-onâ€¦**, and select `extension/manifest.json`. It is removed when Firefox closes; use **Reload** on that page after code changes. If the wrapper does not appear, open `about:addons`, select the extension, and under **Permissions** allow access to `brightspace.com` (and `gradescope.com` if you switch the Gradescope reader on).
- **Chrome or Edge:** open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the `extension` folder. Chrome shows a harmless warning about `background.scripts`.

Then sign in to Brightspace and open its home page.

The toolbar button runs the **access probe**: it lists which Brightspace endpoints your session can read and offers a report (statuses and field names only, no personal data) to save into `fixtures/`.

## Develop without signing in

```
node tools/dev-server.js          # then open http://localhost:8765/d2l/home
node tests/data.test.js           # data-layer test against a stubbed Brightspace
powershell -File tools\shots.ps1  # opens every page in headless Chrome or Edge and checks it rendered
```

- `tools/dev-server.js` runs the extension's scripts against a made-up Brightspace and Gradescope (`tools/fake-brightspace.js`) with invented courses and grades.
- `tools/shots.ps1 -Out <folder>` also saves a screenshot of each page listed in `tools/pages.json`; add `-Theme dark` for the dark theme.
- `http://localhost:8765/__phone?w=390&to=/d2l/home%23/` shows a page at phone width.
- `node tools/dev-extension.js <folder>` writes a copy of the extension that also runs on `localhost`. Load that copy in a browser (for Firefox: `web-ext run --source-dir <folder>`) and open pages with `?bsxreal=1` to exercise the real extension against the made-up Brightspace. `http://localhost:8765/__status` lists what each opened page reported.

## Layout

| Path | Role |
| --- | --- |
| `extension/src/client.js` | Talks to the Brightspace API: versions, paging, throttling, a two-minute cache, answers kept from the last visit |
| `extension/src/data.js` | Adapters that turn Brightspace responses into Canvas-shaped objects |
| `extension/src/gradescope.js` | Optional Gradescope reader |
| `extension/src/ui-core.js` | Frame, navigation, trays, routing, preferences, shared helpers |
| `extension/src/ui-dashboard.js` | Dashboard views, Inbox, all courses, all grades, the To Do sidebar |
| `extension/src/ui-course.js` | Every page inside a course |
| `extension/src/ui-calendar.js` | Calendar |
| `extension/src/styles.js`, `icons.js` | Look: light and dark themes, icons |
| `extension/background.js` | Runs the probe; fetches Gradescope pages for the reader |
| `extension/probe.js` | Access probe, run from the toolbar button |
| `fixtures/` | Probe reports |
| `tools/`, `tests/` | Dev server, made-up Brightspace, page check, data test |
| `docs/` | The plan, plus a reference pack on how Brightspace works (from a separate planner app; not used at runtime) |
