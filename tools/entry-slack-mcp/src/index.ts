// endix-entry-slack: the entry agent's only way to post in Slack, as the Entry agent,
// in #demo-lighthouse (SYS §5.7, C4). Spawned by Claude Code from .mcp.json over stdio.
// Nothing but MCP protocol goes to stdout; start errors go to stderr (T10 Spec Req 2).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnv, StartError } from "./env";
import { makeSlack } from "./slack";
import { createTools, descriptions, inputShapes } from "./tools";

// Any library line meant for the console goes to stderr, never into the protocol stream.
console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);

async function main(): Promise<void> {
  let loaded: ReturnType<typeof loadEnv>;
  try {
    loaded = loadEnv(process.env);
  } catch (err) {
    process.stderr.write(`${err instanceof StartError ? err.message : `endix-entry-slack: ${String(err)}`}\n`);
    process.exit(1);
  }
  const tools = createTools({ slack: makeSlack(loaded.token), config: loaded.config });
  const server = new McpServer({ name: "endix-entry-slack", version: "1.0.0" });
  server.registerTool(
    "read_thread",
    { description: descriptions.read_thread, inputSchema: inputShapes.read_thread },
    (args) => tools.read_thread(args),
  );
  server.registerTool(
    "post_in_thread",
    { description: descriptions.post_in_thread, inputSchema: inputShapes.post_in_thread },
    (args) => tools.post_in_thread(args),
  );
  server.registerTool(
    "post_ask",
    { description: descriptions.post_ask, inputSchema: inputShapes.post_ask },
    (args) => tools.post_ask(args),
  );
  server.registerTool(
    "hand_off",
    { description: descriptions.hand_off, inputSchema: inputShapes.hand_off },
    (args) => tools.hand_off(args),
  );
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`endix-entry-slack: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
