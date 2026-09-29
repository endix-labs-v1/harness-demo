// No import of src/: vi.mock factories import this file while src/agent/sdk.ts is being mocked.

// ---- fakeSdk: mocks src/agent/sdk.ts ----

export interface ScriptCall {
  name: string;
  input: Record<string, unknown>;
}

const fake = {
  script: [] as ScriptCall[],
  lastOptions: null as any,
  queryCalls: 0,
};

/**
 * Use as `vi.mock("../src/agent/sdk", async () => (await import("./helpers")).fakeSdk.module())`.
 * Its `query` plays the script: PreToolUse hooks, then canUseTool when no hook denied and
 * the name isn't in allowedTools, then the tool's handler, then PostToolUse hooks.
 */
export const fakeSdk = {
  state: fake,
  play(script: ScriptCall[]) {
    fake.script = script;
    fake.lastOptions = null;
    fake.queryCalls = 0;
  },
  module() {
    return {
      tool: (name: string, description: string, inputSchema: unknown, handler: (args: unknown, extra: unknown) => Promise<unknown>) => ({ name, description, inputSchema, handler }),
      createSdkMcpServer: (o: { name: string; version?: string; tools?: any[] }) => ({ type: "sdk", name: o.name, instance: null, tools: o.tools ?? [] }),
      query: ({ options }: { prompt: string; options: any }) => {
        fake.queryCalls += 1;
        fake.lastOptions = options;
        return (async function* () {
          const signal = new AbortController().signal;
          yield { type: "system", subtype: "init", tools: [...(options.allowedTools ?? [])] };
          let turns = 0;
          for (const call of fake.script) {
            turns += 1;
            let denied = false;
            for (const m of options.hooks?.PreToolUse ?? []) {
              for (const h of m.hooks) {
                const r = await h({ hook_event_name: "PreToolUse", tool_name: call.name, tool_input: call.input }, `tu_${turns}`, { signal });
                if (r?.hookSpecificOutput?.permissionDecision === "deny") denied = true;
              }
            }
            if (!denied && !(options.allowedTools ?? []).includes(call.name)) {
              const r = await options.canUseTool(call.name, call.input, { signal });
              if (r.behavior === "deny") denied = true;
            }
            if (denied) continue;
            const bare = call.name.replace(/^mcp__endix__/, "");
            const t = options.mcpServers?.endix?.tools?.find((x: any) => x.name === bare);
            const response = t ? await t.handler(call.input, {}) : { content: [{ type: "text", text: "{}" }], isError: true };
            for (const m of options.hooks?.PostToolUse ?? []) {
              for (const h of m.hooks) await h({ hook_event_name: "PostToolUse", tool_name: call.name, tool_input: call.input, tool_response: response }, `tu_${turns}`, { signal });
            }
            yield { type: "user", message: { role: "user", content: [{ type: "tool_result", content: response }] } };
          }
          yield { type: "result", subtype: "success", num_turns: turns + 1, is_error: false };
        })();
      },
    };
  },
};
