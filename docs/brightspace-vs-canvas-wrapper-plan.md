# Brightspace vs Canvas: Differences and Canvas-Style Wrapper Plan

Nov 13, 2026 · Living copy: https://claude.ai/artifact/YCmPM63QCqx7EGpTugMeGW

## Summary

Nothing changes inside Brightspace itself: it is closed, hosted software, so a Canvas-style experience has to be a layer on top that reads Brightspace data and redraws it with Canvas's layout.

The recommended layer is a browser extension that runs on the Brightspace site, calls the Brightspace API with the signed-in session, and renders a Canvas-style interface from a Canvas-shaped data model. It needs no administrator approval, which is the main obstacle to every other route.

Three differences drive most of the work:

- **Access.** Canvas lets any user create a personal API token. Brightspace only issues API access to applications an administrator registers.
- **Structure.** Canvas treats almost all graded work as one object, the assignment. Brightspace splits it across separate tools (Assignments, Quizzes, Discussions, Grades), each with its own API and identifiers.
- **Home and to-do.** Canvas has one dashboard, one to-do list and one calendar across courses. Brightspace builds its home pages from widgets that each institution arranges differently, so the cross-course view has to be assembled from several calls.

Platform details here are from memory, not checked against a live instance or current documentation. Treat endpoint paths as approximate until verified.

## Major differences

Canvas is one opinionated product with an open API; Brightspace is a configurable toolkit that each institution assembles, with a gated API.

| Area | Canvas | Brightspace | Effect on a wrapper |
| --- | --- | --- | --- |
| Vendor and source | Instructure; core is open source | D2L; closed source, hosted | Canvas behaviour can be read from source; Brightspace only from docs and the live site |
| Hierarchy | Account, sub-account, course, section | Org units: organization, department, semester, course template, course offering, section, group | Every Brightspace call is keyed by an org unit id; courses are one org unit type among several |
| Global navigation | Fixed left rail: Dashboard, Courses, Calendar, Inbox | Top minibar plus a navbar each institution or course can redesign | The Canvas rail has to be built; Brightspace navigation cannot be relied on to look the same anywhere |
| Home page | Dashboard with course cards, a to-do list and recent feedback | Home pages made of widgets chosen by the institution | Dashboard is assembled from enrolments, due items and updates |
| Course navigation | Fixed left menu of tools; instructors hide or reorder items | Course navbar and course home, both customisable | Course menu is built from which tools return data |
| Content | Modules hold items of any type: pages, files, assignments, quizzes, links | Content tool: modules and topics (units, lessons and folders in the newer experience); activities live in their own tools and are linked in | Module items need a lookup to resolve what each topic points to |
| Graded work | Assignment is the common object; quizzes and graded discussions are assignments too | Separate tools: Assignments (called dropbox in the API), Quizzes, Discussions | One merged assignment list has to be composed from three or more calls per course |
| Gradebook | Assignment groups with optional weights; totals computed live; What-If scores | Grade items and categories under a points, weighted or formula scheme; final grade may be calculated or adjusted, and released separately | Totals may be hidden until released; What-If has to be recomputed client side |
| Grading tool | SpeedGrader | Evaluation experience inside each tool, plus Quick Eval | Only matters for an instructor view |
| Pages | Built-in wiki Pages, and a Syllabus page with an automatic schedule | No wiki; HTML files as content topics; syllabus is whatever the instructor posts | Pages and Syllabus views map to content topics, loosely |
| Announcements | Announcements, a type of discussion | Announcements (called news in the API) | Direct mapping |
| Discussions | Flat list of topics per course | Forums contain topics, topics contain threads | One extra level to flatten or show |
| Messaging | Inbox (Conversations), with an API | Email tool and instant messages, little or no API | Inbox is the hardest Canvas feature to reproduce |
| Calendar and to-do | One calendar and a Planner across courses, with an API | Calendar per org unit, a Work To Do widget, and due-item and overdue-item endpoints | Planner is composed from several sources |
| Conditional access | Module prerequisites and requirements; lock dates | Release conditions on almost any item, plus special access | Locked items appear missing or flagged, depending on the endpoint |
| API style | REST under /api/v1 plus GraphQL; pagination by Link header | REST in two families, lp (platform) and le (learning), each with a version number in the path; pagination by bookmark or next-page link | Version discovery and two pagination styles needed in the client |
| API access | Personal tokens any user can create (unless disabled); OAuth developer keys | OAuth 2.0 only, for apps registered by an administrator, with scopes | No self-service route; see architecture options |
| Theming | Account-level theme editor that accepts custom CSS and JavaScript | Admin themes, navbars and widgets; interface built from web components with encapsulated styles | A pure restyle is harder on Brightspace than on Canvas |
| Mobile | Canvas Student, Teacher and Parent apps | Pulse app | Out of scope for a first version |

