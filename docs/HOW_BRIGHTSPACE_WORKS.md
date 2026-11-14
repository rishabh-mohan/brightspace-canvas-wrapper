# How Brightspace works (from the outside, as a student)

Brightspace is D2L's LMS. Purdue's copy is `https://purdue.brightspace.com`. Students can't register
an OAuth app, so everything here works the way a browser does: sign in once, keep the session, then
call the same REST API the Brightspace web pages call.

## 1. Sign-in

```
purdue.brightspace.com → Purdue SSO → login.microsoftonline.com (Microsoft Entra)
   username@purdue.edu + password
   → MFA: number match in the Authenticator app, OR a 6-digit TOTP code
   → back to Brightspace with session cookies
```

- The package drives this in **headless Chromium (Playwright)** and saves the browser state, meaning
  cookies plus local storage (`build/auth/browser-state-store.js`). API calls reuse that session
  until it expires. Then it signs in again.
- There are three modes. The env vars are the package's; see `server_env()` in `hub/d2l.py`.
  - `totp`: stores the password plus the authenticator **setup key**, so it signs itself in
    unattended. This is the most convenient, but both factors sit on the server.
  - `password`: Microsoft shows a 2-digit number, and someone has to approve it on a phone within
    about 5 minutes. While it waits, the tools answer "still in progress … enter NN within …". The
    app pulls the number out and pushes it to the phone (see `_pending()` and `_NUMBER` in
    `hub/d2l.py`).
  - `passwordless`: the same as `password`, with no password stored.
- The username is the Purdue career account name, with `@purdue.edu` removed.
- `D2L_REMEMBER_MFA=true` ticks Microsoft's "don't ask again" box.
- The secrets are stored in the Secret Service keyring by `hub-brightspace store`. A container has
  no desktop keyring, so the launcher starts `dbus-run-session` plus `gnome-keyring-daemon`, unlocked
  by a random password kept in a file.
- **Trap (real bug):** check for "still signing in" only in the package's own signals: an error
  result, an `authPending` flag, or its notice block. Never search the content for it. A syllabus
  that said "in progress" got read as a pending sign-in, and the app re-asked 100 times in 6 minutes.
- For a browser extension, `login/purdue-2fa.user.js` shows how to compute the TOTP code in the
  browser (RFC 6238 over Web Crypto) and fill Microsoft's code box.

## 2. IDs you'll see everywhere

- **Org unit (`ou`)**: every course offering, and also every group, department and so on, is an org
  unit with an integer ID. "Course ID" in the tools means the org unit ID.
- **Course code** looks like `202610-SCI-10100`. The first part is the term: `YYYY` plus `10` for
  fall, `20` for spring, `30` for summer. Purdue's `202610` is Fall 2025, so the year is the academic
  year that ends. **Course name** looks like `SCI 10100 - Course Title` or `Fall 2026 SCI 10100-023
  LEC`.
- **Dropbox folder ID** (assignments), **quiz ID**, **grade object ID**, **topic ID** (content
  items), **news item ID** (announcements).
- Web URLs carry them:
  - quiz: `/d2l/lms/quizzing/quizzing.d2l?ou=…&qi=…`
  - dropbox: `/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=…&db=…`
  - LTI tool link: `/d2l/common/dialogs/quickLink/quickLink.d2l?ou=…&type=lti&rcode=…`

## 3. Way A: the REST API ("Valence") through the session

There are two route families:

- `/d2l/api/lp/{ver}/…`: Learning Platform. Users, enrollments, org units.
- `/d2l/api/le/{ver}/{orgUnitId}/…`: Learning Environment. Content, dropbox, quizzes, grades,
  news, calendar.

In the package's client, `api.le(ou, path)` builds the LE URL with the right version.

### MCP tools the app calls (the package wraps the API)

