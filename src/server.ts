#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NptelError } from "./errors.js";
import { compareCourses, compareCoursesInput, getCourse, getCourseInput, searchCourses, searchCoursesInput } from "./tools.js";

const server = new McpServer({ name: "nptel-mcp", version: "0.1.0" });

async function wrap(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    const err = e instanceof NptelError ? e.toJSON() : { code: "TINYFISH_FAILED", message: (e as Error).message, tool: null, field: null };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: err }, null, 2) }] };
  }
}

server.registerTool("search_courses", {
  description:
    "Search the NPTEL course catalogue by keywords, optionally narrowed by institute. Use this FIRST to find course_ids. " +
    "Uses TinyFish Search + Fetch (about 5-15 s); repeated searches are cached. Discipline in results is null (not shown on NPTEL detail pages).",
  inputSchema: searchCoursesInput,
}, (a) => wrap(() => searchCourses(a)));

server.registerTool("get_course", {
  description:
    "Get details of ONE NPTEL course by its 9-digit course_id (from search_courses): title, institute, instructors, and - via one TinyFish Agent enrichment run (up to 120 s) - " +
    "discipline, syllabus, duration and schedule when the page shows them. Anything not found is null and listed in fields_unavailable; never guessed. Pass enrich=false for a fast Fetch-only answer.",
  inputSchema: getCourseInput,
}, (a) => wrap(() => getCourse(a)));

server.registerTool("compare_courses", {
  description:
    "Compare 2-5 NPTEL courses side by side (title, institute, instructors, duration, schedule, syllabus) by calling get_course for each id. " +
    "Returns per-field values and which fields differ. Fast by default (Fetch only); pass enrich=true to include Agent-enriched duration/schedule/syllabus (slow). Use after search_courses when the user is choosing between courses.",
  inputSchema: compareCoursesInput,
}, (a) => wrap(() => compareCourses(a)));

await server.connect(new StdioServerTransport());
