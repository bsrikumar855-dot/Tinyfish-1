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
  /** Of discipline/syllabus/duration/schedule: the ones that could not be found (null in this object). */
  fields_unavailable: z.array(z.string()).default([]),
  /** "ok" = Agent enrichment ran; "failed" = attempted and failed (see enrichment_error); "skipped" = not attempted. */
  enrichment: z.enum(["ok", "failed", "skipped"]).default("skipped"),
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
