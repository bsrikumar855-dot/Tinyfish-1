import { NptelError } from "../src/errors.js";
import { compareCourses, getCourse, searchCourses } from "../src/tools.js";

// Known real inputs (verified in docs/site-notes.md). The healthcheck bypasses the cache so it tests the live site.
const KNOWN_ID = "101101079";
const KNOWN_ID_2 = "101104061";

/**
 * Exit codes: 0 = all PASS, 1 = at least one FAIL (SITE_STRUCTURE_CHANGED, NOT_FOUND, RATE_LIMITED, wrong content),
 * 2 = no FAIL but at least one WARN (TINYFISH_FAILED: platform error/timeout, not a site change).
 */
const checks: [string, () => Promise<string>][] = [
  ["search_courses", async () => {
    const r = await searchCourses({ query: "machine learning", limit: 5, refresh: true });
    if (r.length === 0) throw new Error('0 results for known-good query "machine learning" - treated as FAILURE, not an empty list');
    if (!r.every((c) => c.url.startsWith("https://nptel.ac.in/courses/"))) throw new Error("result URL outside nptel.ac.in");
    return `${r.length} results, first: ${r[0].course_id} ${r[0].title} | ${r[0].institute}`;
  }],
  ["get_course (Fetch)", async () => {
    const c = await getCourse({ course_id: KNOWN_ID, refresh: true, enrich: false });
    if (c.institute !== "IIT Bombay" || c.instructors.length === 0) throw new Error(`unexpected content: ${JSON.stringify(c)}`);
    return `${c.title} | ${c.institute}`;
  }],
  ["get_course (Agent enrichment)", async () => {
    const c = await getCourse({ course_id: KNOWN_ID, refresh: true, enrich: true });
    if (c.enrichment === "failed") throw new NptelError("TINYFISH_FAILED", c.enrichment_error ?? "enrichment failed", "get_course");
    return `enrichment=${c.enrichment}; fields_unavailable=[${c.fields_unavailable.join(", ")}]; duration=${c.duration}`;
  }],
  ["get_course (NOT_FOUND path)", async () => {
    try { await getCourse({ course_id: "000000000", refresh: true, enrich: false }); } catch (e) {
      if (e instanceof NptelError && e.code === "NOT_FOUND") return "NOT_FOUND raised as expected";
      throw e;
    }
    throw new Error("expected NOT_FOUND for a nonexistent id");
  }],
  ["compare_courses", async () => {
    const r = await compareCourses({ course_ids: [KNOWN_ID, KNOWN_ID_2], refresh: true });
    if (r.courses.length !== 2) throw new Error("expected 2 courses");
    return r.summary;
  }],
];

const only = process.argv[2];
let fails = 0, warns = 0;
for (const [name, fn] of checks) {
  if (only && !name.startsWith(only)) continue;
  const t = Date.now();
  const secs = () => ((Date.now() - t) / 1000).toFixed(1);
  try {
    const msg = await fn();
    console.log(`PASS  ${name}  (${secs()}s)  ${msg}`);
  } catch (e) {
    const code = e instanceof NptelError ? e.code : "UNEXPECTED";
    if (code === "TINYFISH_FAILED") {
      warns++;
      console.log(`WARN  ${name}  (${secs()}s)  [TINYFISH_FAILED - platform error/timeout, not a site change]  ${(e as Error).message}`);
    } else {
      fails++;
      console.log(`FAIL  ${name}  (${secs()}s)  [${code}]  ${(e as Error).message}`);
    }
  }
}
if (fails) { console.error(`\nHealthcheck: ${fails} FAIL (exit 1)${warns ? `, ${warns} WARN` : ""} - see lines above.`); process.exit(1); }
if (warns) { console.error(`\nHealthcheck: ${warns} WARN (exit 2) - TinyFish platform errors/timeouts only; no site-structure failures.`); process.exit(2); }
console.log("\nHealthcheck: all tools OK (exit 0)");
