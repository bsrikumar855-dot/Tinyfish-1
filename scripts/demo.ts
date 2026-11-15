// Drives the built MCP server over stdio with a real MCP client and prints a transcript.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "demo-client", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/server.js"] }));
const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "), "\n");

async function call(name: string, args: Record<string, unknown>) {
  console.log(`>>> ${name} ${JSON.stringify(args)}`);
  const t = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  console.log(`<<< ${r.isError ? "ERROR " : ""}(${((Date.now() - t) / 1000).toFixed(1)}s)\n${text}\n`);
  return r.isError ? null : JSON.parse(text);
}

const found = await call("search_courses", { query: "machine learning", institute: "IIT Madras", limit: 3, refresh: true });
const ids: string[] = (found ?? []).map((c: { course_id: string }) => c.course_id);
if (ids[0]) await call("get_course", { course_id: ids[0], refresh: true });
if (ids.length >= 2) await call("compare_courses", { course_ids: ids.slice(0, 3), refresh: true });
await call("get_course", { course_id: "000000000" });
await client.close();
