# Canvas-style wrapper for Brightspace

A browser extension that shows Brightspace data in a Canvas-style layout. Read-only: it never submits or changes anything. Plan: [docs/brightspace-vs-canvas-wrapper-plan.md](docs/brightspace-vs-canvas-wrapper-plan.md).

## What works

- **Dashboard** on the Brightspace home page: this term's course cards, a To Do list for the next 14 days (ungraded, not yet turned in), overdue items, and recent announcements.
- **Calendar**: a month view across this term's courses.
- **Grades** per course: items grouped by category, with the instructor's released total or a labelled estimate, and **What-If scores** to try hypothetical grades.
- **Assignments** per course: assignments and quizzes merged into one list, split into upcoming, undated and past, with submission status.
- **Announcements** per course, with instructor HTML reduced to plain formatting and links.
- **Modules** per course, from Brightspace Content, plus links to external tools such as Gradescope.
- **Preferences**: light, dark or automatic theme (left rail), and a nickname and colour per course (the ⋮ button on each card). Stored in the extension, not on Brightspace.

The wrapper also stands in for Brightspace's own Grades, Assignments and Announcements pages. Everything else (quizzes, discussions, viewing content, submitting work) opens the original Brightspace page. The **Brightspace** button in the left rail shows the original page; the **Canvas view** pill brings the wrapper back.

## Load it

- **Firefox (primary, 121 or later):** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `extension/manifest.json`. It is removed when Firefox closes, so reload it each session; use **Reload** on that page after code changes. If the wrapper does not appear, open `about:addons`, select the extension, and under **Permissions** allow access to `brightspace.com`.
- **Chrome or Edge:** open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the `extension` folder. Chrome shows a harmless warning about `background.scripts`.

Then sign in to Brightspace and open its home page.

## Layout

| Path | Role |
| --- | --- |
| `extension/src/client.js` | Talks to the Brightspace API: versions, paging, throttling, a two-minute cache |
| `extension/src/data.js` | Adapters that turn Brightspace responses into Canvas-shaped objects |
| `extension/src/ui.js`, `styles.js` | The Canvas-style interface |
| `extension/probe.js` | Access probe, run from the toolbar button; reports which endpoints the session can read |
| `fixtures/` | Probe reports (statuses and field shapes only, no personal data) |
| `tests/data.test.js` | Data-layer test against a stubbed Brightspace: `node tests/data.test.js` |
| `docs/` | The plan, plus a reference pack on how Brightspace works (from a separate planner app; not used at runtime) |
