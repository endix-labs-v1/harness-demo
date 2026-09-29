// Notion rich text <-> a small markdown subset (T8 Spec Requirement 5): plain text,
// `code`, **bold**, *italic*, [text](url). Anything else is outside the subset.

export interface Annotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

export interface RichTextItem {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations: Annotations;
}

const PLAIN: Annotations = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };

function item(content: string, a: Partial<Annotations> = {}, url: string | null = null): RichTextItem {
  return { type: "text", text: { content, link: url ? { url } : null }, annotations: { ...PLAIN, ...a } };
}

type Kind = "plain" | "code" | "bold" | "italic" | "link";

/** The subset kind of one Notion rich text item, or null when it is outside the subset. */
function kindOf(rt: any): Kind | null {
  if (!rt || rt.type !== "text") return null;
  const a = { ...PLAIN, ...(rt.annotations ?? {}) } as Annotations;
  if (a.strikethrough || a.underline || (a.color ?? "default") !== "default") return null;
  const link = rt.text?.link?.url ?? null;
  const content: string = rt.text?.content ?? rt.plain_text ?? "";
  const on = [a.code, a.bold, a.italic, !!link].filter(Boolean).length;
  if (on > 1) return null;
  if (a.code) return content.includes("`") || content === "" ? null : "code";
  if (/[`*[\]]/.test(content)) return null;
  if (a.bold) return content === "" ? null : "bold";
  if (a.italic) return content === "" ? null : "italic";
  if (link) return content === "" || /[()\s]/.test(link) ? null : "link";
  return "plain";
}

/** True when every item of the rich text is inside the subset. */
export function inSubset(richText: any[]): boolean {
  return (richText ?? []).every((rt) => kindOf(rt) !== null);
}

/** Rich text as subset markdown; adjacent items of the same kind are joined. */
export function toMarkdown(richText: any[]): string {
  let out = "";
  const parts: { kind: Kind; content: string; url: string | null }[] = [];
  for (const rt of richText ?? []) {
    const kind = kindOf(rt) ?? "plain";
    const content: string = rt?.text?.content ?? rt?.plain_text ?? "";
    const url: string | null = rt?.text?.link?.url ?? null;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind && last.url === url) last.content += content;
    else parts.push({ kind, content, url });
  }
  for (const p of parts) {
    if (p.kind === "code") out += `\`${p.content}\``;
    else if (p.kind === "bold") out += `**${p.content}**`;
    else if (p.kind === "italic") out += `*${p.content}*`;
    else if (p.kind === "link") out += `[${p.content}](${p.url})`;
    else out += p.content;
  }
  return out;
}

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^()\s]+)\)/g;

/** Subset markdown as Notion rich text (the request shape of pages.create and blocks.update). */
export function fromMarkdown(text: string): RichTextItem[] {
  const out: RichTextItem[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > at) out.push(item(text.slice(at, i)));
    if (m[1] !== undefined) out.push(item(m[1], { code: true }));
    else if (m[2] !== undefined) out.push(item(m[2], { bold: true }));
    else if (m[3] !== undefined) out.push(item(m[3], { italic: true }));
    else out.push(item(m[4], {}, m[5]));
    at = i + m[0].length;
  }
  if (at < text.length) out.push(item(text.slice(at)));
  return out;
}

/** A comparable form of rich text: content, the subset annotations that are on, and the link. */
export function normalize(richText: any[]): { content: string; code?: true; bold?: true; italic?: true; link?: string }[] {
  const out: { content: string; code?: true; bold?: true; italic?: true; link?: string }[] = [];
  for (const rt of richText ?? []) {
    const a = rt?.annotations ?? {};
    const n: { content: string; code?: true; bold?: true; italic?: true; link?: string } = { content: rt?.text?.content ?? rt?.plain_text ?? "" };
    if (a.code) n.code = true;
    if (a.bold) n.bold = true;
    if (a.italic) n.italic = true;
    if (rt?.text?.link?.url) n.link = rt.text.link.url;
    out.push(n);
  }
  return out;
}
