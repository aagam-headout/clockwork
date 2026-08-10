import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent output is markdown. Rendering it as text meant headings arrived as
 * literal `##`, links as raw URLs, and tables as pipe soup — so every digest
 * read worse in the dashboard than in the Slack message it was also sent to.
 *
 * The typography lives in `globals.css` under `.markdown` rather than in
 * per-element `components` overrides here: one place to tune, and it applies
 * to nested content (list items containing code, table cells) without
 * enumerating every tag.
 *
 * The default `Markdown` export is hook-free, so this stays a server component.
 * GFM is on for tables, strikethrough and autolinks, which is what the agents
 * actually emit. Raw HTML is deliberately *not* enabled: the body is model
 * output, and `rehype-raw` would make it injectable markup.
 */
export function Markdown({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A wide table would otherwise stretch the card and push the page
          // into a horizontal scroll; it scrolls inside its own box instead.
          table: ({ children: cells }) => (
            <div className="-mx-1 overflow-x-auto px-1">
              <table>{cells}</table>
            </div>
          ),
          a: ({ children: label, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
