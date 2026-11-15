# NPTEL site notes (observed 2026-11-15, real TinyFish calls)

## Listing: https://nptel.ac.in/courses
- SvelteKit app (`/_app/immutable/...`), listing is JS-rendered.
- **Fetch** (static) returns only ~10 course titles, each followed by its discipline, as plain text. No links, institutes, filters or pagination. Not usable for search. Fixture: `tests/fixtures/fetch_courses_listing.json`.
- **Agent** run (reported by the agent, not yet independently verified): no pagination, a single infinite-scroll list; filters for Discipline, Institute and Course Type (Video/Web); two search boxes (course name, instructor name).
- Agent first 5 courses (Aerospace Engineering): e.g. "NOC:Introduction To Aerospace Engineering", IIT Bombay, `https://nptel.ac.in/courses/101101079`. Fixture: `tests/fixtures/agent_complete_ok.json`.

## Detail page: https://nptel.ac.in/courses/{course_id}
- course_id is a 9-digit number (e.g. 101101079). Page is static enough for **Fetch**.
- Fetch text contains: title + institute ("NOC: Introduction to Aerospace Engineering - Flight, IIT Bombay"), instructor line ("Prof. Rajkumar S. Pant"), and tab labels (about, downloads, TA list, statistics, toppers list, certificate type, Syllabus). Tab *contents* (syllabus, duration) were NOT in the Fetch text. Fixture: `tests/fixtures/fetch_course_detail_101101079.json`.

## TinyFish response shapes (observed)
- Fetch: `{results:[{url, final_url, title, description, language, text, author, published_date, latency_ms, format}], errors:[]}`. Took ~19s for the listing.
- Agent SSE (`run-sse`): events `STARTED`, `STREAMING_URL`, `PROGRESS{purpose}`, `HEARTBEAT`, `COMPLETE{status, result | error}`. Result is free-form JSON unless `output_schema` is given.
- **Agent latency was 3–4 minutes** for a 5-course extraction. Plan for this: cache hard, timeouts >= 5 min.
- One of two identical Agent runs ended `COMPLETE` with `status: FAILED` ("Something went wrong on our side"). Fixture: `agent_complete_failed.json`. Retry/typed-error handling is required.

## Not probed
I did not probe NPTEL's hidden/internal endpoints (e.g. SvelteKit `__data.json`); that was blocked in this session and is out of scope. All access goes through TinyFish.

## Search approach (decided 2026-11-15)
The listing's search box cannot be driven reliably by the TinyFish Agent (see failures below), and scrolling the full list returned a false `matches_found: 0` for "machine learning". `search_courses` therefore uses **TinyFish Search** (`GET https://api.search.tinyfish.ai?query=site:nptel.ac.in/courses ...`; response `{query, results:[{position, site_name, snippet, title, url}]}`, fixture `tests/fixtures/search_machine_learning.json`) to find course URLs, then **Fetch** on each detail page. Real run: 13s for 5 results. Result URLs not on `nptel.ac.in` are dropped.

## Failed Agent runs (TinyFish side)
All of these ended `COMPLETE` with `status: FAILED` and the exact error text:
> Something went wrong on our side while running this task. Please retry; contact support if it persists.

Run IDs (from `GET /v1/runs?status=FAILED`, all goals on https://nptel.ac.in/courses):
- 393750c7-fc60-4dba-8cac-a34730e33d78 (05:29Z, Step 0 listing description)
- d27cf5a4-4fc9-4865-b986-14806cd85e53 (05:43Z)
- 37efdc04-b1ee-499a-810e-a26f46859608 (05:46Z)
- 75fb3a0f-e99d-4877-8053-a3e5d0417888 (05:50Z)
- e52d4ab7-6aea-4067-bec3-7ca0c7cfe168 (05:53Z)
- abfdc765-b345-423d-a663-28956f21f1f3 (05:56Z)
- b8e46204-dcbf-4de3-8641-831d46f11d06 (06:07Z)
- f31a11ca-b720-4be9-b739-6ba267bc0eb6 (06:10Z)

(The run list only gives a generic goal summary, so I cannot map each ID to its exact goal; the failing goals were: search-box typing with/without output_schema, and scroll-list with a discipline filter.) One further run timed out client-side at 420s and has no recorded ID. A scroll-list run returned `matches_found: 0` for "machine learning": a COMPLETED-but-wrong result, so zero-match Agent output is treated as suspect.

## Update: list_institutes removed; get_course enrichment
- `list_institutes` was removed. A probe asking the Agent whether the page shows a course total after selecting "IIT Madras" timed out at the 120 s cap; the dropdown shows names only, and counting thousands of cards is not feasible in one capped run. Shipping `course_count: null` was not acceptable.
- The live detail page (opened in a browser, course 106106202) shows after the section tabs: Course Duration ("Jan-Mar 2026"), Enrollment, Exam Registration and Exam Date ranges, and a Course Abstract. Fetch's text for the same page only has the heading, instructor and tab labels (334-char body), so these come from the Agent enrichment.
- Heading format confirmed live: `NOC: Machine Learning, ML, KTH Royal Institute of Technology, Sweden` -> title `NOC: Machine Learning, ML`, institute `KTH Royal Institute of Technology, Sweden`. Fixture: `fetch_course_detail_106106202_kth.json`.
