"""A stand-in for docker/hub-brightspace in tests (app/d2l.py): just enough
MCP over stdin/stdout to answer the tools a sync calls, with a scripted
Microsoft sign-in. Never touches Brightspace.

Driven by $HUB_BRIGHTSPACE_HOME/scenario.json:
  {"pending": 2, "number": "42"}   the first 2 calls wait on a number match
`store` mode writes what it was given to stored.json there instead.
"""
import json
import os
import sys

HOME = os.environ["HUB_BRIGHTSPACE_HOME"]
SCENARIO = json.load(open(os.path.join(HOME, "scenario.json")))
OU, OTHER, OLD = 999001, 999002, 777001

DATA = {
    "get_my_courses": [{"id": OU, "name": "SCI 10100 - Modern Mechanics", "code": "202610-SCI-10100"},
                       {"id": OTHER, "name": "GEO 10500 - Natural Disasters", "code": "202610-GEO-10500"},
                       # last year's course and a campus group: not this term, never read
                       {"id": OLD, "name": "Spring 2025 CHEM 10000", "code": "202520-CHEM-10000",
                        "startDate": "2025-01-10T00:00:00.000Z", "endDate": "2025-05-10T00:00:00.000Z"},
                       {"id": OLD + 1, "name": "Academic Integrity Resources", "code": "AI-RES",
                        "startDate": None, "endDate": None}],
    "get_assignments": {
        OU: [{"type": "quiz", "id": 555, "name": "Homework 9", "dueDate": "2026-10-13T03:59:00.000Z",
              "startDate": "2026-10-06T13:00:00.000Z", "attemptStatus": "known", "attemptsUsed": 1, "bestScore": 9},
             {"type": "assignment", "id": 777, "name": "Lab report 3", "dueDate": "2026-10-15T03:59:00.000Z",
              "submissionStatus": "unknown", "submission": None, "points": 20},
             {"type": "assignment", "id": 778, "name": "Lab report 4", "dueDate": "2026-10-22T03:59:00.000Z",
              "submissionStatus": "submitted", "points": 20,
              "submission": {"submittedDate": "2026-10-09T20:15:00.000Z", "files": []},
              "feedback": {"score": 18}}],
        OTHER: [],
    },
    "get_my_grades": {"courses": [{"courseId": OU, "courseName": "SCI 10100", "grades": [
        {"name": "Homework 8", "displayGrade": "9 / 10", "pointsNumerator": 9, "pointsDenominator": 10,
         "gradeObjectId": 4242, "lastModified": "2026-10-08T12:00:00.000Z"},
        {"name": "Homework 7", "displayGrade": "5 / 10", "pointsNumerator": 5, "pointsDenominator": 10,
         "gradeObjectId": 4241, "lastModified": "2026-10-01T12:00:00.000Z"},
        {"name": "Exam 1", "displayGrade": "80 / 100", "pointsNumerator": 80, "pointsDenominator": 100,
         "gradeObjectId": 4300, "lastModified": "2026-10-03T12:00:00.000Z"},
        {"name": "Participation", "pointsNumerator": 3, "pointsDenominator": 3,
         "gradeObjectId": 4400, "lastModified": "2026-10-03T12:00:00.000Z"},
        # Brightspace's own category total: not an assignment (10/10, GEO showed a wrong percent)
        {"name": "Homeworks", "displayGrade": "35 %", "pointsNumerator": 14, "pointsDenominator": 40,
         "gradeObjectId": 4900, "lastModified": "2026-10-08T12:00:00.000Z"}]},
        # an old term's course: Brightspace's all-courses grade list still has it
        {"courseId": OLD, "courseName": "CHEM 10000", "grades": [
            {"name": "Lab 1", "pointsNumerator": 9, "pointsDenominator": 10, "gradeObjectId": 1}]}],
        "restrictedCourses": []},
    "get_announcements": [{"id": 31337, "title": "Exam 2 moved to Thursday", "body": "Room change too.",
                           "date": "2026-10-09T15:00:00.000Z", "courseId": OU, "courseName": "SCI 10100"}],
    "get_syllabus": {
        OU: {"courseId": OU, "description": "Welcome to SCI 101.", "hasAttachment": False},
        # words that once read as "still signing in" (10/10): content, not a signal
        OTHER: {"courseId": OTHER, "description": "GEO 105 grading: quizzes 50%, final 50%. Projects in progress "
                "are graded once sign-in sheets are in; call the TA again if needed. " + "Policy text. " * 150},
    },
    "get_course_content": {"courseId": OU, "modules": [{"type": "module", "title": "Start here", "children": [
        {"type": "topic", "title": "Lecture 1 slides", "topicId": 4000, "id": 4000},
        {"type": "topic", "title": "SCI 101 Syllabus Fall 2026.pdf", "topicId": 4001, "id": 4001}]},
        {"type": "module", "title": "Gradescope (Handwritten Homework)", "children": [
            {"type": "topic", "topicType": "link", "title": "Gradescope LTI 1.3", "id": 5000,
             "url": "/d2l/common/dialogs/quickLink/quickLink.d2l?ou=999001&type=lti&rcode=ABC"}]}]},
}
SYLLABUS_PDF = "Grading: Homework 20% (lowest dropped), Exams 60%, Labs 20% on WebAssign."
calls = {"n": 0}