| Tool | Args | Returns (see `tests/fake_d2l_server.py` for exact JSON) |
|---|---|---|
| `get_my_courses` | none | `[{id, name, code, startDate, endDate}]`. **Includes old terms and campus groups.** Filter to the current term yourself (see `this_term()`). |
| `get_assignments` | `courseId` | `{assignments: [...]}`. Quizzes have `type: "quiz"`, `attemptsUsed` and `bestScore`. Dropboxes have `type: "assignment"`, `submissionStatus`, `submission{submittedDate, files}`, `feedback{score}` and `points`. Both have `dueDate` and `startDate`. |
| `get_my_grades` | none | `{courses: [{courseId, courseName, grades: [{name, displayGrade, pointsNumerator, pointsDenominator, gradeObjectId, lastModified}]}]}` |
| `get_announcements` | `count` | `[{id, title, body, date, courseId, courseName}]` |
| `get_syllabus` | `courseId` | `{description, hasAttachment}`, the course overview |
| `get_course_content` | `courseId`, `typeFilter` (`file`/`link`), `maxDepth` | `{modules: [{type: "module", title, children: [{type: "topic", topicType, title, topicId, url}]}]}` |
| `download_file` | `courseId`, `topicId` | JSON description, then the file's text as extra text blocks |

### Raw endpoints called directly (the package gets these wrong or doesn't expose them)

- `GET le/{ou}/dropbox/folders/{folderId}/submissions/mysubmissions/` returns a list of
  EntityDropbox records. Each has `Status` and `Submissions[]`, each submission with
  `SubmissionDate` and `Files[].FileName`.
  - Status codes: `0` Unsubmitted, `1` Submitted, `2` Draft, `3` Published (feedback released).
  - A 404 means nothing was submitted.
  - **The package's `submissionStatus: "submitted"` is true whenever any entry exists, including
    empty or draft ones.** Treat work as turned in only when the status is 1 or 3 and there's a date
    or files.
- `GET le/{ou}/grades/values/myGradeValues/` returns `GradeObjectIdentifier` and
  `GradeObjectType` for each row:
  - 1 numeric, 2 pass/fail, 3 select box, 4 text: real items.
  - 5 calculated, 6 formula, 7 final calculated, 8 final adjusted: computed.
  - 9 category: a category subtotal.
  - **`get_my_grades` mixes category totals in with real items and gives no way to tell them apart.**
    Adding them up double-counts (one course showed about 51% when the real figure was about 94%).

### Content and LTI

- Content is a tree of modules and topics. A topic is a file, a link, or an LTI "quickLink".
- External tools such as Gradescope, Pearson MyLab, WileyPLUS and Simple Syllabus are LTI links.
  Opening the quickLink URL with a valid Brightspace session launches the tool and signs you in
  (`node/hub-brightspace-gradescope.mjs`). There's no separate login for those tools.
- Simple Syllabus needs a **desktop user agent**. In headless mode it sits on a spinner, and it
  takes about 20 seconds to draw. Wait until there's real text (`node/hub-brightspace-page.mjs`).
- Many courses keep the syllabus as a PDF in Content rather than in the overview. Pick the
  file-type topic whose title contains "syllabus", and skip rubrics and worksheets (see
  `_syllabus_text()`).

## 4. Way B: the calendar (ICS) feed

Brightspace Calendar → Subscribe gives a private `.ics` URL with a token in it. Treat the token like
a password. No sign-in is needed, so it's the cheapest way to get due dates. See
`hub/services_brightspace.py`.

- `SUMMARY` ends with ` - Due`, ` - Availability Ends` or ` - Available`. One quiz can show up as
  two or three events; keep the Due one.
- `DESCRIPTION` contains the quiz or dropbox web URL. Read `ou` plus `qi` or `db` out of it to match
  events to API items exactly (see `_ids()` and `link_index()`).
- Times are in UTC. Convert them to the campus zone (America/Indiana/Indianapolis).
- The feed contains junk from copied courses: dates from 2020 or 2024. Ignore anything outside the
  current term.
- **Class meetings never appear.** Get class times from the registration schedule.
- A course merged across sections lists every section's dropboxes. Filter to the student's own
  section.

## 5. Other quirks worth knowing

- A course list call returns about 20 org units. Only about 6 are real current courses.
- A course with a broken tool should be skipped, not fail the whole sync. If half a sync fails,
  don't change any state.
- Instructors name things inconsistently: "Homework 7", "HW07" and "HW 07 (WileyPLUS)" are the same
  item. `_gkey()` matches them by type plus number, and `_COURSE_PREFIX` strips
  `"SCI 101 - FA25 - "`.
- Some grades live outside Brightspace, in Gradescope or the publisher's homework site. A Canvas
  clone will look empty for those unless you read the LTI tools too.
- Extra credit is often a single total row.
