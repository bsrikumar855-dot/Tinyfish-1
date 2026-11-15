// FIXTURES + MOCKS: the Fetch text is the recorded REAL response for course 106106202 (fixtures/fetch_course_detail_106106202_kth.json).
// The Agent is MOCKED here to force the enrichment code paths; the "ok" payload below is hand-written from what the
// live page (opened in a browser on 2026-11-15) shows - it is NOT a recorded Agent response.
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { runAgent, agent } = vi.hoisted(() => {
  process.env.NPTEL_CACHE_DIR = require("node:path").join(require("node:os").tmpdir(), "nptel-mcp-test-cache");
  const agent = { impl: async (..._a: unknown[]): Promise<unknown> => undefined, calls: 0 };
  // plain function, not vi.fn: vitest spies leak an unhandled rejection when the mocked promise rejects
  const runAgent = (...a: unknown[]) => { agent.calls++; return agent.impl(...a); };
  return { runAgent, agent };
});
const fetchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fetch_course_detail_106106202_kth.json"), "utf8"));

vi.mock("../src/tinyfish.js", async () => {
  const real = await vi.importActual<typeof import("../src/tinyfish.js")>("../src/tinyfish.js");
  return {
    ...real,
    runAgent,
    fetchPages: vi.fn(async (urls: string[]) => real.parseFetchResponse({ results: urls.map((url) => ({ ...fetchFixture.results[0], url })), errors: [] })),
  };
});

import { NptelError } from "../src/errors.js";
import { applyEnrichment, getCourse, parseDetailText } from "../src/tools.js";

const base = () => parseDetailText("106106202", fetchFixture.results[0].text);
void os;

describe("get_course enrichment path (forced via mocked Agent)", () => {
  beforeEach(() => { agent.calls = 0; agent.impl = async () => undefined; });

  it("fills fields the Agent found and lists the rest in fields_unavailable", async () => {
    agent.impl = async () => ({ duration: "Jan-Mar 2026", schedule: "Enrollment 2025-11-17 to 2026-01-26; Exam Date 2026-03-28", syllabus: null, discipline: null });
    const c = await getCourse({ course_id: "106106202", refresh: true, enrich: true });
    expect(agent.calls).toBe(1);
    expect(c.institute).toBe("KTH Royal Institute of Technology, Sweden");
    expect(c.duration).toBe("Jan-Mar 2026");
    expect(c.schedule).toContain("2026-03-28");
    expect(c.enrichment).toBe("ok");
    expect(c.fields_unavailable).toEqual(["discipline", "syllabus"]);
  });

  it("when the Agent fails (platform error), returns Fetch data with every enrichable field unavailable", async () => {
    agent.impl = async () => { throw new NptelError("TINYFISH_FAILED", "TINYFISH_FAILED: Agent run abc FAILED: Something went wrong on our side"); };
    const c = await getCourse({ course_id: "106106202", refresh: true, enrich: true });
    expect(c.enrichment).toBe("failed");
    expect(c.enrichment_error).toMatch(/TINYFISH_FAILED/);
    expect(c.fields_unavailable).toEqual(["discipline", "syllabus", "duration", "schedule"]);
    expect(c.title).toBe("NOC: Machine Learning, ML");
  });

  it("enrich=false never calls the Agent", async () => {
    const c = await getCourse({ course_id: "106106202", refresh: true, enrich: false });
    expect(agent.calls).toBe(0);
    expect(c.enrichment).toBe("skipped");
    expect(c.fields_unavailable).toHaveLength(4);
  });

  it("a malformed Agent result is SITE_STRUCTURE_CHANGED, not silently ignored", () => {
    try { applyEnrichment(base(), { duration: 42 }, null); expect.unreachable(); } catch (e) {
      expect((e as NptelError).code).toBe("SITE_STRUCTURE_CHANGED");
      expect((e as NptelError).tool).toBe("get_course");
      expect((e as NptelError).field).toBe("enrichment.duration");
    }
  });

  it("never overwrites a value already parsed from Fetch", () => {
    const b = { ...base(), duration: "from-fetch" };
    expect(applyEnrichment(b, { duration: "from-agent" }, null).duration).toBe("from-fetch");
  });
});
