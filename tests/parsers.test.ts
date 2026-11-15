// FIXTURES: tests/fixtures/*.json are recorded REAL TinyFish responses captured 2026-11-15
// against nptel.ac.in (see docs/site-notes.md). Nothing here hits the network.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NptelError } from "../src/errors.js";
import { parseFetchResponse, parseSse, resultFromEvents } from "../src/tinyfish.js";
import { buildComparison, courseIdFromLink, parseDetailText, parseSearchApi } from "../src/tools.js";

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));

describe("get_course parser (real Fetch fixtures)", () => {
  const f = fx("fetch_course_detail_101101079.json");
  it("extracts title, institute, instructors, sections; leaves unseen fields null", () => {
    const c = parseDetailText("101101079", f.results[0].text);
    expect(c.title).toBe("NOC: Introduction to Aerospace Engineering - Flight");
    expect(c.institute).toBe("IIT Bombay");
    expect(c.instructors).toEqual(["Prof. Rajkumar S. Pant"]);
    expect(c.syllabus).toBeNull();
    expect(c.duration).toBeNull();
    expect(c.available_sections).toContain("Syllabus");
  });
  it("handles a second real page (no sub-title)", () => {
    const two = fx("fetch_two_pages_101104061_and_bad.json");
    const c = parseDetailText("101104061", two.results[0].text);
    expect(c.title).toBe("NOC: Introduction to Airplane Performance");
    expect(c.institute).toBe("IIT Kanpur");
    expect(c.instructors).toEqual(["Prof. A K Ghosh"]);
  });
  it("throws SITE_STRUCTURE_CHANGED when the page layout is unrecognisable", () => {
    expect(() => parseDetailText("101101079", "Totally different page")).toThrowError(/SITE_STRUCTURE_CHANGED|expected shape/);
    try { parseDetailText("101101079", "Totally different page"); } catch (e) {
      expect((e as NptelError).code).toBe("SITE_STRUCTURE_CHANGED");
      expect((e as NptelError).tool).toBe("get_course");
    }
  });
});

describe("Fetch response parsing (real fixture)", () => {
  it("separates results from per-URL errors (nonexistent course -> HTTP 500 entry)", () => {
    const out = parseFetchResponse(fx("fetch_two_pages_101104061_and_bad.json"));
    expect(out.texts.has("https://nptel.ac.in/courses/101104061")).toBe(true);
    expect(out.failed.get("https://nptel.ac.in/courses/000000000")?.status).toBe(500);
  });
  it("rejects a malformed response with TINYFISH_FAILED", () => {
    expect(() => parseFetchResponse({ nope: 1 })).toThrowError(/Unexpected Fetch response shape/);
  });
});

describe("Agent event handling (real fixtures)", () => {
  it("returns result of a COMPLETED event", () => {
    const ok = fx("agent_complete_ok.json");
    expect(resultFromEvents([{ type: "STARTED" }, ok])).toEqual(ok.result);
  });
  it("turns a FAILED COMPLETE into TINYFISH_FAILED", () => {
    try { resultFromEvents([fx("agent_complete_failed.json")]); expect.unreachable(); } catch (e) {
      expect((e as NptelError).code).toBe("TINYFISH_FAILED");
    }
  });
  it("errors when the stream has no COMPLETE", () => {
    expect(() => resultFromEvents([{ type: "STARTED" }])).toThrowError(/without a COMPLETE/);
  });
  it("parses SSE text", () => {
    expect(parseSse('data: {"type":"STARTED"}\n\ndata: not-json\n\ndata: {"type":"HEARTBEAT"}\n')).toHaveLength(2);
  });
});

describe("search_courses parsing (real Search API fixture)", () => {
  const raw = fx("search_machine_learning.json");
  it("extracts unique 9-digit course ids in relevance order", () => {
    const ids = parseSearchApi(raw);
    expect(ids[0]).toBe("106106202");
    expect(ids).toContain("106106139");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("SITE_STRUCTURE_CHANGED when the Search response shape changes", () => {
    try { parseSearchApi({ items: [] }); expect.unreachable(); } catch (e) {
      expect((e as NptelError).code).toBe("SITE_STRUCTURE_CHANGED");
      expect((e as NptelError).tool).toBe("search_courses");
      expect((e as NptelError).field).toBe("results");
    }
  });
  it("drops results not on nptel.ac.in", () => {
    const ids = parseSearchApi({ results: [{ url: "https://evil.example.com/courses/111111111" }, { url: "https://nptel.ac.in/courses/222222222" }, { url: "https://nptel.ac.in.evil.com/courses/333333333" }] });
    expect(ids).toEqual(["222222222"]);
  });
  it("courseIdFromLink", () => {
    expect(courseIdFromLink("https://nptel.ac.in/courses/106106184")).toBe("106106184");
    expect(courseIdFromLink("/courses/abc")).toBeNull();
  });
  it("keeps a multi-part institute name (real heading seen live: KTH ..., Sweden)", () => {
    const c = parseDetailText("106106202", ["Previous semester scores migrated to the NEW WEBSITE!", "", "NOC: Machine Learning, ML, KTH Royal Institute of Technology, Sweden", "", "Prof. Carl Gustaf Jansson", "", "about coursedownloadsTA list"].join("\n"));
    expect(c.institute).toBe("KTH Royal Institute of Technology, Sweden");
    expect(c.title).toBe("NOC: Machine Learning, ML");
  });
});

describe("compare_courses builder", () => {
  it("flags differing fields and fields unknown for all", () => {
    const a = parseDetailText("101101079", fx("fetch_course_detail_101101079.json").results[0].text);
    const b = parseDetailText("101104061", fx("fetch_two_pages_101104061_and_bad.json").results[0].text);
    const cmp = buildComparison([a, b]);
    expect(cmp.fields.find((f) => f.field === "institute")?.differs).toBe(true);
    expect(cmp.summary).toMatch(/syllabus/);
  });
});
