import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Converts employer Markdown to the small HTML subset Google for Jobs accepts
 * in `JobPosting.description` (p, br, ul, ol, li, h1-h6, strong, em). Built
 * from the mdast tree with an allow-list, so the output is sanitized by
 * construction: raw HTML nodes, images and link targets are dropped, and all
 * text is entity-escaped. Headings shift down one level like the on-page renderer.
 */

type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  children?: MdNode[];
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function inline(nodes: MdNode[] | undefined): string {
  return (nodes ?? []).map(renderInline).join("");
}

function renderInline(node: MdNode): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value ?? "");
    case "inlineCode":
      return escapeHtml(node.value ?? "");
    case "strong":
      return `<strong>${inline(node.children)}</strong>`;
    case "emphasis":
      return `<em>${inline(node.children)}</em>`;
    case "delete":
    case "link":
    case "linkReference":
      return inline(node.children);
    case "break":
      return "<br>";
    default:
      // html, image, imageReference, footnotes: dropped.
      return "";
  }
}

function blocks(nodes: MdNode[] | undefined): string {
  return (nodes ?? []).map(renderBlock).join("");
}

function listItem(node: MdNode): string {
  // Tight items hold paragraphs; flatten them so <li> holds inline content.
  const body = (node.children ?? [])
    .map((child) => (child.type === "paragraph" ? inline(child.children) : renderBlock(child)))
    .join("");
  return `<li>${body}</li>`;
}

function renderBlock(node: MdNode): string {
  switch (node.type) {
    case "paragraph": {
      const text = inline(node.children);
      return text.trim() ? `<p>${text}</p>` : "";
    }
    case "heading": {
      const level = Math.min(6, (node.depth ?? 1) + 1);
      return `<h${level}>${inline(node.children)}</h${level}>`;
    }
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      return `<${tag}>${(node.children ?? []).map(listItem).join("")}</${tag}>`;
    }
    case "blockquote":
      return blocks(node.children);
    case "code":
      return `<p>${escapeHtml(node.value ?? "")}</p>`;
    case "table":
      return (node.children ?? [])
        .map((row) => `<p>${(row.children ?? []).map((cell) => inline(cell.children)).join(" | ")}</p>`)
        .join("");
    case "thematicBreak":
    case "html":
    default:
      return "";
  }
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function markdownToHtml(markdown: string): string {
  const tree = parser.parse(markdown) as unknown as MdNode;
  return blocks(tree.children);
}

/** Plain-text version for meta descriptions: no markup, collapsed whitespace. */
export function markdownToPlainText(markdown: string): string {
  const html = markdownToHtml(markdown)
    .replace(/<\/(p|li|h[1-6])>/g, " ")
    .replace(/<[^>]+>/g, " ");
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
