# Brightspace → Canvas mapping

The left column lists what Brightspace exposes (the MCP tool or raw endpoint in parentheses). The
right column lists the Canvas concept to show it as. Field names on the left match
`tests/fake_d2l_server.py`.

## Objects

| Brightspace | Canvas | Notes |
|---|---|---|
| Org unit / course offering (`get_my_courses`) | Course (Dashboard card) | `id` → course id, `name` → name, `code` → course_code. Drop old terms and non-course org units. |
| Content module (`get_course_content`, `type: "module"`) | Module | Keep the tree order. Brightspace allows deeper nesting than Canvas, so flatten it or use indentation. |
| Content topic: file | Module item: File | `download_file(courseId, topicId)` |
| Content topic: link | Module item: External URL | |
| Content topic: LTI quickLink (`type=lti&rcode=…`) | Module item: External Tool | Launch through Brightspace with the session (see `node/hub-brightspace-gradescope.mjs`). |
| Dropbox folder (`get_assignments`, `type: "assignment"`) | Assignment (online upload) | `points` → points_possible, `dueDate` → due_at, `startDate` → unlock_at |
| Quiz (`get_assignments`, `type: "quiz"`) | Quiz | `attemptsUsed`, `bestScore`. Open the Brightspace quiz URL to take it; don't rebuild quiz taking. |
| Dropbox submission (`mysubmissions`, raw) | Submission | Status `0` → unsubmitted, `1` → submitted, `2` → unsubmitted (draft), `3` → graded. `SubmissionDate` → submitted_at, `Files` → attachments. |
| Grade item (`get_my_grades`, GradeObjectType 1–4) | Gradebook column / Assignment score | `pointsNumerator` / `pointsDenominator`, `displayGrade` |
| Grade category (GradeObjectType 9) | Assignment group | Use it as a group subtotal. Never list it as an assignment. |
| Calculated/final grade (types 5–8) | Course total | Show it as the total if present. Otherwise compute it from the syllabus weights (`course_grades()` in `hub/d2l.py`). |
| Announcement / News (`get_announcements`) | Announcement | `title`, `body` (HTML: sanitize it), `date` → posted_at |
| Course overview (`get_syllabus`) or a syllabus file | Syllabus page | |
| Calendar feed event (ICS) | Calendar event / To-Do item | Keep the ` - Due` event and drop the Available and Availability Ends twins. |
| (not read by this code) Discussions, Class list, Groups | Discussions, People, Groups | They exist in the Valence API (`le/{ou}/discussions/…`, `lp/…/enrollments/…`) but haven't been tried here. |

## Canvas screens and where their data comes from

| Canvas screen | Calls |
|---|---|
| Dashboard (course cards) | `get_my_courses` → filter to the current term |
| To-Do / Coming Up sidebar | `get_assignments` for each course (or the ICS feed), not yet submitted, sorted by `dueDate` |
| Course Home / Modules | `get_course_content(courseId, maxDepth: 4)` |
| Assignments list | `get_assignments(courseId)`, grouped by grade category if you have the plan |
| Grades | `get_my_grades` + `gradetypes` (to separate items from totals) + weights |
| Announcements | `get_announcements(count)` filtered by `courseId` |
| Syllabus | `get_syllabus` or the syllabus file in Content |
| Calendar | ICS feed |

## Grade weights

Brightspace's own weights are often missing from the student view. This app has Claude (with no
tools) read the syllabus once into a plan. The student can override it, and their edits always win:

```json
{"categories": [{"name": "Homework", "weight": 20, "drop_lowest": 1, "keywords": ["homework"], "where": "brightspace"},
                {"name": "Exams", "weight": 60, "keywords": ["exam"], "where": "brightspace"},
                {"name": "Labs", "weight": 20, "keywords": ["lab"], "where": "elsewhere"}],
 "scale": [{"letter": "A", "min": 90}, {"letter": "B", "min": 80}, {"letter": "C"}]}
```

Items are sorted into categories by the longest keyword that matches. Anything left over is listed
as unsorted rather than guessed. See `_category()`, `_clean_plan()` and `course_grades()`.

## Practical advice

- Cache everything locally (this app uses SQLite) and sync every 1–2 hours. Each sync starts a
  headless browser and makes about 30 API calls.
- Deep-link out to Brightspace for anything that writes: submitting, taking quizzes, posting.
  Rebuilding those is where students get hurt (a lost submission or a used-up attempt).
