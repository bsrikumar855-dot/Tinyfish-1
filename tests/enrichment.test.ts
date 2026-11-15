// FIXTURES + MOCKS. Page text, syllabus PDF text and the "missing PDF" Fetch error are RECORDED REAL TinyFish responses
// (tests/fixtures, captured 2026-11-15). The Agent is MOCKED to force each code path; its "ok" payloads are hand-written
// from what the live pages showed - they are NOT recorded Agent responses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const { runAgent, agent } = vi.hoisted(() => {
  process.env.NPTEL_CACHE_DIR = require("node:path").join(require("node:os").tmpdir(), "nptel-mcp-test-cache");
  const agent = { impl: async (..._a: unknown[]): Promise<unknown> => undefined, goals: [] as string[] };
  // plain function, not vi.fn: vitest spies leak an unhandled rejection when the mocked promise rejects
  const runAgent = (...a: unknown[]) => { agent.goals.push(String(a[1])); return agent.impl(...a); };
  return { runAgent, agent };
});
const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const pages = fx("fetch_relevance_pages.json");
const pdf = fx("fetch_syllabus_pdf_106106139.json");
const pageOf = (id: string) => pages.results.find((r: { url: string }) => r.url.endsWith(id));
const state = { pdf: "present" as "present" | "missing" };

vi.mock("../src/tinyfish.js", async () => {
  const real = await vi.importActual<typeof import("../src/tinyfish.js")>("../src/tinyfish.js");
  return {
    ...real,
    runAgent,
    fetchPages: vi.fn(async (urls: string[]) => real.parseFetchResponse({
      results: urls.flatMap((url) => {
        if (url.includes("syllabus_pdf")) return state.pdf === "present" ? [{ ...pdf.results[0], url }] : [];
        return [{ ...pageOf(url.slice(-9)), url }];
      }),
      errors: urls.filter((u) => u.includes("syllabus_pdf") && state.pdf === "missing").map((url) => ({ ...pdf.errors[0], url })),
    })),
  };
});

import { NptelError } from "../src/errors.js";
import { applyAgentFields, finishEnrichment, getCourse, parseDetailText } from "../src/tools.js";

const ML = "106106139";
const TODAY = "2026-11-15";
const base = () => parseDetailText(ML, pageOf(ML).text);
const isSyllabusGoal = (g: unknown) => String(g).includes("'Syllabus' link");
const DATES = { duration: "Jul-Oct 2026", schedule: "Enrollment : 2026-05-22 to 2026-07-27, Exam Date : 2026-10-18", enrollment_start: "2026-05-22", enrollment_end: "2026-07-27" };

