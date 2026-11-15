import { z } from "zod";
import { cacheGet, cacheSet, TTL } from "./cache.js";
import { disciplineFromId } from "./disciplines.js";
import { NptelError, structureChanged } from "./errors.js";
import { SearchApiResponse, Comparison, CourseDetails, CourseId, CourseSummary } from "./schemas.js";
import { fetchPages, runAgent, searchWeb } from "./tinyfish.js";

const LISTING = "https://nptel.ac.in/courses";
const detailUrl = (id: string) => `${LISTING}/${id}`;
/** The file behind the "Syllabus" tab link on every course page (verified live for 106106139, 101101079, 106106202). */
const syllabusPdfUrl = (id: string) => `https://archive.nptel.ac.in/content/syllabus_pdf/${id}.pdf`;

// ---------- parsers (pure, tested on recorded fixtures) ----------

const SECTION_LABELS = ["about", "course", "downloads", "TA list", "statistics", "toppers list", "certificate type", "Syllabus"];

export function parseDetailText(courseId: string, text: string): CourseDetails {
  const tool = "get_course";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/migrated to the NEW WEBSITE/i.test(l));
  const tabIdx = lines.findIndex((l) => /^about\s*course/i.test(l) || /^about.*downloads/i.test(l));
  const headIdx = 0;
  const heading = lines[headIdx];
  if (!heading || tabIdx === -1) throw structureChanged(tool, "page_text", "could not find the course heading and the section-tab line");
  let comma = heading.lastIndexOf(", ");
  // "…, KTH Royal Institute of Technology, Sweden": a trailing one-word, non-acronym segment is a country, keep the institute name whole.
  const tail = comma > 0 ? heading.slice(comma + 2).trim() : "";
  if (comma > 0 && /^[A-Z][a-z]+$/.test(tail)) {
    const prev = heading.lastIndexOf(", ", comma - 1);
    if (prev > 0) comma = prev;
  }
  const title = (comma > 0 ? heading.slice(0, comma) : heading).trim();
  const institute = comma > 0 ? heading.slice(comma + 2).trim() || null : null;
  if (!title) throw structureChanged(tool, "title", "empty course heading");
  const instructors = lines
    .slice(headIdx + 1, tabIdx)
    .flatMap((l) => l.split(/,\s*(?=(?:Prof|Dr|Mr|Ms)\b)/))
    .map((s) => s.trim())
    .filter(Boolean);
  const tabLine = lines[tabIdx];
  const available_sections = SECTION_LABELS.filter((s) => tabLine.toLowerCase().includes(s.toLowerCase()));
  return CourseDetails.parse({
    course_id: courseId, title, institute, discipline: disciplineFromId(courseId), instructors,
    syllabus: null, duration: null, schedule: null, url: detailUrl(courseId), available_sections,
  });
}

/**
 * Week-by-week syllabus from NPTEL's syllabus PDF text (or an Agent transcription of the Syllabus tab).
 * Returns null unless at least two "Week N" lines are present: an abstract alone is not a syllabus.
 */
