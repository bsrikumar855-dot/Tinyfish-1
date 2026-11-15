# nptel-mcp

An MCP server (TypeScript, stdio) that turns the [NPTEL](https://nptel.ac.in/courses) course catalogue into three typed agent tools. All web access goes through [TinyFish](https://docs.tinyfish.ai) (Search, Fetch, Agent). Built for the TinyFish "Site to MCP" bounty.

## Install and run (two commands)

```bash
npm install && npm run build
echo "TINYFISH_API_KEY=your_key" > .env && npm start
```

The key is read from `.env` (never logged or committed; `.env.example` is a template). Node 20+.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "nptel": {
      "command": "node",
      "args": ["/absolute/path/to/nptel-mcp/dist/server.js"],
      "env": { "TINYFISH_API_KEY": "your_key" }
    }
  }
}
```

Claude Code: `claude mcp add nptel -e TINYFISH_API_KEY=your_key -- node /absolute/path/to/nptel-mcp/dist/server.js`.
The `bin` entry (`nptel-mcp`) allows `npx` once published (not published).

## Tools

| Tool | Use it when | TinyFish product | Speed |
|---|---|---|---|
| `search_courses(query, discipline?, institute?, limit?, refresh?)` | You need to find courses / course_ids by topic | **Search** + **Fetch** | ~3-15 s |
| `get_course(course_id, enrich?, refresh?)` | You have a course_id and want its details | **Fetch** (page + syllabus PDF), then **Agent** for duration/schedule | Fetch: seconds; Agent: up to 120 s |
| `compare_courses(course_ids[2..5], enrich?, refresh?)` | The user is choosing between courses | **Fetch** via `get_course` (`enrich=true` adds Agent) | seconds |

Every tool returns structured JSON (zod-validated), never raw page text. Errors come back as `{error: {code, message, tool, field}}` with `isError: true`.

`search_courses {"query":"machine learning","institute":"IIT Madras","limit":2}`:
```json
[{"course_id":"106106139","title":"NOC: Introduction to Machine Learning","discipline":"Computer Science And Engineering","institute":"IIT Madras","instructors":["Prof. Balaraman Ravindran"],"url":"https://nptel.ac.in/courses/106106139"}, ...]
```

`get_course {"course_id":"106106139"}` (real output, 2026-11-15, abridged):
```json
{"course_id":"106106139","title":"NOC: Introduction to Machine Learning","institute":"IIT Madras","discipline":"Computer Science And Engineering",
 "instructors":["Prof. Balaraman Ravindran"],"syllabus":"Week 0: Probability Theory, Linear Algebra, ...\nWeek 1: ...","duration":"Jul-Oct 2026",
 "schedule":"Enrollment : 2026-05-22 to 2026-07-27, Exam Registration : ...","enrollment_start":"2026-05-22","enrollment_end":"2026-07-27",
 "status":"closed","status_basis":"enrollment 2026-05-22 to 2026-07-27; today 2026-11-15 (IST)","syllabus_source":"nptel_syllabus_pdf",
 "fields_unavailable":[],"enrichment":"ok","enrichment_error":null}
