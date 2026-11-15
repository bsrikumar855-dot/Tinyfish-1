import { z } from "zod";

export const CourseId = z.string().regex(/^\d{9}$/, "course_id must be the 9-digit NPTEL id, e.g. 101101079");

export const CourseSummary = z.object({
  course_id: CourseId,
  title: z.string().min(1),
  discipline: z.string().nullable(),
  institute: z.string().nullable(),
  instructors: z.array(z.string()),
  url: z.string().url(),
});
export type CourseSummary = z.infer<typeof CourseSummary>;

export const CourseDetails = z.object({
  course_id: CourseId,
  title: z.string().min(1),
  institute: z.string().nullable(),
  discipline: z.string().nullable(),
  instructors: z.array(z.string()),
  syllabus: z.string().nullable(),
  duration: z.string().nullable(),
  schedule: z.string().nullable(),
  url: z.string().url(),
  available_sections: z.array(z.string()),
  /** Enrollment window as YYYY-MM-DD, when found. */
  enrollment_start: z.string().nullable().default(null),
  enrollment_end: z.string().nullable().default(null),
  /** Enrollment status computed at call time (IST date) from the enrollment window; "unknown" when dates are unavailable. */
  status: z.enum(["open", "closed", "upcoming", "unknown"]).default("unknown"),
  status_basis: z.string().nullable().default(null),
  /** Where the syllabus text came from: NPTEL's own syllabus PDF (via Fetch) or an Agent run on the Syllabus tab. */
  syllabus_source: z.enum(["nptel_syllabus_pdf", "agent_syllabus_tab"]).nullable().default(null),
  /** Of discipline/syllabus/duration/schedule: the ones that could not be found (null in this object). */
  fields_unavailable: z.array(z.string()).default([]),
  /** "ok" = syllabus, duration and schedule all found; "partial" = some found; "failed" = none found / Agent failed; "skipped" = Agent not run (enrich=false). */
  enrichment: z.enum(["ok", "partial", "failed", "skipped"]).default("skipped"),
  enrichment_error: z.string().nullable().default(null),
});
export type CourseDetails = z.infer<typeof CourseDetails>;

export const Comparison = z.object({
  courses: z.array(CourseDetails),
  fields: z.array(z.object({ field: z.string(), values: z.record(z.string(), z.string().nullable()), differs: z.boolean() })),
  summary: z.string(),
});
export type Comparison = z.infer<typeof Comparison>;

// ---- Raw TinyFish shapes (from recorded real responses, see tests/fixtures) ----
export const FetchResponse = z.object({
  results: z.array(z.object({ url: z.string(), final_url: z.string().nullish(), text: z.string() }).passthrough()),
  errors: z.array(z.object({ url: z.string(), error: z.string(), status: z.number().nullish() }).passthrough()),
});

export const SearchApiResponse = z.object({ results: z.array(z.object({ url: z.string(), title: z.string().nullish(), snippet: z.string().nullish() }).passthrough()) });
