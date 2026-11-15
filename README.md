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
| `get_course(course_id, enrich?, refresh?)` | You have a course_id and want its details | **Fetch**, then one **Agent** enrichment | Fetch: seconds; enrichment: up to 120 s |
| `compare_courses(course_ids[2..5], enrich?, refresh?)` | The user is choosing between courses | **Fetch** via `get_course` (`enrich=true` adds Agent) | seconds |

Every tool returns structured JSON (zod-validated), never raw page text. Errors come back as `{error: {code, message, tool, field}}` with `isError: true`.

`search_courses {"query":"machine learning","institute":"IIT Madras","limit":2}`:
```json
[{"course_id":"106106139","title":"NOC: Introduction to Machine Learning","discipline":null,"institute":"IIT Madras","instructors":["Prof. Balaraman Ravindran"],"url":"https://nptel.ac.in/courses/106106139"}, ...]
```

`get_course {"course_id":"106106202"}` returns title, institute (`"KTH Royal Institute of Technology, Sweden"`), instructors, `available_sections`, and:
`discipline` / `syllabus` / `duration` / `schedule` - filled by the Agent enrichment if the page shows them, else `null` and listed in **`fields_unavailable`**. `enrichment` is `"ok"`, `"failed"` (see `enrichment_error`; Fetch data is still returned) or `"skipped"` (`enrich=false`).

## How TinyFish Search, Fetch and Agent are used

- **Search** (`search_courses`): NPTEL's listing is a JS app whose search box could not be driven reliably by the Agent (see `docs/site-notes.md`). The query `site:nptel.ac.in/courses <query>` goes to TinyFish Search; only results whose host is `nptel.ac.in` are kept and the 9-digit course ids extracted.
- **Fetch** (`search_courses`, `get_course`, `compare_courses`): each course detail page yields title, institute and instructors statically (cheap, 150 URLs/min limit respected). Fetch's per-URL error entries map to `NOT_FOUND`.
- **Agent** (`get_course`): the Fetch text does not contain the page's tab contents (duration, enrollment/exam dates, abstract). One Agent run (120 s cap, no retry) reads them from the rendered page. Agent also replaces Fetch entirely if Fetch returns empty/unrecognisable content. Agent runs: 2 concurrent; `COMPLETED` is never trusted, results are validated against zod schemas.

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

- `discipline` is `null` in search results and usually after enrichment (the page rarely names one); the `discipline` argument of `search_courses` is only a soft search keyword.
- Agent enrichment is slow and TinyFish Agent runs sometimes fail with an internal error (run ids in `docs/site-notes.md`); then `enrichment: "failed"` and the fields are listed in `fields_unavailable`.
- Search quality is TinyFish Search relevance; institute filtering is applied to the first ~2x`limit` hits.
- Not published to npm.
