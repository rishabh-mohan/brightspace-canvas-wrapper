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
- **Card View** shows this term's courses. The ⋮ on a card sets a nickname and colour. Cards also show "N new" (see What's New) and when the course's last grade was posted, in red after two weeks.
- **List View** is a day-by-day planner where you can tick items off.
- **Recent Activity** shows new announcements and grades.
- **What's New** lists what appeared or changed since you last marked a course seen: new announcements, new or changed grades and feedback, new assignments, quizzes and discussions, changed due dates, and new or updated module content. Each item links to its page.
  - A What's New card in the sidebar shows the newest few.
  - Recent Activity lists the changes by course at the top, each with **Mark seen**, plus **Mark all seen**. Items listed there aren't repeated below.
  - The first visit only starts tracking, so nothing old floods in.
- **Dashboard Options** (⋮ at the top) switches between views and has these options:
  - **Color Overlay** and **Wide Cards**, for the course cards.
  - **Tasks Panel**: a weekly sidebar with completion rings per course. Dashboard Options also offers a three-day view, a limit on how many tasks each list shows, and a 24-hour clock. Finished work shows its score.
  - **Download course as .zip…**: pick one of the courses shown and all of its module files download as one .zip. Folders in the zip follow the modules. Links and external tools are listed in `links.txt`, and files that couldn't be downloaded in `failed.txt`. A course with no files says so.
