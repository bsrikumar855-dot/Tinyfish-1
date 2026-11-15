import { z } from "zod";
import { cacheGet, cacheSet, TTL } from "./cache.js";
import { NptelError, structureChanged } from "./errors.js";
import {
  SearchApiResponse, Comparison, CourseDetails, CourseId, CourseSummary, } from "./schemas.js";
import { fetchPages, runAgent, searchWeb } from "./tinyfish.js";

const LISTING = "https://nptel.ac.in/courses";
const detailUrl = (id: string) => `${LISTING}/${id}`;

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
    course_id: courseId, title, institute, discipline: null, instructors,
    syllabus: null, duration: null, schedule: null, url: detailUrl(courseId), available_sections,
  });
}

export function courseIdFromLink(link: string): string | null {
  return /(?:^|\/courses\/)(\d{9})(?:[/?#]|$)/.exec(link)?.[1] ?? null;
}

/** Parse TinyFish Search API output into unique course ids (order = relevance). */
export function parseSearchApi(raw: unknown): string[] {
  const p = SearchApiResponse.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw structureChanged("search_courses", i.path.join(".") || "result", i.message);
  }
  const ids: string[] = [];
  for (const r of p.data.results) {
    let host = "";
    try { host = new URL(r.url).hostname; } catch { /* drop unparsable urls */ }
    if (host !== "nptel.ac.in" && !host.endsWith(".nptel.ac.in")) continue; // only nptel.ac.in results are trusted
    const id = courseIdFromLink(r.url);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------- tools ----------

export const searchCoursesInput = {
  query: z.string().min(2).describe("Keywords, e.g. 'machine learning'. Required."),
  discipline: z.string().optional().describe("Optional discipline words added to the search, e.g. 'Computer Science'. Soft filter: NPTEL detail pages do not show discipline, so returned discipline is null."),
  institute: z.string().optional().describe("Optional institute filter, e.g. 'IIT Madras'. Hard filter applied to each course's institute. Use the institute name as it appears on NPTEL, e.g. 'IIT Madras'."),
  limit: z.number().int().min(1).max(20).default(10).describe("Max courses to return (1-20, default 10)."),
  refresh: z.boolean().default(false).describe("Set true to bypass the cache and re-run the live search."),
};

const norm = (s: string) => s.toLowerCase().replace(/s+/g, " ").trim();

export async function searchCourses(a: { query: string; discipline?: string; institute?: string; limit?: number; refresh?: boolean }): Promise<CourseSummary[]> {
  const limit = a.limit ?? 10;
  const ck = `search:${JSON.stringify([norm(a.query), a.discipline && norm(a.discipline), a.institute && norm(a.institute)])}`;
  const cached = cacheGet<CourseSummary[]>(ck, a.refresh);
  if (cached) return cached.slice(0, limit);
  const q = `site:nptel.ac.in/courses ${a.query}${a.discipline ? " " + a.discipline : ""}${a.institute ? " " + a.institute : ""}`;
  const ids = parseSearchApi(await searchWeb(q));
  const candidates = ids.slice(0, a.institute ? Math.min(20, limit * 2) : limit);
  const out: CourseSummary[] = [];
  for (let i = 0; i < candidates.length; i += 10) {
    const chunk = candidates.slice(i, i + 10);
    const fetched = await fetchPages(chunk.map(detailUrl), a.refresh ? 0 : undefined);
    for (const id of chunk) {
      const url = detailUrl(id);
      const failed = fetched.failed.get(url);
      if (failed) {
        if (failed.status === 429) throw new NptelError("RATE_LIMITED", "Fetch rate limited", "search_courses");
        continue; // stale search hit (course page gone)
      }
      const text = fetched.texts.get(url);
      if (text === undefined) throw structureChanged("search_courses", "results", `no Fetch result for ${url}`);
      const d = parseDetailText(id, text);
      cacheSet(`course:${id}`, d, TTL.detail);
      if (a.institute && !(d.institute && norm(d.institute).includes(norm(a.institute)))) continue;
      out.push(CourseSummary.parse({ course_id: id, title: d.title, discipline: null, institute: d.institute, instructors: d.instructors, url }));
    }
  }
  const result = out.slice(0, limit);
  cacheSet(ck, result, TTL.search);
  return result;
}

export const getCourseInput = {
  course_id: CourseId.describe("9-digit NPTEL course id, e.g. '101101079' (from search_courses)."),
  refresh: z.boolean().default(false).describe("Set true to bypass the cache and re-fetch."),
  enrich: z.boolean().default(true).describe("Default true: if discipline/syllabus/duration/schedule are missing from the static page, run ONE TinyFish Agent enrichment (up to 120 s). Set false for a fast Fetch-only answer."),
};

const ENRICHABLE = ["discipline", "syllabus", "duration", "schedule"] as const;

const ENRICH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    discipline: { type: "string", nullable: true },
    syllabus: { type: "string", nullable: true },
    duration: { type: "string", nullable: true },
    schedule: { type: "string", nullable: true },
  },
};
const AgentEnrichment = z.object({
  discipline: z.string().nullish(), syllabus: z.string().nullish(), duration: z.string().nullish(), schedule: z.string().nullish(),
});

/** Pure merge of an Agent enrichment result (or its failure) into a Fetch-derived course. */
export function applyEnrichment(base: CourseDetails, raw: unknown, error: string | null): CourseDetails {
  const merged: Record<string, unknown> = { ...base };
  let status: "ok" | "failed" = "ok";
  let err: string | null = null;
  if (error !== null) {
    status = "failed";
    err = error;
  } else {
    const p = AgentEnrichment.safeParse(raw);
    if (!p.success) throw structureChanged("get_course", `enrichment.${p.error.issues[0].path.join(".")}`, p.error.issues[0].message);
    for (const f of ENRICHABLE) {
      const v = p.data[f]?.trim();
      if (v && base[f] === null) merged[f] = v;
    }
  }
  const fields_unavailable = ENRICHABLE.filter((f) => merged[f] === null);
  return CourseDetails.parse({ ...merged, fields_unavailable, enrichment: status, enrichment_error: err });
}

async function enrich(base: CourseDetails): Promise<CourseDetails> {
  try {
    const raw = await runAgent(
      base.url,
      "Read this NPTEL course page. Return: discipline (only if the page names one), syllabus (the syllabus/course abstract text, only if shown), duration (the 'Course Duration' value), schedule (enrollment, exam registration and exam date lines as one text). Use null for anything the page does not show. Do not invent anything.",
      ENRICH_OUTPUT_SCHEMA,
      0,
    );
    return applyEnrichment(base, raw, null);
  } catch (e) {
    if (e instanceof NptelError && e.code === "SITE_STRUCTURE_CHANGED") throw e;
    return applyEnrichment(base, null, e instanceof NptelError ? `${e.code}: ${e.message}` : (e as Error).message);
  }
}

export async function getCourse(a: { course_id: string; refresh?: boolean; enrich?: boolean }): Promise<CourseDetails> {
  const id = CourseId.parse(a.course_id);
  const wantEnrich = a.enrich ?? true;
  const ck = `course:${id}`;
  const cached = cacheGet<CourseDetails>(ck, a.refresh);
  if (cached && (!wantEnrich || cached.enrichment !== "skipped")) return cached;
  const url = detailUrl(id);
  const out = await fetchPages([url], a.refresh ? 0 : undefined);
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
  detail = { ...detail, fields_unavailable: ENRICHABLE.filter((f) => detail[f] === null), enrichment: "skipped", enrichment_error: null };
  if (wantEnrich) detail = await enrich(detail);
  cacheSet(ck, detail, detail.enrichment === "failed" ? 600 : TTL.detail);
  return detail;
}

const COURSE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    institute: { type: "string", nullable: true },
    instructors: { type: "array", items: { type: "string" } },
    syllabus: { type: "string", nullable: true },
    duration: { type: "string", nullable: true },
  },
  required: ["title", "instructors"],
};
const AgentCourse = z.object({
  title: z.string().min(1),
  institute: z.string().nullish(),
  instructors: z.array(z.string()),
  syllabus: z.string().nullish(),
  duration: z.string().nullish(),
});

