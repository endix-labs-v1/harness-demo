import { fenceProject } from "../../fence/project";
import type { Refusal, ToolContext } from "../define";
import { getIssueFull, type FullIssue } from "./issues";

// The Linear writes of the task manager. Operation and field names are Linear's
// (unverified, C-18). Every write here runs after its tool's walls.

export const ISSUE_CREATE = `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`;
export const ISSUE_UPDATE = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier url state { name } } } }`;
export const COMMENT_CREATE = `mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }`;
export const RELATION_CREATE = `mutation IssueRelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { id } } }`;
export const ATTACHMENT_LINK = `mutation AttachmentLinkURL($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success attachment { id url } } }`;

export async function createIssue(ctx: ToolContext, input: Record<string, unknown>): Promise<{ id: string; key: string; title: string; url: string }> {
  const data = await ctx.linear(ISSUE_CREATE, { input });
  const i = data?.issueCreate?.issue;
  if (!data?.issueCreate?.success || !i) throw new Error("Linear issueCreate failed");
  return { id: i.id, key: i.identifier, title: i.title, url: i.url };
}

export async function updateIssue(ctx: ToolContext, id: string, input: Record<string, unknown>): Promise<void> {
  const data = await ctx.linear(ISSUE_UPDATE, { id, input });
  if (!data?.issueUpdate?.success) throw new Error("Linear issueUpdate failed");
}

export async function createComment(ctx: ToolContext, issueId: string, body: string): Promise<{ id: string | null; url: string | null }> {
  const data = await ctx.linear(COMMENT_CREATE, { input: { issueId, body } });
  if (!data?.commentCreate?.success) throw new Error("Linear commentCreate failed");
  return { id: data.commentCreate.comment?.id ?? null, url: data.commentCreate.comment?.url ?? null };
}

export async function createRelation(ctx: ToolContext, issueId: string, relatedIssueId: string, type: "blocks" | "related"): Promise<void> {
  const data = await ctx.linear(RELATION_CREATE, { input: { issueId, relatedIssueId, type } });
  if (!data?.issueRelationCreate?.success) throw new Error("Linear issueRelationCreate failed");
}

export async function linkUrl(ctx: ToolContext, issueId: string, url: string, title: string): Promise<void> {
  const data = await ctx.linear(ATTACHMENT_LINK, { issueId, url, title });
  if (!data?.attachmentLinkURL?.success) throw new Error("Linear attachmentLinkURL failed");
}

/** W-11 on `key`, then the full read. The refusal when the fence refuses; an error when the issue isn't there. */
export async function fencedIssue(ctx: ToolContext, key: string): Promise<{ refusal: Refusal } | { issue: FullIssue }> {
  const refusal = await fenceProject(ctx, key);
  if (refusal) return { refusal };
  const issue = await getIssueFull(ctx, key);
  if (!issue) throw new Error(`${key} not found`);
  return { issue };
}

/** Thrown for an input the tool can't act on; callTool returns it as `{ error }`. */
export function inputError(message: string): Error {
  return new Error(`input: ${message}`);
}
