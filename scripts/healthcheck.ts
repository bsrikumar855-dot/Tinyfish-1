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
  ["search_courses (relevance, IIT Madras)", async () => {
    const r = await searchCourses({ query: "machine learning", institute: "IIT Madras", limit: 10, refresh: true });
    if (r.length === 0) throw new Error("0 results for known-good query 'machine learning' + IIT Madras - FAILURE, not an empty list");
    const noise = r.filter((c) => ["102106023", "117106030", "106101060"].includes(c.course_id)).map((c) => c.title);
    if (noise.length) throw new Error(`irrelevant hits survived the relevance filter: ${noise.join("; ")}`);
    return `${r.length} results, none of the known noise hits`;
  }],
  ["get_course (Fetch)", async () => {
    const c = await getCourse({ course_id: KNOWN_ID, refresh: true, enrich: false });
    if (c.institute !== "IIT Bombay" || c.instructors.length === 0) throw new Error(`unexpected content: ${JSON.stringify(c)}`);
    if (c.discipline !== "Aerospace Engineering") throw new Error(`discipline from id prefix is ${c.discipline}`);
    return `${c.title} | ${c.institute} | ${c.discipline} | syllabus=${c.syllabus ? "yes" : "no"}`;
  }],
  ["get_course (syllabus + enrichment, 106106139)", async () => {
    const c = await getCourse({ course_id: "106106139", refresh: true, enrich: true });
    if (!c.syllabus || (c.syllabus.match(/^Week \d+/gm) ?? []).length < 10) throw new Error(`week-by-week syllabus missing (source=${c.syllabus_source})`);
    if (c.discipline !== "Computer Science And Engineering") throw new Error(`discipline ${c.discipline}`);
    if (c.enrichment === "failed") throw new NptelError("TINYFISH_FAILED", c.enrichment_error ?? "enrichment failed", "get_course");
    if (c.status === "unknown") throw new NptelError("TINYFISH_FAILED", `enrichment found no enrollment dates, so status is unknown (${c.enrichment_error ?? c.enrichment})`, "get_course"); // duration is reported but not required: the Agent returns it in only some runs
    return `enrichment=${c.enrichment}; duration=${c.duration}; status=${c.status} (${c.status_basis}); syllabus from ${c.syllabus_source}; fields_unavailable=[${c.fields_unavailable.join(", ")}]`;
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