def reply(msg_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": result}) + "\n")
    sys.stdout.flush()


def text(payload, is_error=False):
    return {"content": [{"type": "text", "text": payload if isinstance(payload, str) else json.dumps(payload)}],
            "isError": is_error}


def tool(name, args):
    calls["n"] += 1
    if calls["n"] <= SCENARIO.get("pending", 0):
        number = SCENARIO.get("number")
        msg = (f"Open Microsoft Authenticator and enter {number} within 5 minutes. Keep calling."
               if number else "Brightspace sign-in is already in progress. Retry this call once the sign-in completes.")
        return text(msg, is_error=True)
    if SCENARIO.get("signin") == "rejected":
        sys.stderr.write('[WARN] Microsoft rejected the code; waiting for a fresh one before retrying.\n'
                         'Authentication failed: [PBMCP-1003] Browser auth failed at step "mfa_code": '
                         'Microsoft rejected 3 authenticator codes. Run `npx -y brightspace-mcp-server@latest auth`\n')
        sys.stderr.flush()
        return text("[PBMCP-1001] Could not sign in to Brightspace automatically. The sign-in did not complete. "
                    "Run `npx -y brightspace-mcp-server@latest auth` in a terminal to see why.", is_error=True)
    if SCENARIO.get("broken") == name:
        return text("Brightspace is down for maintenance.", is_error=True)
    if args.get("courseId") in (OLD, OLD + 1):
        raise SystemExit(f"{name} was asked about a course that isn't this term's")
    if name in ("get_assignments", "get_syllabus"):
        got = DATA[name][args["courseId"]]
        return text({"courseId": args["courseId"], "assignments": got} if name == "get_assignments" else got)
    if name == "download_file":
        assert args == {"courseId": OU, "topicId": 4001}, args       # only the syllabus, never the slides
        return {"content": [{"type": "text", "text": json.dumps({"representation": "extracted_text"})},
                            {"type": "text", "text": "--- Extracted PDF text (3 pages) ---\n" + SYLLABUS_PDF}]}
    return text(DATA[name])


if sys.argv[1:] == ["submissions"]:
    # Brightspace's own record per folder (docker/hub-brightspace-submissions.mjs)
    asked = json.loads(sys.stdin.readline())
    json.dump(asked, open(os.path.join(HOME, "asked.json"), "w"))
    if SCENARIO.get("subs") == "down":
        sys.exit(1)
    real = {778: {"status": 1, "at": "2026-10-09T20:15:00.000Z", "files": ["lab4.pdf"]}}
    real.update({int(k): v for k, v in (SCENARIO.get("subs") or {}).items()})
    print(json.dumps([{"ou": a["ou"], "folder": a["folder"], "ok": True, **real.get(a["folder"], {"status": 0, "at": None, "files": []})}
                      for a in asked]))
    sys.exit(0)

if sys.argv[1:] == ["gradetypes"]:
    asked = json.loads(sys.stdin.readline())
    if SCENARIO.get("gradetypes") == "down":
        sys.exit(1)
    print(json.dumps([{"ou": ou, "ok": True, "items": [{"id": "4900", "type": 9}] + [
        {"id": str(g["gradeObjectId"]), "type": 1} for c in DATA["get_my_grades"]["courses"] if c["courseId"] == ou
        for g in c["grades"] if g["gradeObjectId"] != 4900]} for ou in asked]))
    sys.exit(0)

if sys.argv[1:] == ["store"]:
    json.dump(json.loads(sys.stdin.readline()), open(os.path.join(HOME, "stored.json"), "w"))
    print("stored")
    sys.exit(0)

json.dump({k: os.environ.get(k) for k in sorted(os.environ)}, open(os.path.join(HOME, "env.json"), "w"))
for line in sys.stdin:
    msg = json.loads(line)
    if "id" not in msg:
        continue                                          # a notification
    method, params = msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        reply(msg["id"], {"protocolVersion": params.get("protocolVersion"), "capabilities": {"tools": {}},
                          "serverInfo": {"name": "fake-brightspace", "version": "0"}})
    elif method == "tools/list":
        reply(msg["id"], {"tools": [{"name": n, "inputSchema": {"type": "object"}}
                                    for n in [*DATA, "download_file"]]})
    elif method == "tools/call":
        reply(msg["id"], tool(params["name"], params.get("arguments") or {}))
    else:
        reply(msg["id"], {})
