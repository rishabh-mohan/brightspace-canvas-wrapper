# Changelog

All changes after **1.4.0** (`762f3f8`) through **1.5.24** (`40c275d`), newest first. Includes every intervening commit, including changes without a version bump, diagnostics, tests, packaging and documentation. Reverted behavior is retained here as release history. Version 1.4.0 itself is the baseline and is not included.

## 1.7.0

- Added **module reordering**: a module's three-dot menu has Move up, Move down, Move to top and Move to bottom (the menu shows only when a move applies); sub-modules move within their parent, Pinned stays first. The order is saved per course (`settings.moduleOrder`) and used on Home and Modules, with **Reset module order** under the list; modules added later keep their place after the module they follow in Brightspace. Previous/Next keep Brightspace's order.
- Added **What's New** on the Dashboard: what appeared or changed in each course since it was last marked seen (new announcements, new or changed grades and feedback, new assignments, quizzes and discussions, changed due dates, new or updated module content). A sidebar card shows the newest few, course cards show "N new", and Recent Activity lists the changes by course with **Mark seen** and **Mark all seen**. The first visit only starts tracking. Snapshots are stored per site under `bsxSeen:<host>` and hold ids, dates and scores only; feedback comments are kept as a short hash.
- Added **Download all**: a whole course (from the Dashboard's three-dot menu, **Download course as .zip…**, which lists the courses shown, or from the Files page) is saved as one .zip built on the student's computer; a course with no files says so. Files are fetched with the student's sign-in three at a time, with progress and Cancel; folders follow the modules (names shortened to 40 characters); links and external tools go in links.txt and failed downloads in failed.txt. Up to 65,534 files and 2 GB per zip, held in memory, with a confirmation at 500 MB and again at every further 1 GB.
- Added **Export .ics** in the Calendar page's ⋮ menu (beside Refresh) and under Account → Calendar export: upcoming assignments, quizzes, discussions, the student's own To Do items, and Gradescope and Ed work when enabled, with a per-course filter. Stable event UIDs mean re-importing updates events instead of duplicating them; deadlines are zero-length events (DTEND equals DTSTART).
- Added **Reminders** under Account, off by default: browser notifications before work is due (1 day and 1 hour before by default, configurable), which open the item when clicked. The page hands upcoming deadlines (`bsxDeadlines`) to the new background script `reminders-bg.js`, which schedules them with alarms and records what was shown (`bsxNotified`, `bsxNotifyUrls`). Turning reminders off deletes these. Firefox for Android has no extension notifications, so Account shows a note there instead.
- New permissions: `alarms` (schedules reminders; no install-time warning) and optional `notifications`, requested only when Reminders are turned on.
- Added an **Edfinity** reader, off by default (Account → Edfinity, or Connected sites): Edfinity assignments with the student's own due dates (including extensions), progress and scores, in Tasks, To Do and an "Edfinity" group on the course Assignments page. Edfinity courses are matched to Brightspace courses by course code (editable on Connected sites), and an assignment also in Brightspace is shown once with an "Edfinity" chip (**Keep separate** undoes it). It uses the student's own Edfinity sign-in and is read-only: the background script makes GET requests to three JSON paths only (`/registrations`, `/registrations/<id>`, `/registrations/<id>/assignments`), at most 6 course lists at a time with a 5-minute cache, and a content script on edfinity.com, idle unless the reader is on, reads the same lists from an open Edfinity page (at most every 10 minutes) without changing it. The copy is kept in `bsxEdfinity` and deleted when the reader is turned off or on signing out.
- New optional host permission `https://edfinity.com/*`, requested only when Edfinity is turned on, plus the content script on edfinity.com.
- Grades: added **What do I need?**, which works out the score needed on one ungraded item, the rest of a group or all remaining work to reach a target letter or percentage, following weights, drop rules, What-If scores and the graded-only and not-counted options. It uses the course's grade scheme when students can read it, else common cut-offs (A 93, A- 90, …), and says which.
- What-If now works like Canvas: an ungraded item stays out of the total until a score is typed into it, so turning What-If on no longer changes the total. The "based only on graded assignments" option stays available during What-If, What-If boxes start blank with a placeholder, and typed scores survive redraws.
- Bonus items outside any category (and bonus items in a Points gradebook) now add to the total instead of being ignored.
- Added a **Semester GPA** calculator on the all-courses Grades page: letters from each course's total (try others), credit hours typed per course (3 by default; 0 leaves a course out), the standard US 4.0 scale, and an optional cumulative GPA from the earlier GPA and credits. A course's own grade scheme is used once its Grades page has been opened, otherwise common cut-offs, and the panel says which. Credits and the earlier GPA are saved in settings (`settings.gpa`); what-if letters are not. Typing something a credits box can't read (such as "e") no longer silently drops that course; the saved hours stay until the box holds a valid number.
- Added "Last grade posted N days ago" on course cards, the all-courses Grades list and each course's Grades page, in red after two weeks, from grade data already loaded.
- The all-courses Grades note no longer says estimates ignore drop rules (they follow them).
- Search: Ctrl+K no longer opens it; use `s`, the Dashboard's Search button or Help → Search. One search lists current-course results at once, then a moment later also finds words in instructions, feedback, discussion posts, syllabi, class lists and past courses, refining the results in place.
- Signing out of Brightspace now also clears the What's New snapshots, the reminder data and the Edfinity copy (`bsxSeen:<host>`, `bsxDeadlines`, `bsxNotified`, `bsxNotifyUrls`, `bsxEdfinity`).
- Performance, data: Brightspace refusals (403/404) are cached for the normal two minutes instead of being asked again on every redraw (77 instead of 83 requests in the data test); each answer is serialized once; an unchanged answer no longer rewrites stored data (its date is refreshed at most hourly); discussions ask for the user and the topic list at the same time; Gradescope's account page is parsed once per fetch.
- Performance, search: lower-cased copies of titles and text are made once per search index instead of on every keystroke, and upcoming work parses each date once. Search inside files writes its stored text at most every 10 seconds (plus once at the end and when the page is closed) instead of after every file, downloads the next file while the current one is read, and releases OCR canvases.
- Performance, pages: settings load once; outside work (Gradescope and Ed) is fetched once per load; fonts load only while the wrapper is shown; the toolbar badge is debounced; sorts parse dates once; the card editor, Tasks Panel week changes and the Calendar's Month/Agenda switch redraw only their part; arrow keys in the search dialog move the highlight without searching again, with an adaptive search debounce; What-If does one grade calculation per keystroke.
- Performance, requests: checks of answers already shown from storage now wait behind requests that have nothing to show yet, so a deep search's hundreds of background checks no longer hold up the page being opened; deep search reads quizzes without their attempt count, saving two uncached requests per quiz.
- Fixed small buttons (What's New's Mark seen, Show more and See all, Reminders' test button, and the Tasks Panel's Show more) drawing at full button size.
- Fixed the "also in …" chips on Brightspace assignments staying after every outside reader (Gradescope, Ed, Edfinity) was turned off; this also affected Gradescope and Ed before Edfinity was added.
- Phone layout: no sideways scrolling at 360–430 px widths; larger tap targets; 16 px text boxes, so iPhones no longer zoom in on them; edit and ⋮ buttons always shown on touch screens, which have no hover; search results wrap instead of running off the screen; wide cards stack in one column.
- Course menu (☰): only the course's own pages show at first. **See more** under them (a link with a chevron, `aria-expanded`, saved as `settings.navMore`) shows Brightspace's tool groups and the course's external tools; it opens by itself while one of those pages is shown, and hides when there is nothing behind it. The separate "Brightspace" heading is gone: **Brightspace Home** now ends the Course Tools group (made when Brightspace has none). Phones: the Brightspace button at the foot of the rail is no longer hidden under the browser's toolbar (the rail is held to the visible height, `100dvh`, instead of `100vh`).
- Groups: a group with more than 20 members shows the first 20 and a **See N more** link for the rest.
- Phones: the page header keeps Refresh on the same row as its buttons; on the Calendar, To Do, Today, ⋮ and Refresh share one row and the month arrows sit with Month/Agenda on the next. Opening the course menu (☰) while scrolled down now scrolls up to it (it used to open out of sight, so it looked as if it had not reopened). Three-dot menus are kept inside the screen instead of running off its right edge.
- Tests: added edfinity, filetext, gradetools, gpa, ics, reminders, whatsnew and zip tests; data and search tests gained assertions for refused answers, unchanged saved answers, sign-out cleanup and search copies.

## 1.6.0 — `61cf5cc`

- Search opens with Ctrl+K (⌘K on a Mac) on any page, as well as `s`; Help and Account now point to it.
- Results are ranked with Fuse.js: small typos are forgiven and titles come first; matches that only work by forgiving typos rank after results with every word as typed.
- With nothing typed, search lists work due in the next two weeks.
- New, off until turned on (Account, or the bottom of the search box): **Search inside files** reads course PDFs' text, and scanned PDFs and images with OCR (Tesseract), on the student's computer. The text is kept so each file is read once, and cleared when turned off or on signing out.
- Bundled unmodified: Fuse.js 7.0.0, pdf.js 4.10.38, Tesseract.js 5.1.1 with tesseract.js-core 5.1.1 and English data (Apache 2.0).

## 1.5.24 — `40c275d`

- Reverted all Wide Cards layout changes from 1.5.21–1.5.23, restoring 1.5.20 behavior.

## 1.5.23 — `5b9ab9a`

- Displayed the whole course banner without cropping at normal card height, filling spare space with the course color. Reverted in 1.5.24.

## 1.5.22 — `24a749a`

- Removed the extra-tall Wide Cards image treatment so images used normal card height. Reverted in 1.5.24.

## 1.5.21 — `1107f0c`

- Made Wide Cards use one column on narrow screens and constrained card width to prevent horizontal overflow. Reverted in 1.5.24.

## Documentation after 1.5.20 — `5f3355d`

- Added PRIVACY.md describing data access, browser storage, request destinations, permissions, user choices and contact details.
- This was documentation only; it did not add data collection or change permissions. Ed score reading remains diagnostic work, not a completed grade-import feature.

## 1.5.20 — `3334377`

- Shortened the generated Chrome/Edge manifest description to fit the Chrome Web Store's 132-character limit, with a validation guard. Firefox's description is unchanged.

## 1.5.19 — `57e207d`

- Moved the 24-Hour Clock toggle back to Dashboard Options, directly beneath Tasks Panel. Three-Day View and task-list limits remain in the Tasks Panel menu.

## 1.5.18 — `6548e1e`

- Moved Three-Day View, task-list limits and the clock option into a three-dot Task options menu beside the panel's plus button.
- Added styling for the panel's grouped header controls. The clock option moved again in 1.5.19.

## 1.5.17 — `a311c2d`

- Show available scores on completed tasks, including earned and possible points.
- Added Three-Day View with previous/next three-day navigation.
- Added per-list limits of all, 10 or 5 tasks and a Show more button; changing periods resets expansion.
- Added a saved 24-Hour Clock preference that updates shared date/time formatting across the interface; otherwise the browser's clock convention is used.
- Persisted the new preferences and documented the features in the README. These options initially appeared in Dashboard Options.

## 1.5.16 — `1db1384`

- Added a dedicated Chrome/Edge build through tools/chrome.js: service-worker background, no Firefox-only manifest keys, minimum Chromium version 121 and unlimitedStorage for the page cache.
- Added a --dev build option for localhost testing.
- Packaging now produces the Firefox ZIP, dist/chrome directory and separate -chrome.zip.
- Made Gradescope and Ed access messages browser-neutral.
- Updated installation, browser requirements, packaging and development instructions. The additional storage permission applies only to the generated Chrome/Edge build; Firefox permissions did not change.

## Changelog added after 1.5.15 — `b6e1183`

- Added the original version notes covering 1.4.1–1.5.15. Later releases extended them.

## 1.5.15 — `0e6adcc`

- Recalculate category rows immediately when What-If scores change.
- Calculate weighted overall estimates from category grades multiplied by category weights, including drop-rule effects.
- Added category-row update styling and adjusted grade-calculation regression coverage.

## 1.5.14 — `b551ba8`

- Initialize blank What-If grades to zero and count them, allowing drop rules to treat them like other scores.
- Updated What-If controls to reflect those initial values.

## 1.5.13 — `c5f8261`

- Treat empty items as the lowest scores when applying What-If drop rules.
- Corrected category-weight handling when a simulated drop replaces a Brightspace drop, preventing inflated category estimates.
- Added regression cases for empty grades and replacement drops.

## 1.5.12 — `e9d8e3d`

- Honor Brightspace's Dropped! mark even when the item has no score, so it does not count as an ungraded zero.

## 1.5.11 — `d7bb414`

- Preserve Brightspace's dropped items when other What-If scores change.
- Editing a dropped score brings it back into consideration and moves the drop to the next-lowest eligible item.
- Added regression coverage for preserved and reassigned drops.

## 1.5.10 — `c6a5ab9`

- Restore the category's normal item weight for items Brightspace reports as dropped with zero share, so What-If drop rules still work after edits.
- Added regression coverage for edited scores in categories with existing Brightspace drops.

## 1.5.9 — `eb8dee8`

- Prefer Brightspace's reported weight achieved for items and categories where available, preserving adjustments and caps that raw points do not explain.
- Read Dropped! markers from Brightspace's Grades page.
- Simplified category headings to the drop rule; item-level dropped labels remain.
- Added a note that calculated estimates can differ slightly from Brightspace.
- Expanded the access probe with Grades-page drop-row counts and structure, without grade names or scores.
- Added regression coverage for reported weighted totals.

## 1.5.8 — `3e16807`

- Prefer drops reported by Brightspace over inferred category drop rules.
- Label whether Brightspace or the category rule dropped an item.
- Initially listed dropped item names in category headings; that heading treatment was removed in 1.5.9.
- Expanded the access probe with counts of zero-weight graded items and names of drop-related fields, without score values.
- Added regression coverage for Brightspace-reported drops.

## 1.5.7 — `dc9b687`

- Redistribute dropped items' weight among retained items in weighted gradebooks, correcting displayed totals and What-If estimates.
- Added regression coverage for weighted drop calculations.

## 1.5.6 — `5998615`

- Display and count categories that expose only a released total, without individual grades.
- Mark items in categories excluded from the final grade as not counted.
- Weight ungraded items according to their category's manual, points-based or equal distribution.
- Added regression coverage for category-only totals, exclusions and weight distribution.

## 1.5.5 — `7fff57a`

- Update task completion without redrawing the whole page: the Tasks Panel repaints locally and List View updates the affected row.
- Switch Unfinished/Completed tabs within the panel without a full-page redraw.
- Animate progress rings from their previous values rather than restarting from zero.
- Preserve completion reported by the source site when handling manual checkmarks.
- Added a save-without-render option for completion flags.

## 1.5.4 — `b10edd9`

- Shortened confetti firing from 15 seconds to 5 seconds, with time afterward for remaining particles to fall.

## 1.5.3 — `36efd71`

- Shortened search result type labels; internal Brightspace types fall back to Content.
- Truncate long labels instead of allowing overlap.
- Historical-note correction: the old changelog also claimed a Grades-page rendering fix here, but this commit changes only search labels, search styling and the version; no such fix is attributed to this release.

## 1.5.2 — `db584be`

- Changed confetti to side cannons using the week's course colors, initially firing for 15 seconds.
- Attach search dialogs, confetti and calendar event panels directly to the wrapper's app element.
- Keep Help's search reference in the keyboard-shortcut list rather than a separate Help entry.
- Extended development status reports with the open dialog label and search-result count.

## Documentation after 1.5.1 — `bff07cd`

- Credited canvas-confetti in the README and repaired characters corrupted by an earlier PowerShell save.

## 1.5.1 — `c97b04e`

- Replaced the initial confetti effect with locally bundled, unmodified canvas-confetti 1.9.3.
- Added its ISC license and attribution; load the library as an extension content script.
- Render confetti on a canvas without a worker and continue respecting reduced motion.
- Added a development-server fx:confetti action to trigger the effect for inspection.

## 1.5.0 — `2afa866`

- Added search across current courses through the Dashboard Search button and s keyboard shortcut.
- Search module entries/files, assignments, quizzes, discussions, announcements and imported Ed/Gradescope work, using the wrapper's data readers and cache.
- Match all query words against searchable text, course/context and type; prioritize title matches and show up to 60 results.
- Avoid duplicate module entries for work already represented as assignments, quizzes or discussions.
- Added arrow-key selection, Enter to open, Escape/backdrop to close, loading/empty/error states and course-colored results.
- Open imported work in a new tab and route supported module content through the module viewer.
- Added search styling, keyboard-shortcut documentation and an initial Help entry, later simplified in 1.5.2.

## 1.4.9 — `1f7f222`

- Added a celebration when all tasks in the displayed week are complete, with a saved marker to suppress repeat celebrations for the remembered period.
- Respect the system's reduced-motion preference.
- Added the initial effect styling and persisted celebration state. The rendering implementation was replaced in 1.5.1.

## 1.4.8 — `f0456c2`

- Allow pinning imported Ed and Gradescope entries through their item menus.
- Include those entries in the Pinned module, resolving their saved external IDs against imported work.

## 1.4.7 — `ece94eb`

- Use plural names for grouped Ed modules, such as Homeworks, Exams and Weeks.

## 1.4.6 — `cae2e55`

- Put only Other first in Ed module grouping; unknown module kinds, such as Week, follow Lessons.

## 1.4.5 — `32a85f2`

- Group Ed modules by kind: Other, Exams, Projects, Homework and Lessons.
- Combine numbered modules under a shared parent heading, such as Homework 1 and Homework 2 under Homework.
- Replace the earlier global module-index ordering with grouped presentation while preserving lesson order within modules.
- Adjusted Ed ordering tests and development fixtures to match.

## 1.4.4 — `2749777`

- Order Ed submodules by the first lesson's course-wide index, matching Ed's ordering more closely.
- Added an ordering regression case. Module-group ordering was subsequently changed in 1.4.5.

## 1.4.3 — `e26de06`

- Display Ed modules as submodules of [Ed] and retain source ordering information.
- Preserve Gradescope's assignment table order in [Gradescope].
- Updated Ed fixtures with module IDs, lesson indexes and an undated reading; added ordering coverage.

## 1.4.2 — `b8ca69b`

- Add Pin/Unpin menus to module entries and a Pinned module above Course Home on Home and Modules.
- Persist pins per course, preserve pin order and omit entries that no longer exist.
- Added pin-menu and pinned-state screenshot scenarios.
- Documented pinning and clarified that Ed score importing is planned; Ed currently contributes completion data, while Gradescope can fill grades.

## Diagnostic update after 1.4.1 — `59ea351`

- Expanded Check Ed to inspect one completed/attempted lesson's details and a challenge's submissions to investigate score-field locations.
- Reports response shapes and slide types rather than submission scores or contents.
- Added narrowly allowed read-only background routes for lesson details and challenge submissions. This does not implement Ed score importing.

## 1.4.1 — `c21d22f`

- Make the course menu visibly collapse on phone layouts.
- Position dropdown menus toward available space so Dashboard Options clears the left navigation rail.
- Place the total-grade summary above the grade list on narrow screens.

## Review scope

- Every numbered release above also updates extension/manifest.json to that version.
- Firefox host/API permissions, minimum Firefox versions and data-collection declaration are unchanged from 1.4.0. The only additional Firefox manifest script is the bundled confetti library.
- This changelog describes repository history, not a claim that every version was published or that real-account testing was repeated for this documentation update.
