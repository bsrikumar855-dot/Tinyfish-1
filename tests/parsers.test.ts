// FIXTURES: tests/fixtures/*.json are recorded REAL TinyFish responses captured 2026-11-15
// against nptel.ac.in (see docs/site-notes.md). Nothing here hits the network.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NptelError } from "../src/errors.js";
import { parseFetchResponse, parseSse, resultFromEvents } from "../src/tinyfish.js";
import { disciplineFromId } from "../src/disciplines.js";
import { buildComparison, computeStatus, courseIdFromLink, datesFromSchedule, isRelevant, parseDetailText, parseSearchApi, parseSyllabusText, searchTerms } from "../src/tools.js";

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
    const ids = parseSearchApi(raw).map((h) => h.id);
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
    const ids = parseSearchApi({ results: [{ url: "https://evil.example.com/courses/111111111" }, { url: "https://nptel.ac.in/courses/222222222" }, { url: "https://nptel.ac.in.evil.com/courses/333333333" }] }).map((h) => h.id);
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

// ---------------- new in 0.1.2 ----------------
const pageText = (id: string) =>
  fx("fetch_relevance_pages.json").results.find((r: { url: string }) => r.url.endsWith(id)).text as string;

describe("search relevance (REAL Search + Fetch fixtures for 'machine learning' + IIT Madras)", () => {
  // Real response: besides ML courses it contains Computational Neuroscience (102106023), Analog IC Design (117106030)
  // and Design and Analysis of Algorithms (106101060), which matched only on "IIT Madras"/"IIT Bombay".
  const hits = parseSearchApi(fx("search_machine_learning_iit_madras.json"));
  const verdict = (id: string) => {
    const d = parseDetailText(id, pageText(id));
    return isRelevant("machine learning", { title: d.title, instructors: d.instructors, snippet: hits.find((h) => h.id === id)!.snippet });
  };
  it("drops the Computational Neuroscience and Analog IC Design noise hits", () => {
    expect(hits.map((h) => h.id)).toEqual(expect.arrayContaining(["102106023", "117106030"]));
    expect(verdict("102106023")).toBe(false);
    expect(verdict("117106030")).toBe(false);
    expect(verdict("106101060")).toBe(false);
  });
  it("keeps genuine machine-learning courses", () => {
    expect(verdict("106106139")).toBe(true);
    expect(verdict("106106213")).toBe(true);
    expect(verdict("106106245")).toBe(true);
  });
  it("keeps a hit whose title shares no term when the snippet contains every query term", () => {
    expect(isRelevant("machine learning", { title: "Course Details", instructors: [], snippet: "an introduction to machine learning methods" })).toBe(true);
    expect(isRelevant("machine learning", { title: "Course Details", instructors: [], snippet: "an introduction to learning" })).toBe(false);
  });
  it("treats plurals alike and ignores stopwords", () => {
    expect(searchTerms("Introduction to Machines and the Learning")).toEqual(["machine", "learning"]);
  });
});

describe("syllabus parsing (REAL syllabus PDF fixture via Fetch, course 106106139)", () => {
  const pdf = fx("fetch_syllabus_pdf_106106139.json");
  it("extracts the week-by-week COURSE PLAN and drops the footer title", () => {
    const s = parseSyllabusText(pdf.results[0].text)!;
    expect(s.split("\n")[0]).toMatch(/^Week 0: Probability Theory/);
    expect((s.match(/^Week \d+/gm) ?? []).length).toBe(13);
    expect(s).not.toMatch(/INTRODUCTION TO MACHINE/);
  });
  it("a missing PDF is reported by Fetch as target_unreachable (real entry), and an abstract alone is not a syllabus", () => {
    expect(pdf.errors[0].error).toBe("target_unreachable");
    expect(parseSyllabusText("ABOUT THE COURSE : something long enough but no weeks at all here")).toBeNull();
  });
});

describe("discipline from course id prefix (mapping read from the live listing on 2026-11-15)", () => {
  it("maps known prefixes", () => {
    expect(disciplineFromId("106106139")).toBe("Computer Science And Engineering");
    expect(disciplineFromId("101101079")).toBe("Aerospace Engineering");
    expect(disciplineFromId("117106030")).toBe("Electronics & Communication Engineering");
    expect(disciplineFromId("102106023")).toBe("Biotechnology");
  });
  it("returns null only for an unmapped prefix", () => {
    expect(disciplineFromId("125101001")).toBeNull();
    expect(disciplineFromId("999999999")).toBeNull();
  });
  it("is applied by the page parser", () => {
    expect(parseDetailText("106106139", pageText("106106139")).discipline).toBe("Computer Science And Engineering");
  });
});

describe("enrollment status", () => {
  it("open / upcoming / closed from the window, inclusive of both ends", () => {
    expect(computeStatus("2026-05-22", "2026-07-27", "2026-05-21").status).toBe("upcoming");
    expect(computeStatus("2026-05-22", "2026-07-27", "2026-05-22").status).toBe("open");
    expect(computeStatus("2026-05-22", "2026-07-27", "2026-07-27").status).toBe("open");
    expect(computeStatus("2026-05-22", "2026-07-27", "2026-07-28").status).toBe("closed");
  });
  it("unknown when dates are missing or malformed", () => {
    expect(computeStatus(null, null, "2026-11-15").status).toBe("unknown");
    expect(computeStatus("22/05/2026", "2026-07-27", "2026-11-15").status).toBe("unknown");
  });
  it("reads the enrollment window from a schedule text (real live text)", () => {
    const s = "Enrollment : 2026-05-22 to 2026-07-27, Exam Registration : 2026-06-20 to 2026-08-14, Exam Date : 2026-10-18";
    expect(datesFromSchedule(s)).toEqual({ start: "2026-05-22", end: "2026-07-27" });
  });
});