export function parseSyllabusText(text: string): string | null {
  if ((text.match(/^\s*Week\s*\d+/gim) ?? []).length < 2) return null;
  const plan = text.search(/COURSE\s+(?:PLAN|LAYOUT)\s*:?/i);
  const firstWeek = text.search(/^\s*Week\s*\d+/im);
  let body = plan >= 0 && plan <= firstWeek ? text.slice(text.indexOf("\n", plan) + 1) : text.slice(firstWeek);
  const lines = body.split("\n").map((l) => l.trimEnd());
  // The PDF repeats the course title in capitals after the last week (page footer): drop trailing all-caps lines.
  while (lines.length && (lines.at(-1)!.trim() === "" || /^[A-Z0-9 &:,'()\-]+$/.test(lines.at(-1)!.trim()))) lines.pop();
  body = lines.join("\n").trim();
  return body.length >= 20 ? body.slice(0, 30_000) : null;
}

export function courseIdFromLink(link: string): string | null {
  return /(?:^|\/courses\/)(\d{9})(?:[/?#]|$)/.exec(link)?.[1] ?? null;
}

export interface SearchHit { id: string; title: string; snippet: string }

/** Parse TinyFish Search API output into unique nptel.ac.in course hits (order = relevance). */
export function parseSearchApi(raw: unknown): SearchHit[] {
  const p = SearchApiResponse.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw structureChanged("search_courses", i.path.join(".") || "result", i.message);
  }
  const hits: SearchHit[] = [];
  for (const r of p.data.results) {
    let host = "";
    try { host = new URL(r.url).hostname; } catch { /* drop unparsable urls */ }
    if (host !== "nptel.ac.in" && !host.endsWith(".nptel.ac.in")) continue; // only nptel.ac.in results are trusted
    const id = courseIdFromLink(r.url);
    if (id && !hits.some((h) => h.id === id)) hits.push({ id, title: r.title ?? "", snippet: r.snippet ?? "" });
  }
  return hits;
}

// ---- relevance ----
const STOPWORDS = new Set(["a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with", "by", "at", "from", "is", "are",
  "introduction", "intro", "course", "courses", "nptel", "noc", "prof", "dr", "mr", "ms", "iit", "iisc", "iiit"]);

/** Lower-cased alphanumeric terms, stopwords dropped, a trailing plural "s" stripped ("machines" == "machine"). */
export function searchTerms(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/**
 * A hit is relevant when its title/instructors share at least one term with the query, or when the Search snippet
 * contains every query term. Otherwise it is a site-restricted-search artefact (e.g. matched only on "IIT Madras").
 */
export function isRelevant(query: string, c: { title: string; instructors: string[]; snippet: string }): boolean {
  const q = searchTerms(query);
  if (q.length === 0) return true;
  const own = new Set(searchTerms(`${c.title} ${c.instructors.join(" ")}`));
  if (q.some((t) => own.has(t))) return true;
  const snip = new Set(searchTerms(c.snippet));
  return q.every((t) => snip.has(t));
}

// ---- enrollment status ----
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in IST (NPTEL's timezone) as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function computeStatus(start: string | null, end: string | null, today: string): { status: CourseDetails["status"]; basis: string } {
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    return { status: "unknown", basis: "enrollment dates not available" };
  }
  const basis = `enrollment ${start} to ${end}; today ${today} (IST)`;
  if (today < start) return { status: "upcoming", basis };
  if (today <= end) return { status: "open", basis };
  return { status: "closed", basis };
}

export function datesFromSchedule(schedule: string | null): { start: string | null; end: string | null } {
  const m = schedule ? /Enrollment[^\d]*(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/i.exec(schedule) : null;
  return { start: m?.[1] ?? null, end: m?.[2] ?? null };
}

/** Recompute status for "today". Called on every read, including cache hits, so a cached schedule cannot go stale silently. */
export function withStatus(d: CourseDetails, today: string = istToday()): CourseDetails {
  const { status, basis } = computeStatus(d.enrollment_start ?? null, d.enrollment_end ?? null, today);
  return { ...d, status, status_basis: basis };
}

// ---------- tools ----------

export const searchCoursesInput = {
  query: z.string().min(2).describe("Keywords, e.g. 'machine learning'. Required."),
  discipline: z.string().optional().describe("Optional discipline filter, e.g. 'Computer Science' (matched as a substring of NPTEL's discipline label, derived from the course id prefix)."),
  institute: z.string().optional().describe("Optional institute filter, e.g. 'IIT Madras'. Hard filter applied to each course's institute, as NPTEL spells it."),
  limit: z.number().int().min(1).max(20).default(10).describe("Max courses to return (1-20, default 10)."),
  refresh: z.boolean().default(false).describe("Set true to bypass the cache and re-run the live search."),
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function searchCourses(a: { query: string; discipline?: string; institute?: string; limit?: number; refresh?: boolean }): Promise<CourseSummary[]> {
  const limit = a.limit ?? 10;
  const ck = `search2:${JSON.stringify([norm(a.query), a.discipline && norm(a.discipline), a.institute && norm(a.institute)])}`;
  const cached = cacheGet<CourseSummary[]>(ck, a.refresh);
  if (cached) return cached.slice(0, limit);
  const q = `site:nptel.ac.in/courses ${a.query}${a.discipline ? " " + a.discipline : ""}${a.institute ? " " + a.institute : ""}`;
  const hits = parseSearchApi(await searchWeb(q));
  // Over-fetch (noise and filters remove some), capped to keep Fetch cheap.
  const candidates = hits.slice(0, Math.min(20, limit * 2));
  const out: CourseSummary[] = [];
  for (let i = 0; i < candidates.length; i += 10) {
    const chunk = candidates.slice(i, i + 10);
    const fetched = await fetchPages(chunk.map((h) => detailUrl(h.id)), a.refresh ? 0 : undefined);
    for (const hit of chunk) {
      const url = detailUrl(hit.id);
      const failed = fetched.failed.get(url);
      if (failed) {
        if (failed.status === 429) throw new NptelError("RATE_LIMITED", "Fetch rate limited", "search_courses");
        continue; // stale search hit (course page gone)
      }
      const text = fetched.texts.get(url);
      if (text === undefined) throw structureChanged("search_courses", "results", `no Fetch result for ${url}`);
      const d = parseDetailText(hit.id, text);
      if (a.institute && !(d.institute && norm(d.institute).includes(norm(a.institute)))) continue;
      if (a.discipline && !(d.discipline && norm(d.discipline).includes(norm(a.discipline)))) continue;
      if (!isRelevant(a.query, { title: d.title, instructors: d.instructors, snippet: hit.snippet })) continue;
      out.push(CourseSummary.parse({ course_id: hit.id, title: d.title, discipline: d.discipline, institute: d.institute, instructors: d.instructors, url }));
    }
    if (out.length >= limit) break;
  }
  const result = out.slice(0, limit);
  cacheSet(ck, result, TTL.search);
  return result;
}

export const getCourseInput = {
  course_id: CourseId.describe("9-digit NPTEL course id, e.g. '101101079' (from search_courses)."),
  refresh: z.boolean().default(false).describe("Set true to bypass the cache and re-fetch."),
  enrich: z.boolean().default(true).describe("Default true: run TinyFish Agent steps for duration/schedule/enrollment dates (and the syllabus when NPTEL's syllabus PDF is unavailable); up to 120 s each. Set false for a fast Fetch-only answer (still includes the syllabus PDF when it exists)."),
};

const FIELDS = ["discipline", "syllabus", "duration", "schedule"] as const;

// ---- Agent step 1: duration / schedule / enrollment window ----
export const ENRICH_GOAL =
  "Read this NPTEL course page. Return: duration (the 'Course Duration' value, e.g. 'Jul-Oct 2026'); enrollment_start and enrollment_end (the two dates of the 'Enrollment' line, formatted YYYY-MM-DD); schedule (the Enrollment, Exam Registration and Exam Date lines as one text). Use null for anything the page does not show. Do not invent anything.";
const ENRICH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    duration: { type: "string", nullable: true },
    schedule: { type: "string", nullable: true },
    enrollment_start: { type: "string", nullable: true },
    enrollment_end: { type: "string", nullable: true },
  },
};
const AgentEnrichment = z.object({
  duration: z.string().nullish(), schedule: z.string().nullish(), enrollment_start: z.string().nullish(), enrollment_end: z.string().nullish(),
});

/** Merge a validated Agent result into a Fetch-derived course (never overwrites existing values). Malformed output throws. */
export function applyAgentFields(base: CourseDetails, raw: unknown): CourseDetails {
  const p = AgentEnrichment.safeParse(raw);
  if (!p.success) throw structureChanged("get_course", `enrichment.${p.error.issues[0].path.join(".")}`, p.error.issues[0].message);
  const t = (v: string | null | undefined) => v?.trim() || null;
  const d = { ...base };
  d.duration ??= t(p.data.duration);
  d.schedule ??= t(p.data.schedule);
  const fromText = datesFromSchedule(d.schedule);
  const iso = (v: string | null | undefined) => { const s = t(v); return s && ISO_DATE.test(s) ? s : null; };
  d.enrollment_start ??= iso(p.data.enrollment_start) ?? fromText.start;
  d.enrollment_end ??= iso(p.data.enrollment_end) ?? fromText.end;
  return d;
}

// ---- Agent step 2: targeted "click the Syllabus tab" run ----
export const SYLLABUS_GOAL =
  "On this NPTEL course page click the 'Syllabus' link in the tab row. It opens a PDF or a new tab. Open it, find the 'COURSE PLAN' section and copy the week-by-week plan, one line per week formatted 'Week N: topics'. If you cannot open it or no plan is shown, return null. Do not invent anything.";
export const SYLLABUS_OUTPUT_SCHEMA = {
  type: "object",
  properties: { syllabus: { type: "string", nullable: true } },
};
const AgentSyllabus = z.object({ syllabus: z.string().nullish() });

export function applySyllabus(base: CourseDetails, text: string | null, source: "nptel_syllabus_pdf" | "agent_syllabus_tab"): CourseDetails {
  const s = text ? parseSyllabusText(text) : null;
  return s && base.syllabus === null ? { ...base, syllabus: s, syllabus_source: source } : base;
}

export function applyAgentSyllabus(base: CourseDetails, raw: unknown): CourseDetails {
  const p = AgentSyllabus.safeParse(raw);
  if (!p.success) throw structureChanged("get_course", `syllabus.${p.error.issues[0].path.join(".")}`, p.error.issues[0].message);
  return applySyllabus(base, p.data.syllabus ?? null, "agent_syllabus_tab");
}

/** Final bookkeeping: fields_unavailable, enrichment state, and the per-day status. Pure. */
export function finishEnrichment(d: CourseDetails, ran: boolean, errors: string[], today?: string): CourseDetails {
  const fields_unavailable = FIELDS.filter((f) => d[f] === null);
  const found = (["syllabus", "duration", "schedule"] as const).filter((f) => d[f] !== null).length;
  let enrichment: CourseDetails["enrichment"] = "skipped";
  let enrichment_error: string | null = null;
  if (ran) {
    enrichment = found === 3 ? "ok" : found > 0 ? "partial" : "failed";
    const errs = [...errors];
    if (found === 0 && errs.length === 0) errs.push("SUSPECT: Agent run completed but returned none of syllabus/duration/schedule");
    enrichment_error = errs.length ? errs.join(" | ") : null;
  }
  return withStatus(CourseDetails.parse({ ...d, fields_unavailable, enrichment, enrichment_error }), today);
}

const errText = (e: unknown) => (e instanceof NptelError ? `${e.code}: ${e.message}` : (e as Error).message);

async function agentStep<T>(step: () => Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await step(), error: null };
  } catch (e) {
    if (e instanceof NptelError && e.code === "SITE_STRUCTURE_CHANGED") throw e;
    return { value: null, error: errText(e) };
  }
}

export async function getCourse(a: { course_id: string; refresh?: boolean; enrich?: boolean; today?: string }): Promise<CourseDetails> {
  const id = CourseId.parse(a.course_id);
  const wantEnrich = a.enrich ?? true;
  const ck = `course2:${id}`;
  const cached = cacheGet<CourseDetails>(ck, a.refresh);
  if (cached && (!wantEnrich || cached.enrichment !== "skipped")) return withStatus(CourseDetails.parse(cached), a.today);
  const url = detailUrl(id);
  const pdfUrl = syllabusPdfUrl(id);
  const out = await fetchPages([url, pdfUrl], a.refresh ? 0 : undefined);
  const failed = out.failed.get(url);
  if (failed) {
    if (failed.status === 404 || failed.status === 500 || failed.status === 410) {
      throw new NptelError("NOT_FOUND", `No NPTEL course with id ${id} (site returned HTTP ${failed.status})`, "get_course");
    }
    if (failed.status === 429) throw new NptelError("RATE_LIMITED", "NPTEL/TinyFish rate limited the fetch", "get_course");
    throw new NptelError("TINYFISH_FAILED", `Fetch of ${url} failed: ${failed.error} (${failed.status})`, "get_course");
  }
  const text = out.texts.get(url);
  let detail: CourseDetails;
  try {
    if (text === undefined || text.trim() === "") throw structureChanged("get_course", "results", `Fetch returned empty content for ${url}`);
    detail = parseDetailText(id, text);
  } catch (e) {
    if (!(e instanceof NptelError) || e.code !== "SITE_STRUCTURE_CHANGED") throw e;
    detail = await getCourseViaAgent(id); // Fetch gave empty/unrendered content: render the page with the Agent
  }
  // Syllabus, cheapest source first: NPTEL's own syllabus PDF (Fetch).
  const pdfText = out.texts.get(pdfUrl);
  if (pdfText) detail = applySyllabus(detail, pdfText, "nptel_syllabus_pdf");

  const errors: string[] = [];
  if (wantEnrich) {
    const [dates, syl] = await Promise.all([
      agentStep(() => runAgent(
        url,
        ENRICH_GOAL,
        ENRICH_OUTPUT_SCHEMA,
        0,
      )),
      detail.syllabus === null
        ? agentStep(() => runAgent(
          url,
          SYLLABUS_GOAL,
          SYLLABUS_OUTPUT_SCHEMA,
          0,
        ))
        : Promise.resolve({ value: null, error: null }),
    ]);
    if (dates.error) errors.push(`duration/schedule: ${dates.error}`);
    else if (dates.value !== null) detail = applyAgentFields(detail, dates.value);
    if (syl.error) errors.push(`syllabus: ${syl.error}`);
    else if (syl.value !== null) detail = applyAgentSyllabus(detail, syl.value);
  }
  detail = finishEnrichment(detail, wantEnrich, errors, a.today);
  cacheSet(ck, detail, detail.enrichment === "failed" ? 600 : TTL.detail);
  return detail;
}

const COURSE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    institute: { type: "string", nullable: true },
    instructors: { type: "array", items: { type: "string" } },
  },
  required: ["title", "instructors"],
};
const AgentCourse = z.object({
  title: z.string().min(1),
  institute: z.string().nullish(),
  instructors: z.array(z.string()),
});

