# Brightspace Canvas Wrapper

A Firefox (and Chrome/Edge) extension that shows your Brightspace courses in a Canvas-style layout: course cards, a To Do list, modules, assignments, grades with What-If scores, and a calendar. Optionally, it also pulls in your Gradescope and Ed Discussion work.

It works on any school's Brightspace (`*.brightspace.com`) with a student account, using your own sign-in. It is unofficial and not affiliated with D2L or Instructure.

## Install

- **Firefox, permanently:** install the signed version from Firefox Add-ons (your own link from the Developer Hub).
- **Firefox, for testing:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and pick `extension/manifest.json`. It is removed when Firefox closes.
- **Firefox for Android:** install the signed version from Firefox Add-ons.
- **Chrome or Edge:** run `powershell -File tools\package.ps1` (or `node tools/chrome.js dist/chrome`). Then open `chrome://extensions` (`edge://extensions` in Edge), turn on **Developer mode**, choose **Load unpacked**, and pick the `dist/chrome` folder. The Chrome build is the same extension with a Chrome-style manifest.

Needs Firefox 140 or later (Firefox for Android 142 or later), or Chrome or Edge 121 or later. Then sign in to Brightspace and open its home page.

If nothing appears in Firefox, open `about:addons`, choose the extension, and under **Permissions** allow brightspace.com.

## Using it

**Left menu:** Account, Dashboard, Courses, Groups, Calendar, Inbox, Help, and **Brightspace**, which switches back to plain Brightspace for this tab until you pick **Canvas view** again.

**Dashboard**
- **Card View** shows this term's courses. The â‹® on a card sets a nickname and colour.
- **List View** is a day-by-day planner where you can tick items off.
- **Recent Activity** shows new announcements and grades.
- **Dashboard Options** (â‹® at the top) switches between views and has these options:
  - **Color Overlay** and **Wide Cards**, for the course cards.
  - **Tasks Panel**: a weekly sidebar with completion rings per course.
- The sidebar has **To Do** (overdue first), **Recent Feedback** and a link to grades. **+ To Do** adds your own items.

**In a course**
- **Home**: recent announcements and the course's modules.
- **Modules**:
  - **Pin** any entry from the â‹® on its left. Pinned entries show in a **Pinned** module at the top of Home and Modules.
  - **Course Home** comes next, with the instructor's Brightspace homepage and the syllabus.
  - Each module's own text and images are its first item.
  - Imported work gets **[Gradescope]** and **[Ed]** modules.
  - Files, tools and links open inside the page, with Previous and Next.
- **Assignments**: assignments, quizzes and discussions together, by date or by type.
  - Each is marked Submitted, Late or Missing.
  - **Start Assignment** hands in files without leaving the page.
- **Assignment pages**: instructions, attached files, the rubric with your ratings, your submissions, and feedback with its files.
- **Quizzes**: attempts completed and remaining. **Take the Quiz** opens Brightspace's quiz page inside the wrapper.
- **Discussions**: threads, with your posts and unread posts marked. **Reply** posts from the page.
- **Grades**:
  - Each item shows its score, a Missing or Late label, and drop rules with the dropped scores struck through.
  - **What-If** scores let you try out grades; locked items say why they can't be changed.
  - Options: **Calculate based only on graded assignments** and **Count items marked "not counted"**.
  - Gradescope scores fill in where Brightspace has not posted one yet.
- **Announcements** (with Ed's too), **People**, **Files**, **Syllabus** (Simple Syllabus shown in place), and **Course Tools** (the tools on Brightspace's course bar, such as Class Progress).

**Calendar**: month and agenda views, a checkbox per course, your own To Do items, and a detail panel for exams and other events.

**Inbox**: Brightspace's Email, shown inside the page, with recent announcements underneath.

**Groups**: your groups, with course and members where Brightspace shows them.

**Every other Brightspace page** opens inside the wrapper, with the course menu beside it. **Without Canvas view** at the top shows it on its own.

**Also**:
- **Light, dark or automatic theme**: set under Account.
- **Search all courses**: the Search button on the Dashboard, `s` anywhere, or Help → Search all courses. Finds module entries, files, assignments, quizzes, discussion topics, announcements, and Gradescope and Ed work.
- **Keyboard shortcuts**: press `?` for the list.
- **Toolbar badge**: the extension icon counts new grades and announcements.
- **Phone layout**: the pages adapt to phone width.

## Gradescope and Ed Discussion

Both are off until you switch them on under **Account â†’ Connected sites**.

**Gradescope** reads your Gradescope assignments, due dates and scores with your own Gradescope sign-in. In Firefox, press **Allow Gradescope access** the first time it asks.

**Ed Discussion** reads your Ed lessons, their due dates and Ed announcements.
- **Token:** it needs a personal Ed API token. Use the **Get a token on Ed** link next to the token field; Ed's token page is not in its settings menu, and Ed asks for two-factor authentication first.
- **Permission:** in Firefox, press **Allow Ed access** the first time it asks.
- **Course matching:** each Ed course is matched to a Brightspace course automatically. You can change that, or hide a course, on the Connected Sites page.