- The sidebar has **To Do** (overdue first), **Recent Feedback** and a link to grades. **+ To Do** adds your own items.
- **Grades** (the sidebar's link to all grades) lists every course's total and when its last grade was posted.
  - **Semester GPA**: this term's courses with the letter each total works out to and the credit hours you type for each (3 until you change it; 0 leaves a course out). Letters follow the course's own grade scheme once you have opened that course's Grades page, otherwise common cut-offs, and the panel says which. Change a letter to try out a what-if. The GPA uses the standard US 4.0 scale (A 4.0, A- 3.7, B+ 3.3, …).
  - Enter your GPA and credit hours so far for a cumulative GPA too. Credits and your earlier GPA are kept in this browser; what-if letters are not saved.

**In a course**
- **Home**: recent announcements and the course's modules.
- **Modules**:
  - **Pin** any entry from the ⋮ on its left. Pinned entries show in a **Pinned** module at the top of Home and Modules.
  - **Course Home** comes next, with the instructor's Brightspace homepage and the syllabus.
  - Each module's own text and images are its first item.
  - Imported work gets **[Gradescope]** and **[Ed]** modules.
  - Files, tools and links open inside the page, with Previous and Next.
  - **Reorder modules**: the ⋮ on a module's header has Move up, Move down, Move to top and Move to bottom (sub-modules move within their parent; the ⋮ shows only when a move applies). The order is saved per course and used on Home and Modules; **Reset module order** under the list goes back to the course's order. Previous and Next keep the course's order.
- **Assignments**: assignments, quizzes and discussions together, by date or by type.
  - Each is marked Submitted, Late or Missing.
  - **Start Assignment** hands in files without leaving the page.
- **Assignment pages**: instructions, attached files, the rubric with your ratings, your submissions, and feedback with its files.
- **Quizzes**: attempts completed and remaining. **Take the Quiz** opens Brightspace's quiz page inside the wrapper.
- **Discussions**: threads, with your posts and unread posts marked. **Reply** posts from the page.
- **Grades**:
  - Each item shows its score, a Missing or Late label, and drop rules with the dropped scores struck through.
  - **What-If** scores let you try out grades; locked items say why they can't be changed. As in Canvas, an ungraded item stays out of the total until you type a score into it, so switching What-If on doesn't change the total by itself.
  - Options: **Calculate based only on graded assignments** and **Count items marked "not counted"**.
  - **What do I need?** (in the side panel): pick a grade to reach (a letter or a percentage) and what is left (one ungraded item such as the Final Exam, the rest of a group, or everything not yet graded). It works out the score you need, using the same weights, drop rules and options as the total, and your What-If scores when What-If is on. It says when the grade is already guaranteed or can't be reached. Letters follow the course's grade scheme when Brightspace lets students read it, otherwise common cut-offs (A 93, A- 90, …), and it says which.
  - **Last grade posted**: how long ago the newest grade in the course was posted, in red after two weeks.
  - Gradescope scores fill in where Brightspace has not posted one yet.
- **Announcements** (with Ed's too), **People**, **Files**, **Syllabus** (Simple Syllabus shown in place), and **Course Tools** (the tools on Brightspace's course bar, such as Class Progress).
- **Course menu** (☰): the course's own pages first. **See more** under them shows Brightspace's Course Tools (ending with **Brightspace Home**, the original course page), its other tool groups and the course's external tools. It stays open or closed as you left it, and opens by itself while you are on one of those pages.
- **Files** also has **Download all (.zip)** for the whole course. Files are fetched with your own sign-in, three at a time, with progress and **Cancel**, and the zip is built on your computer. A zip holds up to 65,534 files and 2 GB (it is built in memory). It asks before going past 500 MB, and again at each further 1 GB. Folder names in the zip are shortened to 40 characters so paths stay short on Windows.

**Calendar**: month and agenda views, a checkbox per course, your own To Do items, and a detail panel for exams and other events.
- **Export .ics** (in the Calendar page's ⋮ menu beside Refresh, or Account → Calendar export) downloads your upcoming deadlines as a calendar file: assignments, quizzes, discussions, your own To Do items, and Gradescope and Ed work when those are on. Untick courses to leave them out.
- Google Calendar (Settings → Import & export), Outlook and Apple Calendar can import it. Importing a newer file updates the events instead of adding them twice.
- It is a snapshot: export again to pick up changes. A live subscription link would need a server, which this extension doesn't have.

**Inbox**: Brightspace's Email, shown inside the page, with recent announcements underneath.

**Groups**: your groups, with course and members where Brightspace shows them.

**Every other Brightspace page** opens inside the wrapper, with the course menu beside it. **Without Canvas view** at the top shows it on its own.

**Also**:
- **Light, dark or automatic theme**: set under Account.
- **Search**: the Search button on the Dashboard, `s` anywhere, or Help → Search. One search: it lists module entries, files, assignments, quizzes, discussion topics, announcements, and Gradescope and Ed work in your current courses at once, then a moment later also finds words in instructions, feedback, discussion posts, syllabi, class lists and past courses, refining the results in place. Small typos are forgiven. With nothing typed, it lists what is due in the next two weeks.
  - **Search inside files** (off until you turn it on, at the bottom of the search box): reads the text of PDFs in your courses' Content, and reads scanned PDFs and images with OCR. Everything is read on your own computer and nothing is sent anywhere. The first time takes a while; after that only new or changed files are read. Scanned PDFs are read up to page 15, and files over 30 MB are skipped.
- **Keyboard shortcuts**: press `?` for the list.
- **Reminders** (off until you turn them on under Account): a browser notification before work is due (1 day and 1 hour before by default; you pick the times). The first time, the browser asks to allow notifications. Clicking a notification opens the item. Reminders use the deadlines from the last time you opened Brightspace with the extension. Not available in Firefox for Android, which doesn't give extensions notifications; Account shows a note there instead.
- **Toolbar badge**: the extension icon counts new grades and announcements.
- **Phone layout**: the pages adapt to phone width. Nothing scrolls sideways on 360–430 px screens, buttons are bigger to tap, text boxes don't make iPhones zoom in, edit and ⋮ buttons show without hovering, search results wrap and wide cards stack in one column.

## Gradescope, Ed Discussion and Edfinity

All three are off until you switch them on under **Account → Connected sites**.

**Gradescope** reads your Gradescope assignments, due dates and scores with your own Gradescope sign-in. In Firefox, press **Allow Gradescope access** the first time it asks.

**Ed Discussion** reads your Ed lessons, their due dates and Ed announcements.
- **Token:** it needs a personal Ed API token. Use the **Get a token on Ed** link next to the token field; Ed's token page is not in its settings menu, and Ed asks for two-factor authentication first.
- **Permission:** in Firefox, press **Allow Ed access** the first time it asks.
- **Course matching:** each Ed course is matched to a Brightspace course automatically. You can change that, or hide a course, on the Connected Sites page.

**Edfinity** shows your Edfinity assignments next to your Brightspace work: due dates (including extensions given to you), whether you have started or finished each one, and your score once Edfinity shows it to you.
- **Turning it on:** under Account → Edfinity, or on Connected sites. Your browser then asks once to allow `edfinity.com`.
- **Sign-in:** it uses your own Edfinity sign-in; no password or token. It reads two lists: your Edfinity courses and the assignments in each. With an Edfinity page open in another tab, it also reads them from that page, so it stays up to date even when the browser blocks the background read.
- **Course matching:** Edfinity courses are matched to Brightspace courses by course code. You can change any match on Connected sites.
- **Where it shows:** Tasks, To Do, and an "Edfinity" group on the course's Assignments page. An assignment that is also in Brightspace is shown once, with an "Edfinity" chip.
- Turning it off deletes everything it kept.

**The same assignment in more than one place** is shown once. Brightspace's copy is kept first, then Gradescope's, then Ed's, then Edfinity's, and the others become small "Gradescope", "Ed" and "Edfinity" links on it.
- **How matching works:** names match even when written differently ("HW 4", "Homework Assignment #4"), and the due dates must be within a day and a half.
- **Changing it:** on Connected Sites, link any item by hand (**Same as …**) or keep it apart (**Keep separate**).

## Privacy and what it changes

- **Where your data goes:** everything runs in your browser with your own sign-ins. Nothing is sent anywhere except Brightspace, and Gradescope, Ed and Edfinity if you switch them on. The extension collects no data.
- **What it keeps, and where:** preferences (including the GPA calculator's credit hours and earlier GPA), your own To Do items, your Ed token and recent Brightspace answers (kept to load pages faster) are stored in this browser only. So is What's New's snapshot of each course from your last visit (ids, dates and scores only; feedback comments are kept as a short hash, never titles or text). With **Reminders** on, the upcoming deadlines they use, a list of reminders already shown and the link each notification opens are kept as well; turning reminders off deletes them. If you turn on **Search inside files**, the text read from your course files is kept there too. With **Edfinity** on, the courses and assignments it read (names, dates, status and scores) are kept as well; turning it off deletes them. Signing out of Brightspace clears the kept answers, file text, What's New snapshots, the reminders' deadlines, shown list and links, and the Edfinity copy.
- **Notifications:** asked for only when you turn on Reminders, and optional. Your browser shows them; nothing is sent anywhere.
- **Downloads:** .ics calendar files and Download all zips are built on your own computer. The files in a zip come straight from Brightspace with your own sign-in; nothing passes through another server.
- **Changes to Brightspace:** it only changes anything when you press **Submit Assignment** or **Post Reply**. Quizzes and text-entry submissions use Brightspace's own pages, shown inside the wrapper.
- **Showing instructor content:** text from Brightspace (announcements, instructions, posts) is cleaned before it is shown. Only formatting, links and images are kept.

## Planned

- **Ed scores**: Ed records a score for each submission, but where it keeps them hasn't been confirmed. **Check Ed** on Connected Sites already inspects one completed lesson and its challenge submissions (field names and types only); its report would show which fields to read. Until then Ed work shows completion only, and Gradescope is the only outside site that fills in grades.

## Limits

- **Student view only:** there are no instructor pages.
- **Totals are estimates:** they follow the course's drop rules and settings but are not official until the instructor releases a final grade.
- **Text-entry submissions:** Brightspace's student submission route only accepts files, so these use Brightspace's own page (inside the wrapper).
- **Quiz scores before release:** these are not available, because some schools do not let students read their own quiz attempts.
- **Sign-in pages:** these always show on their own, never inside the wrapper.
- **Publisher sites** (MyLab, WebAssign and others): these may refuse to show inside a frame. Use "Open in a new tab", or add their work with **+ To Do**.

## For developers

```
node tools/dev-server.js           # made-up Brightspace, Gradescope, Ed and Edfinity at http://localhost:8765/d2l/home
node tests/data.test.js            # data-layer tests against a stubbed Brightspace
node tests/search.test.js          # search ranking and which files can be read
node tests/filetext.test.js        # search inside files: storage writes and download/OCR overlap
node tests/gradetools.test.js      # "What do I need?" solver and "last grade posted"
node tests/gpa.test.js             # Semester GPA calculator
node tests/ics.test.js             # calendar export (.ics)
node tests/reminders.test.js       # reminder scheduling (background)
node tests/whatsnew.test.js        # What's New snapshots and changes
node tests/zip.test.js             # Download all zip writer (also extracts a sample with PowerShell Expand-Archive when it is there)
node tests/modules-order.test.js   # the student's own module order
node tests/edfinity.test.js        # Edfinity reader: page data, course matching, grade states, background reads
powershell -File tools\shots.ps1   # opens every page in tools/pages.json in headless Chrome or Edge and checks it rendered
node tools/version.js 1.4.0        # sets the version (writes the manifest as plain UTF-8)
powershell -File tools\package.ps1 # builds the Firefox Add-ons zip, plus dist/chrome and a -chrome.zip for the Chrome Web Store / Edge Add-ons
node tools/chrome.js <folder> [--dev] # Chrome build only; --dev also runs it on the dev server
```

- **Screenshots:** `tools/shots.ps1 -Out <folder>` saves a screenshot of each page. Add `-Theme dark` for the dark theme.
- **Phone width:** `http://localhost:8765/__phone?w=390&to=/d2l/home%23/` shows a page at phone width.
- **Edfinity:** `/d2l/home?bsxedf=1#/connections`, `/d2l/home?bsxedf=1#/courses/103/assignments` or `/d2l/home?bsxedf=1&bsxtasks=1#/`. Add `&bsxedfperm=0` for the permission prompt or `&bsxedfout=1` for the signed-out state.
- **Loading the real extension against the dev server:** `node tools/dev-extension.js <folder>` writes a copy of the extension that also runs on localhost. For Chromium, `node tools/chrome.js <folder> --dev`, then start Edge with `--load-extension=<folder>` (Chrome no longer accepts that switch) and open pages with `?bsxreal=1`.
- **Checking a real account:**
  - The toolbar button runs the **access probe**. It reports which Brightspace endpoints your account can read, as statuses and field names only.
  - **Check Ed** on Connected Sites does the same for Ed.

| Path | Role |
| --- | --- |
| `extension/src/client.js` | Brightspace API: versions, paging, throttling, caching, the saved copy from the last visit, submissions and posts |
| `extension/src/data.js` | Turns Brightspace answers into Canvas-shaped data: courses, work, grades and estimates, modules, links on course pages |
| `extension/src/gradescope.js`, `ed.js` | Optional Gradescope and Ed readers |
| `extension/src/edfinity.js` | Optional Edfinity reader: shared parsing and matching, and the content script on edfinity.com |
| `extension/src/ui-core.js` | Frame, menus, routing, preferences, framed Brightspace pages, outside work and overlap folding |
| `extension/src/ui-dashboard.js` | Dashboard, Tasks Panel, Inbox, Groups, Connected Sites, all courses and grades |
| `extension/src/ui-course.js` | Every page inside a course |
| `extension/src/ui-calendar.js` | Calendar |
| `extension/src/search.js` | Search ranking (Fuse.js), snippets, upcoming due dates |
| `extension/src/filetext.js`, `extension/ocr/` | Search inside files: downloads PDFs and images, reads them in a hidden extension page (pdf.js, Tesseract OCR), keeps the text |
| `extension/src/whatsnew.js` | What's New: per-course snapshots, the diff, the Dashboard card and the Recent Activity section |
| `extension/src/zip.js` | Download all: zip writer (store only, CRC-32), file names, course picker and progress dialogs |
| `extension/src/modorder.js` | The student's own module order: applying it and moving modules |
| `extension/src/gradetools.js`, `gpa.js` | "What do I need?" solver and last grade posted; Semester GPA calculator |
| `extension/src/ics.js` | Calendar export: builds the .ics file (RFC 5545), the course filter dialog, the Account section |
| `extension/src/reminders.js`, `extension/reminders-bg.js` | Reminders: settings and deadline hand-off in the page; alarms and notifications in the background (loaded by background.js in Chrome, from the manifest in Firefox) |
| `extension/src/styles.js`, `icons.js` | Themes, layout, motion, icons |
| `extension/background.js` | Access probe; Gradescope, Ed and Edfinity requests; toolbar badge |
| `extension/fonts/` | Lato (SIL Open Font License) |
| `tools/`, `tests/`, `fixtures/` | Dev server and made-up sites, page check, data tests, probe reports |

## Credits

- **Tasks Panel:** its idea and layout follow [Tasks for Canvas](https://github.com/jtcheng26/canvas-task-extension) by jtcheng26 (MIT). It was written separately for Brightspace, with no code taken from that project.
- **Lato font:** by Łukasz Dziedzic, under the SIL Open Font License.
- **Confetti:** [canvas-confetti](https://github.com/catdad/canvas-confetti) 1.9.3 by Kiril Vatev (ISC licence), included unmodified as `extension/vendor/confetti.browser.js` from the published package, with its licence beside it.
- **Search:** [Fuse.js](https://www.fusejs.io/) 7.0.0 by Kiro Risk (Apache 2.0), as `extension/vendor/fuse.min.js`.
- **Reading files:** [pdf.js](https://mozilla.github.io/pdf.js/) 4.10.38 by Mozilla (Apache 2.0) in `extension/vendor/pdfjs/`; [Tesseract.js](https://tesseract.projectnaptha.com/) 5.1.1 and tesseract.js-core 5.1.1 (Apache 2.0) with the English `best_int` language data from `@tesseract.js-data/eng` 1.0.0 (Apache 2.0) in `extension/vendor/tesseract/`. All are included unmodified from the published npm packages, with their licences beside them.
- **Licence:** MIT. See [LICENSE](LICENSE).