/** Fallback only: used when Fetch returns empty or unrendered content (120 s cap). */
export async function getCourseViaAgent(id: string): Promise<CourseDetails> {
  console.error(`[nptel-mcp] get_course(${id}): Fetch content unusable, falling back to Agent`);
  const raw = await runAgent(
    detailUrl(id),
    "Read this NPTEL course page. Return the course title, institute and instructor names exactly as the page shows them. Do not invent anything.",
    COURSE_OUTPUT_SCHEMA,
  );
  const p = AgentCourse.safeParse(raw);
  if (!p.success) throw structureChanged("get_course", p.error.issues[0].path.join(".") || "result", p.error.issues[0].message);
  const d = p.data;
  return CourseDetails.parse({
    course_id: id, title: d.title, institute: d.institute ?? null, discipline: disciplineFromId(id), instructors: d.instructors,
    syllabus: null, duration: null, schedule: null, url: detailUrl(id), available_sections: [],
  });
}

export const compareCoursesInput = {
  course_ids: z.array(CourseId).min(2).max(5).describe("2 to 5 distinct 9-digit NPTEL course ids to compare."),
  refresh: z.boolean().default(false).describe("Bypass cache for every course."),
  enrich: z.boolean().default(false).describe("Default false (fast, Fetch only). Set true to run Agent steps per course for duration/schedule/enrollment dates (slow, up to 120 s each, 2 at a time)."),
};

