import { refused, type Refusal, type ToolContext } from "../tools/define";

export function w11(key: string): string {
  return `Refused by the harness (W-11, SEC §5): ${key} is outside the project Harness demo.`;
}

/**
 * The project fence (W-11, SEC §5). A read, so it runs in dry run too. Every Linear
 * write tool calls it on each issue it writes (T6, T7, T9).
 */
export async function fenceProject(ctx: Pick<ToolContext, "linear" | "config">, issueKey: string): Promise<Refusal | null> {
  const data = await ctx.linear(`query FenceProject($key: String!) { issue(id: $key) { project { id } } }`, { key: issueKey });
  const projectId: string | undefined = data?.issue?.project?.id;
  if (projectId && ctx.config.linear.project_id && projectId === ctx.config.linear.project_id) return null;
  return refused("W-11", w11(issueKey));
}