describe("get_course syllabus + enrichment paths (mocked Agent, real Fetch fixtures)", () => {
  beforeEach(() => { agent.goals = []; agent.impl = async () => undefined; state.pdf = "present"; });

  it("syllabus PDF available: syllabus from Fetch, only ONE Agent run, enrichment ok, nothing unavailable", async () => {
    agent.impl = async () => DATES;
    const c = await getCourse({ course_id: ML, refresh: true, enrich: true, today: TODAY });
    expect(agent.goals).toHaveLength(1);
    expect(c.syllabus_source).toBe("nptel_syllabus_pdf");
    expect((c.syllabus!.match(/^Week \d+/gm) ?? []).length).toBe(13);
    expect(c.discipline).toBe("Computer Science And Engineering");
    expect(c.enrichment).toBe("ok");
    expect(c.fields_unavailable).toEqual([]);
    expect(c.status).toBe("closed");
  });

  it("PDF missing: runs the targeted Syllabus-tab Agent step and uses its week-by-week text", async () => {
    state.pdf = "missing";
    agent.impl = async (_u, goal) => (isSyllabusGoal(goal) ? { syllabus: "Week 1: Intro\nWeek 2: Regression" } : DATES);
    const c = await getCourse({ course_id: ML, refresh: true, enrich: true, today: TODAY });
    expect(agent.goals).toHaveLength(2);
    expect(c.syllabus_source).toBe("agent_syllabus_tab");
    expect(c.enrichment).toBe("ok");
    expect(c.fields_unavailable).toEqual([]);
  });

  it("PDF missing and the Agent cannot find a plan: enrichment is 'partial', syllabus stays in fields_unavailable", async () => {
    state.pdf = "missing";
    agent.impl = async (_u, goal) => (isSyllabusGoal(goal) ? { syllabus: null } : DATES); // real live behaviour of this step on 106106139
    const c = await getCourse({ course_id: ML, refresh: true, enrich: true, today: TODAY });
    expect(c.syllabus).toBeNull();
    expect(c.enrichment).toBe("partial");
    expect(c.fields_unavailable).toEqual(["syllabus"]);
  });

  it("an abstract-only Agent answer (no week lines) is rejected as a syllabus", async () => {
    state.pdf = "missing";
    agent.impl = async (_u, goal) => (isSyllabusGoal(goal) ? { syllabus: "This course introduces machine learning to senior students." } : DATES);
    const c = await getCourse({ course_id: ML, refresh: true, enrich: true, today: TODAY });
    expect(c.syllabus).toBeNull();
    expect(c.enrichment).toBe("partial");
  });

  it("Agent platform failure: Fetch data (incl. PDF syllabus) still returned, enrichment partial with the error recorded", async () => {
    agent.impl = async () => { throw new NptelError("TINYFISH_FAILED", "Agent run abc FAILED: Something went wrong on our side"); };
    const c = await getCourse({ course_id: ML, refresh: true, enrich: true, today: TODAY });
    expect(c.syllabus).not.toBeNull();
    expect(c.duration).toBeNull();
    expect(c.enrichment).toBe("partial");
    expect(c.enrichment_error).toMatch(/TINYFISH_FAILED/);
    expect(c.fields_unavailable).toEqual(["duration", "schedule"]);
    expect(c.status).toBe("unknown");
  });

  it("everything failing is 'failed'", async () => {
    state.pdf = "missing";
    agent.impl = async () => { throw new NptelError("TINYFISH_FAILED", "boom"); };
    const c = await getCourse({ course_id: ML, refresh: true, enrich: true, today: TODAY });
    expect(c.enrichment).toBe("failed");
    expect(c.fields_unavailable).toEqual(["syllabus", "duration", "schedule"]);
  });

  it("enrich=false never calls the Agent but still returns the PDF syllabus", async () => {
    const c = await getCourse({ course_id: ML, refresh: true, enrich: false, today: TODAY });
    expect(agent.goals).toHaveLength(0);
    expect(c.enrichment).toBe("skipped");
    expect(c.syllabus_source).toBe("nptel_syllabus_pdf");
    expect(c.fields_unavailable).toEqual(["duration", "schedule"]);
    expect(c.status).toBe("unknown");
  });

  it("a cached result is re-evaluated against today's date (stale schedules flip to closed)", async () => {
    agent.impl = async () => DATES;
    const first = await getCourse({ course_id: ML, refresh: true, enrich: true, today: "2026-06-01" });
    expect(first.status).toBe("open");
    const again = await getCourse({ course_id: ML, enrich: true, today: "2026-12-01" }); // served from cache
    expect(again.status).toBe("closed");
    expect(again.status_basis).toContain("today 2026-12-01");
  });
});

describe("pure enrichment helpers", () => {
  it("malformed Agent result is SITE_STRUCTURE_CHANGED, not silently ignored", () => {
    try { applyAgentFields(base(), { duration: 42 }); expect.unreachable(); } catch (e) {
      expect((e as NptelError).code).toBe("SITE_STRUCTURE_CHANGED");
      expect((e as NptelError).tool).toBe("get_course");
      expect((e as NptelError).field).toBe("enrichment.duration");
    }
  });

  it("never overwrites a value already known", () => {
    expect(applyAgentFields({ ...base(), duration: "from-fetch" }, { duration: "from-agent" }).duration).toBe("from-fetch");
  });

  it("derives the enrollment window from the schedule text when the Agent omits the structured dates", () => {
    const d = applyAgentFields(base(), { schedule: "Enrollment : 2026-05-22 to 2026-07-27", duration: "Jul-Oct 2026" });
    expect([d.enrollment_start, d.enrollment_end]).toEqual(["2026-05-22", "2026-07-27"]);
  });

  it("ignores a non-ISO date from the Agent instead of trusting it", () => {
    const d = applyAgentFields(base(), { enrollment_start: "May 22", enrollment_end: "July 27", duration: "x" });
    expect(d.enrollment_start).toBeNull();
  });

  it("an Agent run that found nothing at all is flagged SUSPECT/failed, not ok", () => {
    const c = finishEnrichment(base(), true, [], TODAY);
    expect(c.enrichment).toBe("failed");
    expect(c.enrichment_error).toMatch(/SUSPECT/);
  });
});