```
- **`status`** is `open` / `closed` / `upcoming` from the enrollment window against today's date in IST. It is recomputed on every call, also for cached results, so a stale schedule shows as `closed`. It is `unknown` when no dates were found (for example with `enrich=false`).
- **`syllabus`** is the week-by-week plan from NPTEL's own syllabus PDF (the file behind the page's "Syllabus" tab, fetched with TinyFish Fetch). If that PDF is missing, a targeted Agent step tries the Syllabus tab. If neither yields week lines, `syllabus` is `null`.
- **`enrichment`**: `ok` = syllabus, duration and schedule all found; `partial` = some found (the rest are in `fields_unavailable`); `failed` = none found or the Agent errored; `skipped` = `enrich=false`.
- **`discipline`** is derived from the first 3 digits of the course id using the discipline labels printed on https://nptel.ac.in/courses (mapping in `src/disciplines.ts`); `null` only for an unmapped prefix.

## How TinyFish Search, Fetch and Agent are used

- **Search** (`search_courses`): NPTEL's listing is a JS app whose search box could not be driven reliably by the Agent (see `docs/site-notes.md`). The query `site:nptel.ac.in/courses <query>` goes to TinyFish Search; only results whose host is `nptel.ac.in` are kept and the 9-digit course ids extracted. Hits are then dropped when their title/instructors share no term with the query and the Search snippet does not contain every query term (the site-restricted search otherwise returns courses that matched only on the institute name).
- **Fetch** (`search_courses`, `get_course`, `compare_courses`): each course detail page yields title, institute and instructors statically; the syllabus PDF `archive.nptel.ac.in/content/syllabus_pdf/<id>.pdf` yields the week-by-week syllabus (cheap, 150 URLs/min limit respected). Fetch's per-URL error entries map to `NOT_FOUND`.
- **Agent** (`get_course`): the Fetch text does not contain the page's tab contents (duration, enrollment/exam dates). One Agent run (120 s cap, no retry) reads them from the rendered page; a second, targeted run (click the Syllabus tab) happens only if the syllabus PDF is unavailable. Agent also replaces Fetch entirely if Fetch returns empty/unrecognisable content. Agent runs: 2 concurrent; `COMPLETED` is never trusted, results are validated against zod schemas.

## Why there is no `list_institutes`

An earlier version had it (Agent reading the "Select Institutes" dropdown), but NPTEL shows no per-institute counts and an Agent run cannot count thousands of cards within the 120 s cap. It returned `course_count: null` for every institute, so it was removed rather than shipped with a useless field.

## Robustness

- Typed errors: `SITE_STRUCTURE_CHANGED` (names tool + field), `NOT_FOUND`, `RATE_LIMITED`, `TINYFISH_FAILED` (includes Agent run id).
- Parse failures never become silent empty lists; a malformed Agent enrichment is `SITE_STRUCTURE_CHANGED`.
- JSON-file cache in `.cache/` (search 24 h, details 6 h, failed enrichment 10 min; env `NPTEL_SEARCH_TTL`, `NPTEL_DETAIL_TTL`). Every tool has `refresh: true` to bypass it.
- Agent runs are capped at 120 s (`NPTEL_AGENT_TIMEOUT_MS`).

## Healthcheck

```bash
npm run healthcheck          # live, cache bypassed
npm run healthcheck search   # only checks whose name starts with "search"
```
Prints `PASS` / `WARN` / `FAIL` per check. Exit **0** all pass; **1** any FAIL (`SITE_STRUCTURE_CHANGED`, `NOT_FOUND`, `RATE_LIMITED`, wrong content - the site or our parser broke); **2** only WARN (`TINYFISH_FAILED`: TinyFish platform error/timeout, not a site change). `search_courses("machine learning")` returning 0 results is a FAIL.

## Tests

`npm test` (vitest) uses **recorded real TinyFish responses** in `tests/fixtures/` (captured 2026-11-15) plus a mocked Agent to force the enrichment paths. No network.

## Known limits

- **Discipline is derived, not read per course.** The course-id prefix predicts NPTEL's discipline label for 98.25% of the 3,484 courses on the listing (read 2026-11-15); the other 61 carry a different label than their prefix's majority (worst: prefix 117, where 21 of 129 are labelled Electrical Engineering, and prefix 121, 6 of 16). New prefixes are `null` until added to `src/disciplines.ts`.
- **Syllabus** needs NPTEL's syllabus PDF. The Agent "click the Syllabus tab" fallback returned `null` on every live attempt for 106106139 (the tab opens that PDF in a new tab), so without the PDF the syllabus stays unavailable and `enrichment` is `partial`. The SWAYAM preview page (`onlinecourses.nptel.ac.in/<noc id>/preview`) was tested: it has the abstract and prerequisites but no week-by-week plan, and its noc id cannot be derived from the numeric course id, so it is not used.
- **Status** depends on the Agent finding the enrollment dates; with `enrich=false` or an Agent failure it is `unknown`.
- Agent enrichment is slow and TinyFish Agent runs sometimes fail with an internal error (run ids in `docs/site-notes.md`); then `enrichment` is `partial` or `failed` and the fields are listed in `fields_unavailable`.
- Search quality is TinyFish Search relevance and varies between runs. The relevance filter keeps any hit that shares one query term with its title/instructors (so "Electrical Machines" survives a "machine learning" query). Institute and discipline filters are applied to the first ~2x`limit` hits.
- Not published to npm.

## License

MIT, see [LICENSE](LICENSE).