export function buildComparison(courses: CourseDetails[]): Comparison {
  const fmt = (c: CourseDetails, f: string): string | null => {
    const v = (c as Record<string, unknown>)[f];
    return Array.isArray(v) ? (v.length ? v.join("; ") : null) : ((v as string | null) ?? null);
  };
  const names = ["title", "institute", "discipline", "instructors", "status", "duration", "schedule", "syllabus"];
  const fields = names.map((field) => {
    const values = Object.fromEntries(courses.map((c) => [c.course_id, field === "status" && courses.every((c) => c.status === "unknown") ? null : fmt(c, field)]));
    return { field, values, differs: new Set(Object.values(values)).size > 1 };
  });
  const diff = fields.filter((f) => f.differs).map((f) => f.field);
  const unknown = fields.filter((f) => Object.values(f.values).every((v) => v === null)).map((f) => f.field);
  return Comparison.parse({
    courses, fields,
    summary: `Compared ${courses.length} courses. Differing fields: ${diff.join(", ") || "none"}. Unavailable for all of them (enrich=false skips duration/schedule/status): ${unknown.join(", ") || "none"}.`,
  });
}

export async function compareCourses(a: { course_ids: string[]; refresh?: boolean; enrich?: boolean }): Promise<Comparison> {
  const ids = [...new Set(a.course_ids)];
  if (ids.length < 2 || ids.length > 5) throw new NptelError("NOT_FOUND", "compare_courses needs 2 to 5 distinct course ids", "compare_courses");
  const courses = await Promise.all(ids.map((id) => getCourse({ course_id: id, refresh: a.refresh, enrich: a.enrich ?? false })));
  return buildComparison(courses);
}