The terminology gap is small but constant: assignment and dropbox folder, announcement and news item, module item and topic, course and org unit, People and Classlist.

## Starting point and assumptions

The projects/canvas folder is empty, so this is a new build with no existing code to adapt.

This plan assumes a student-facing, read-mostly view of one person's own Brightspace account, without administrator rights on the institution's Brightspace. If the goal is instead an instructor view, or an API layer so existing Canvas tools can talk to Brightspace, the options below still apply but the recommendation shifts.

## Wrapper architecture

Build option B, the browser extension, and keep its data layer Canvas-shaped so options C and D stay open later.

| Option | What it is | Needs an administrator | Reaches | Main weakness |
| --- | --- | --- | --- | --- |
| A. Restyle | Extension or userscript that injects CSS and small scripts into Brightspace pages | No | Colours, spacing, a left rail | Cannot change page structure; Brightspace's encapsulated components resist outside CSS and change without notice |
| B. Extension with its own interface (recommended) | Extension that runs on the Brightspace site, calls the API as the signed-in user, and renders Canvas-style pages in place of Brightspace's | No | Full Canvas layout for everything the API exposes | Relies on the browser session for API access, which is unofficial; desktop browsers only |
| C. Standalone app | Web or desktop app that signs in through a registered OAuth 2.0 application | Yes, to register the app and grant scopes | Same as B, plus mobile and offline | Blocked until the institution agrees |
| D. Canvas API shim | Server that answers Canvas /api/v1 requests by translating to Brightspace calls | Yes, in practice | Lets existing Canvas clients and scripts work | Largest effort; many Canvas endpoints have no clean equivalent |

In option B the extension is three layers, and only the bottom one knows about Brightspace:

1. **Brightspace client.** Session handling, version discovery, both pagination styles, rate limiting and caching.
2. **Adapters.** One per Canvas concept (course, module, assignment, grade, announcement, planner item), each turning Brightspace responses into Canvas-shaped objects.
3. **Interface.** Canvas-style pages that read only the Canvas-shaped objects. Anything not yet rebuilt links through to the original Brightspace page.

If administrator access ever becomes available, layer 1 swaps to OAuth and layers 2 and 3 are reused unchanged in option C. Layer 2, exposed over HTTP, is most of option D.

An administrator could also get part of the way with configuration alone: a custom navbar, a home page with Work To Do and course-card widgets, and a theme. That changes the look for everyone at the institution and still leaves the split tools and gradebook as they are.

## Concept and API mapping

Most Canvas student views have a Brightspace source; Inbox, Pages and What-If grades are the gaps.

Paths are abbreviated: `lp` and `le` stand for `/d2l/api/lp/{version}` and `/d2l/api/le/{version}`, and `{ou}` is the course's org unit id. All are from memory and need checking against the live instance.

