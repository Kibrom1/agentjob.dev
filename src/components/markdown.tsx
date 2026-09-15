import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders employer-supplied Markdown safely:
 *  - raw HTML is dropped entirely (`skipHtml`, no rehype-raw),
 *  - URLs pass react-markdown's protocol allow-list; links it strips
 *    (e.g. `javascript:`) degrade to plain text instead of `href=""`,
 *  - images are dropped (tracking pixels, mixed content, layout shifts),
 *  - headings are shifted down one level so the page keeps a single <h1>,
 *  - outbound links open in a new tab without passing referrer or rank.
 */
const components: Components = {
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />,
  a: ({ node: _node, href, children, ...props }) =>
    href ? (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-zinc max-w-none prose-headings:tracking-tight prose-a:text-accent-700 prose-a:underline-offset-2 prose-code:before:content-none prose-code:after:content-none dark:prose-invert dark:prose-a:text-accent-400">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={["img"]} unwrapDisallowed skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
