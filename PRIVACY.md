# Privacy policy

**Brightspace Canvas Wrapper** is an unofficial browser extension that shows your Brightspace courses in a Canvas-style layout. It is not made by or connected to D2L, Instructure, Gradescope, Ed or Edfinity.

Last updated: 25 November 2026.

## What it reads

When you open Brightspace, the extension reads your course data (courses, due dates, grades, announcements, files, discussions, quizzes and similar pages) from your school's Brightspace site, using the sign-in you already have. It shows that data in its own layout on the same page.

If you switch them on, it also reads:

- **Gradescope:** your assignments, due dates and scores, using your own Gradescope sign-in.
- **Ed Discussion:** your courses, lessons, announcements and scores, using an API token you paste in yourself.
- **Edfinity:** your Edfinity courses and their assignments (names, due dates including your extensions, status and scores), using your own Edfinity sign-in. It reads two JSON lists from `edfinity.com` (your courses, and the assignments in one course), at most 6 courses at a time, keeping each answer for 5 minutes. On Edfinity pages, a small script reads the same lists from the page itself, at most every 10 minutes, plus the assignment you have open; it does not change the page.
- **Your course files (Search inside files):** the PDFs and images in your courses' Content, downloaded from Brightspace with your sign-in. Their text is read on your own computer (scanned pages and images with OCR) so search can find words inside them. The files and their text never leave your computer.

## What it stores

Everything is stored in your own browser, using the browser's extension storage:

- your settings, pins, nicknames and course colours, including the credit hours and earlier GPA you enter in the GPA calculator;
- your own To Do items and ticked-off tasks;
- your Ed API token, if you add one;
- recent Brightspace pages and answers, kept so pages load faster. Signing out of Brightspace clears these;
- a snapshot of each course from your last visit (item ids, dates and scores; feedback comments only as a short hash, never titles or text), so What's New can show what changed. Signing out of Brightspace clears it;
- if you turn on Reminders: your reminder settings, the upcoming deadlines they use (title, course, due date and link), a list of reminders already shown so none is shown twice, and the link each notification opens. Turning Reminders off, or signing out of Brightspace, clears all but the settings;
- the text read from your course files, if you turn on Search inside files. Turning it off, or signing out of Brightspace, clears it;
- the Edfinity courses and assignments it read, if you turn on Edfinity. Turning it off, or signing out of Brightspace, clears them.

Course grade schemes, read from Brightspace when a course lets students read them, are kept in memory for the open page only. Calendar files (.ics) and Download all zips are built on your own computer and saved where your browser saves downloads. The files in a zip are downloaded from Brightspace with your sign-in.

## What it sends, and where

Nothing is sent to the developer or to any server run by the developer. The extension has no analytics, no tracking, no advertising and no accounts. It does not sell, share or transfer your data.

It only makes requests to:

- your school's Brightspace site (`*.brightspace.com`), as you would yourself;
- `www.gradescope.com`, if you use the Gradescope option;
- `*.edstem.org`, if you use the Ed option. Your Ed token is sent only to Ed and never reaches the Brightspace page;
- `edfinity.com`, if you use the Edfinity option. These are read-only requests with your own Edfinity session.

Access to Gradescope, Ed and Edfinity is optional, and the extension asks you before it is used.

## What it changes

It only changes anything on Brightspace when you press a button that says so, such as **Submit Assignment** or **Post Reply**. It never changes anything on Gradescope, Ed or Edfinity.

## Permissions

- **Brightspace pages:** to read your course data and show it in the new layout.
- **Gradescope and Ed (optional):** to read your work from those sites.
- **Edfinity (optional):** access to `edfinity.com`, asked for only when you turn on Edfinity. It reads your work from Edfinity and lets the small script on Edfinity pages run.
- **Storage:** to keep your settings and the saved pages above.
- **Alarms:** to show reminders at the right time, even with no Brightspace tab open. Nothing is scheduled unless you turn on Reminders.
- **Notifications (optional):** asked for only when you turn on Reminders. Notifications are shown by your browser on your own computer. Firefox for Android doesn't offer them to extensions, so Reminders are not available there.
- **Active tab and scripting:** for the toolbar button, which runs a check of which Brightspace pages your account can read. It reports only statuses and field names, and nothing leaves your browser.

## Your choices

You can remove the extension at any time, which deletes everything it stored. You can also clear its stored data from your browser's extension settings, and remove your Ed token in the extension's settings.

## Contact

Questions: open an issue at https://github.com/rishabh-mohan/brightspace-canvas-wrapper/issues

If this policy changes, the new version will be published at the same address with a new date.