| Canvas view | Brightspace source | Approximate endpoint | Fit |
| --- | --- | --- | --- |
| Current user | Who am I | `lp/users/whoami` | Direct |
| Dashboard course cards | My enrolments, filtered to active course offerings; course image | `lp/enrollments/myenrollments/`, `lp/courses/{ou}/image` | Direct, after filtering out non-course org units and past terms |
| Modules | Content table of contents | `le/{ou}/content/toc` | Close; topic types need resolving to assignment, quiz, file or link |
| Assignments list | Assignment folders, quizzes, graded discussion topics | `le/{ou}/dropbox/folders/`, `le/{ou}/quizzes/`, `le/{ou}/discussions/forums/` | Composed from three sources and merged by due date |
| Submission status | My submissions per folder; quiz attempts | `le/{ou}/dropbox/folders/{id}/submissions/mysubmissions/` | Close; one call per folder |
| Grades | Grade items, categories, my values, my final value | `le/{ou}/grades/`, `le/{ou}/grades/values/myGradeValues/`, `le/{ou}/grades/final/values/myGradeValue` | Close; totals absent when the instructor has not released them |
| What-If grades | None | Computed in the extension from grade items and the grading scheme | Gap; exact only for points and simple weighted schemes |
| Announcements | News items | `le/{ou}/news/` | Direct |
| Discussions | Forums, topics, threads | `le/{ou}/discussions/forums/{id}/topics/` | Close; one extra level |
| To-do and Planner | Due items, overdue items, updates counts | `le/content/myItems/due/`, `le/overdueItems/myItems`, `le/{ou}/updates/myUpdates` | Composed; coverage of quizzes and discussions to be confirmed |
| Calendar | My calendar events | `le/{ou}/calendar/events/myEvents/` | Close; per course, merged in the extension |
| People | Classlist | `le/{ou}/classlist/` | Direct, where students are permitted to see it |
| Files | Content topics of file type | From the content table of contents | Partial; no separate file browser for students |
| Pages and Syllabus | HTML content topics; a module the instructor names Syllabus | From the content table of contents | Loose; depends on how each instructor organises content |
| Inbox | Email tool | No dependable API | Gap; link out to Brightspace email |
| Submitting work | Assignment submission upload | Multipart upload to the folder's submissions endpoint | Possible, but left as a link-out at first to avoid any risk to real submissions |

Available versions are listed at `/d2l/api/versions/`, so the client should read that at start-up instead of hard-coding version numbers.

## Changes required

The work is five phases, each usable on its own, with the first one deciding whether option B is viable at all.

1. **Access spike.** Confirm the extension can call the API as the signed-in user on the real instance, and record which endpoints a student role may read. Outcome: a go or no-go on option B, and a corrected version of the mapping table.
2. **Client and adapters.** Version discovery, both pagination styles, request throttling, a local cache, and adapters for courses, modules, assignments, grades and announcements. Saved API responses become test fixtures so later work does not need a live session.
3. **Dashboard and navigation.** The Canvas left rail, course cards, the cross-course to-do list, and a switch to drop back to the original Brightspace page at any time.
4. **Course pages.** Course menu, Modules, the merged Assignments list, Grades with totals where released, Announcements, and Discussions as read-only.
5. **Extras.** Calendar, What-If grades, People, per-course colours and nicknames, and dark mode.

Deliberately left out of the first version: Inbox, submitting work, taking quizzes, posting to discussions, any instructor view, and mobile. Each of these opens the original Brightspace page.

Brightspace-specific work that has no Canvas counterpart:

- Filtering enrolments down to current courses, since the list also returns departments, groups and old terms.
- Resolving content topics to the activity they link to, so a module item opens the right view.
- Handling items hidden by release conditions and grades that are not yet released, without showing them as zero or missing.
- Coping with per-institution differences in which tools are switched on.

## Risks, open questions and access

The largest risk is access: using the browser session to call the API is not a route D2L documents for third parties, and it may conflict with the institution's acceptable-use policy.

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Session-based API access is unofficial | Could stop working after a Brightspace update, or breach institution policy | Check the policy before phase 2; keep the client layer swappable for OAuth; stay read-only |
| Monthly Brightspace releases change pages and components | Anything that depends on page markup breaks | Depend on the API, not on page markup; keep the fall-back to the original page |
| Student role cannot read some endpoints | Views come back empty or forbidden | Phase 1 records what is readable; unreadable views link out |
| Many calls per page across several courses | Slow dashboard, possible throttling | Cache, limit concurrency, load per-course detail on demand |
| Wrong or stale grade and due-date display | A student trusts a wrong number or misses a deadline | Show the last refresh time; never show a computed total as official; link each item to its source page |
| Write actions against real coursework | A failed or duplicate submission | No writes in the first version |

Open questions:

- [ ] Is the target a student view of your own account, or an instructor view or an API layer for existing Canvas tools?
- [ ] Which institution's Brightspace, and does its policy allow browser extensions or scripted access?
- [ ] Is there any route to an administrator who would register an OAuth application?
- [ ] Which browser, and is this for personal use or for other students to install?
- [ ] Which Canvas views matter most, so phases 3 and 4 can be ordered by use?

Brightspace access would be used for phase 1 only at first: listing API versions, calling the read-only endpoints in the mapping table for two or three courses, and saving the responses as fixtures. The safest form is you signed in to your own browser session while the calls are run, so no password is shared; saved responses should have names and grades removed before they go into the repository.
