import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareDigest } from "@/lib/outcome/digest-view";

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
  digest = false,
  className = "",
}: {
  children: string;
  /**
   * `sm` for markdown inside something already dense — a chat bubble, a
   * preview pane. A variant class, not overrides here, so the two sizes
   * can't drift on what a heading or code chip looks like.
   */
  size?: "base" | "sm";
  /**
   * The body is a stored run digest, so a typed `<report>` block in it is a
   * mis-typed tool call worth reading back. Off everywhere else: a workflow
   * goal teaching that format, or a chat turn quoting it, means the shape
   * literally, and salvaging it would replace what the author wrote.
   */
  digest?: boolean;
  className?: string;
}) {
  /*
   * The body is model output, so it isn't always the markdown it claims to
   * be: a report typed as `<report>{...}</report>` used to lose its tags and
   * spill JSON into the page. `prepareDigest` reads the digest back out of
   * that shape and escapes any other tag-like text so nothing renders as
   * nothing.
   */
  const { markdown, salvaged } = prepareDigest(children, { salvage: digest });

  return (
    <div
      className={`markdown ${size === "sm" ? "markdown-sm" : ""} ${className}`}
    >
      {salvaged && (
        <p className="text-muted mb-2 text-[12px]">
          Recovered from a report the agent wrote as text instead of calling.
        </p>
      )}
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
          // A digest links out to a PR, a dashboard, a thread — all of which
          // should open beside the run, not replace it. An in-page anchor is
          // the exception: a new tab there lands on a fresh, unscrolled page.
          a: ({ children: label, href, title }) => {
            const inPage = href?.startsWith("#");
            return (
              <a
                href={href}
                title={title}
                target={inPage ? undefined : "_blank"}
                rel={inPage ? undefined : "noopener noreferrer"}
              >
                {label}
              </a>
            );
          },
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
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