**The same assignment in more than one place** is shown once. Brightspace's copy is kept first, then Gradescope's, then Ed's, and the others become small "Gradescope" and "Ed" links on it.
- **How matching works:** names match even when written differently ("HW 4", "Homework Assignment #4"), and the due dates must be within a day and a half.
- **Changing it:** on Connected Sites, link any item by hand (**Same as …**) or keep it apart (**Keep separate**).

## Privacy and what it changes

- **Where your data goes:** everything runs in your browser with your own sign-ins. Nothing is sent anywhere except Brightspace, and Gradescope and Ed if you switch them on. The extension collects no data.
- **What it keeps, and where:** preferences, your own To Do items, your Ed token and recent Brightspace answers (kept to load pages faster) are stored in this browser only. Signing out of Brightspace clears the kept answers.
- **Changes to Brightspace:** it only changes anything when you press **Submit Assignment** or **Post Reply**. Quizzes and text-entry submissions use Brightspace's own pages, shown inside the wrapper.
- **Showing instructor content:** text from Brightspace (announcements, instructions, posts) is cleaned before it is shown. Only formatting, links and images are kept.

## Planned

- **Ed scores**: Ed records a score for each submission, but where it keeps them hasn't been confirmed. **Check Ed** on Connected Sites already inspects one completed lesson and its challenge submissions (field names and types only); its report would show which fields to read. Until then Ed work shows completion only, and Gradescope is the only outside site that fills in grades.

## Limits

- **Student view only:** there are no instructor pages.
- **Totals are estimates:** they follow the course's drop rules and settings but are not official until the instructor releases a final grade.
- **Text-entry submissions:** Brightspace's student submission route only accepts files, so these use Brightspace's own page (inside the wrapper).
- **Quiz scores before release:** these are not available, because some schools (Purdue among them) do not let students read their own quiz attempts.
- **Sign-in pages:** these always show on their own, never inside the wrapper.
- **Publisher sites** (MyLab, WebAssign and others): these may refuse to show inside a frame. Use "Open in a new tab", or add their work with **+ To Do**.

## For developers

```
node tools/dev-server.js           # made-up Brightspace, Gradescope and Ed at http://localhost:8765/d2l/home
node tests/data.test.js            # data-layer tests against a stubbed Brightspace
powershell -File tools\shots.ps1   # opens every page in tools/pages.json in headless Chrome or Edge and checks it rendered
node tools/version.js 1.4.0        # sets the version (writes the manifest as plain UTF-8)
powershell -File tools\package.ps1 # builds the Firefox Add-ons zip, plus dist/chrome and a -chrome.zip for the Chrome Web Store / Edge Add-ons
node tools/chrome.js <folder> [--dev] # Chrome build only; --dev also runs it on the dev server
```

- **Screenshots:** `tools/shots.ps1 -Out <folder>` saves a screenshot of each page. Add `-Theme dark` for the dark theme.
- **Phone width:** `http://localhost:8765/__phone?w=390&to=/d2l/home%23/` shows a page at phone width.
- **Loading the real extension against the dev server:** `node tools/dev-extension.js <folder>` writes a copy of the extension that also runs on localhost. For Chromium, `node tools/chrome.js <folder> --dev`, then start Edge with `--load-extension=<folder>` (Chrome no longer accepts that switch) and open pages with `?bsxreal=1`.
- **Checking a real account:**
  - The toolbar button runs the **access probe**. It reports which Brightspace endpoints your account can read, as statuses and field names only.
  - **Check Ed** on Connected Sites does the same for Ed.

| Path | Role |
| --- | --- |
| `extension/src/client.js` | Brightspace API: versions, paging, throttling, caching, the saved copy from the last visit, submissions and posts |
| `extension/src/data.js` | Turns Brightspace answers into Canvas-shaped data: courses, work, grades and estimates, modules, links on course pages |
| `extension/src/gradescope.js`, `ed.js` | Optional Gradescope and Ed readers |
| `extension/src/ui-core.js` | Frame, menus, routing, preferences, framed Brightspace pages, outside work and overlap folding |
| `extension/src/ui-dashboard.js` | Dashboard, Tasks Panel, Inbox, Groups, Connected Sites, all courses and grades |
| `extension/src/ui-course.js` | Every page inside a course |
| `extension/src/ui-calendar.js` | Calendar |
| `extension/src/styles.js`, `icons.js` | Themes, layout, motion, icons |
| `extension/background.js` | Access probe; Gradescope and Ed requests; toolbar badge |
| `extension/fonts/` | Lato (SIL Open Font License) |
| `tools/`, `tests/`, `fixtures/` | Dev server and made-up sites, page check, data tests, probe reports |

## Credits

- **Tasks Panel:** its idea and layout follow [Tasks for Canvas](https://github.com/jtcheng26/canvas-task-extension) by jtcheng26 (MIT). It was written separately for Brightspace, with no code taken from that project.
- **Lato font:** by Łukasz Dziedzic, under the SIL Open Font License.
- **Confetti:** [canvas-confetti](https://github.com/catdad/canvas-confetti) 1.9.3 by Kiril Vatev (ISC licence), included unmodified as `extension/vendor/confetti.browser.js` from the published package, with its licence beside it.
- **Licence:** MIT. See [LICENSE](LICENSE).
