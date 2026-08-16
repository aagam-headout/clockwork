import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent output is markdown. Rendered as text, headings arrived as literal
 * `##`, links as raw URLs, tables as pipe soup — every digest read worse
 * here than in the Slack message it was also sent to.
 *
 * Typography lives in `globals.css` under `.markdown`, not per-element
 * `components` overrides here: one place to tune, applying to nested content
 * (list items with code, table cells) without enumerating every tag.
 *
 * Hook-free, so this stays a server component. GFM is on for tables,
 * strikethrough and autolinks — what the agents actually emit. Raw HTML is
 * deliberately off: the body is model output, and `rehype-raw` would make it
 * injectable markup.
 */
export function Markdown({
  children,
  size = "base",
  className = "",
}: {
  children: string;
  /**
   * `sm` for markdown inside something already dense — a chat bubble, a
   * preview pane. A variant class, not overrides here, so the two sizes
   * can't drift on what a heading or code chip looks like.
   */
  size?: "base" | "sm";
  className?: string;
}) {
  return (
    <div
      className={`markdown ${size === "sm" ? "markdown-sm" : ""} ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A wide table would stretch the card into horizontal page scroll;
          // this scrolls inside its own box instead.
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
          // A digest can carry a chart or screenshot the agent linked to.
          // Lazy and async-decoded, so a long one doesn't block the panel
          // for images below the fold.
          img: ({ src, alt }) => (
            // src is model output — an arbitrary remote URL next/image can't
            // whitelist or optimize — so a plain <img> is intentional.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              loading="lazy"
              decoding="async"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
