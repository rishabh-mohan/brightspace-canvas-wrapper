# Brightspace reader: code and notes for a Canvas-style front end

This folder is a reference pack. It holds working code that reads a student's own data out of
Purdue's Brightspace (D2L), plus notes on how Brightspace is laid out and how its pieces line up with
Canvas. It comes from a personal planner app (called "the Hub" in the code comments). Names,
usernames, course numbers, org unit IDs and grades were swapped for placeholders: `student1`,
`SCI 101`, `999001` and so on.

## Read in this order

1. `HOW_BRIGHTSPACE_WORKS.md`: sign-in, the two ways data comes out (the API through a session, and
   the calendar feed), the IDs, and the quirks we hit.
2. `CANVAS_MAPPING.md`: each Brightspace object, its Canvas equivalent and the fields to map.
3. `tests/fake_d2l_server.py`: the fastest way to see real **data shapes**. Each tool's JSON is laid
   out exactly as the reader returns it.
4. The code below.

## What's here

| Path | What it is |
|---|---|
| `node/hub-brightspace` | Shell launcher. It starts the Brightspace reader inside a private D-Bus and keyring, where the session and saved sign-in live. Its modes are `server` (MCP over stdio), `store`, `submissions`, `gradetypes`, `page` and `gradescope`. |
| `node/hub-brightspace-submissions.mjs` | A raw D2L API call that returns real dropbox submission status, time and files. |
| `node/hub-brightspace-gradetypes.mjs` | A raw D2L API call that labels each grade row: a real item, a category total, or a calculated/final grade. |
| `node/hub-brightspace-page.mjs` | Follows a Content LTI link (for example Simple Syllabus) in headless Chromium with the saved session and returns the page text. |
| `node/hub-brightspace-gradescope.mjs` | Follows a course's Gradescope LTI 1.3 link and hands back Gradescope's cookies. Shows how LTI launches work. |
| `login/purdue-2fa.user.js` | Tampermonkey script that fills the Microsoft MFA code from your own authenticator key, computed locally as TOTP. |
| `hub/d2l.py` | The Python side. It signs in, runs one MCP session per sync, filters to this term's courses, matches items, checks submissions, reads syllabi, and does weighted-grade math. |
| `hub/services_brightspace.py` | Reads the Brightspace **calendar (ICS) feed** and merges its events into the app's assignment list. |
| `hub/sync_brightspace.py` | CLI wrapper around the ICS sync. |
| `hub/_work_grades.html` | Jinja template for the grades page. Shows which fields the UI uses. |
| `tests/test_d2l.py` | Tests for `d2l.py`. Each one documents a behavior or a past bug. |
| `packaging/Dockerfile.brightspace` | How the reader is built and pinned, plus the runtime packages it needs (Node, Chromium headless shell, gnome-keyring). |

## The engine underneath

The heavy lifting is done by the open-source
[RohanMuppa/brightspace-mcp-server](https://github.com/RohanMuppa/brightspace-mcp-server), pinned at
commit `38cb605d5f4bcdabc414068a62eb7104d3e733c2` (published to npm as 3.13.0). It handles:

- the Purdue → Microsoft sign-in in Playwright,
- keeping the session,
- calling D2L's REST API,
- exposing the results as MCP tools.

The `.mjs` scripts here import its internals (`build/utils/config.js`, `build/auth/index.js` and
`build/api/index.js`) to make raw API calls the package doesn't offer. **For a Canvas-like site,
the simplest path is to use that package (or copy its auth and API client) as the data layer and
put your own UI on top.**

## Not standalone

`hub/*.py` imports other parts of the planner app: `app.db`, `app.push`, `app.course_map`,
`app.titles` and its SQLite tables (`assignments`, `courses`, `sync_state`, `brightspace_events`).
Read those files for logic and edge cases; don't expect them to run on their own. The `node/`
scripts only need the pinned package installed at `/opt/brightspace-mcp`.

`course_map` is left out because it held one student's real schedule. It was a dictionary from
Brightspace org unit ID to the app's course code, plus a fallback that turns `SCI 10100` into
`SCI101`:

```python
OU_TO_CODE = {999001: "SCI101", 999002: "GEO105"}
```

## Ground rules this code follows (worth keeping)

- **Read-only.** Nothing ever submits, clicks "Start quiz", or changes anything on Brightspace.
- **Secrets never go to files the app writes, logs or environment variables.** The password and TOTP
  key go to the OS keyring once, over stdin. The calendar-feed URL contains a private token, so it
  gets redacted from every log line.
- **Text you read from Brightspace isn't trusted.** Announcement and syllabus text are someone
  else's writing. Show them; never feed them to an AI that has tools.
