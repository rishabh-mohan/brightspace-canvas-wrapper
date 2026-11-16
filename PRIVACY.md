# Privacy policy

**Brightspace Canvas Wrapper** is an unofficial browser extension that shows your Brightspace courses in a Canvas-style layout. It is not made by or connected to D2L, Instructure, Gradescope or Ed.

Last updated: 16 November 2026.

## What it reads

When you open Brightspace, the extension reads your course data (courses, due dates, grades, announcements, files, discussions, quizzes and similar pages) from your school's Brightspace site, using the sign-in you already have. It shows that data in its own layout on the same page.

If you switch them on, it also reads:

- **Gradescope:** your assignments, due dates and scores, using your own Gradescope sign-in.
- **Ed Discussion:** your courses, lessons, announcements and scores, using an API token you paste in yourself.

## What it stores

Everything is stored in your own browser, using the browser's extension storage:

- your settings, pins, nicknames and course colours;
- your own To Do items and ticked-off tasks;
- your Ed API token, if you add one;
- recent Brightspace pages and answers, kept so pages load faster. Signing out of Brightspace clears these.

## What it sends, and where

Nothing is sent to the developer or to any server run by the developer. The extension has no analytics, no tracking, no advertising and no accounts. It does not sell, share or transfer your data.

It only makes requests to:

- your school's Brightspace site (`*.brightspace.com`), as you would yourself;
- `www.gradescope.com`, if you use the Gradescope option;
- `*.edstem.org`, if you use the Ed option. Your Ed token is sent only to Ed and never reaches the Brightspace page.

Access to Gradescope and Ed is optional, and the extension asks you before it is used.

## What it changes

It only changes anything on Brightspace when you press a button that says so, such as **Submit Assignment** or **Post Reply**. It never changes anything on Gradescope or Ed.

## Permissions

- **Brightspace pages:** to read your course data and show it in the new layout.
- **Gradescope and Ed (optional):** to read your work from those sites.
- **Storage:** to keep your settings and the saved pages above.
- **Active tab and scripting:** for the toolbar button, which runs a check of which Brightspace pages your account can read. It reports only statuses and field names, and nothing leaves your browser.

## Your choices

You can remove the extension at any time, which deletes everything it stored. You can also clear its stored data from your browser's extension settings, and remove your Ed token in the extension's settings.

## Contact

Questions: open an issue at https://github.com/rishabh-mohan/brightspace-canvas-wrapper/issues

If this policy changes, the new version will be published at the same address with a new date.