/** Fallback only: used when Fetch returns empty or unrendered content (120 s cap). */
export async function getCourseViaAgent(id: string): Promise<CourseDetails> {
  console.error(`[nptel-mcp] get_course(${id}): Fetch content unusable, falling back to Agent`);
  const raw = await runAgent(
    detailUrl(id),
    "Read this NPTEL course page. Return the course title, institute, instructor names, and the syllabus text and duration ONLY if the page shows them (otherwise null). Do not invent anything.",
    COURSE_OUTPUT_SCHEMA,
  );
  const p = AgentCourse.safeParse(raw);
  if (!p.success) throw structureChanged("get_course", p.error.issues[0].path.join(".") || "result", p.error.issues[0].message);
  const d = p.data;
  return CourseDetails.parse({
    course_id: id, title: d.title, institute: d.institute ?? null, discipline: null, instructors: d.instructors,
    syllabus: d.syllabus ?? null, duration: d.duration ?? null, schedule: null, url: detailUrl(id), available_sections: [],
  });
}

export const compareCoursesInput = {
  course_ids: z.array(CourseId).min(2).max(5).describe("2 to 5 distinct 9-digit NPTEL course ids to compare."),
  refresh: z.boolean().default(false).describe("Bypass cache for every course."),
  enrich: z.boolean().default(false).describe("Default false (fast, Fetch only). Set true to run one Agent enrichment per course (slow, up to 120 s each, 2 at a time)."),
};

export function buildComparison(courses: CourseDetails[]): Comparison {
  const fmt = (c: CourseDetails, f: string): string | null => {
    const v = (c as Record<string, unknown>)[f];
    return Array.isArray(v) ? (v.length ? v.join("; ") : null) : ((v as string | null) ?? null);
  };
  const fields = ["title", "institute", "discipline", "instructors", "duration", "schedule", "syllabus"].map((field) => {
    const values = Object.fromEntries(courses.map((c) => [c.course_id, fmt(c, field)]));
    return { field, values, differs: new Set(Object.values(values)).size > 1 };
  });
  const diff = fields.filter((f) => f.differs).map((f) => f.field);
  const unknown = fields.filter((f) => Object.values(f.values).every((v) => v === null)).map((f) => f.field);
  return Comparison.parse({
    courses, fields,
    summary: `Compared ${courses.length} courses. Differing fields: ${diff.join(", ") || "none"}. Not shown on NPTEL for any of them: ${unknown.join(", ") || "none"}.`,
  });
}

export async function compareCourses(a: { course_ids: string[]; refresh?: boolean; enrich?: boolean }): Promise<Comparison> {
  const ids = [...new Set(a.course_ids)];
  if (ids.length < 2 || ids.length > 5) throw new NptelError("NOT_FOUND", "compare_courses needs 2 to 5 distinct course ids", "compare_courses");
  const courses = await Promise.all(ids.map((id) => getCourse({ course_id: id, refresh: a.refresh, enrich: a.enrich ?? false })));
  return buildComparison(courses);
}
