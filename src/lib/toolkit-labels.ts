// Display metadata for toolkits. Kept client-safe (no SDK imports) and in one
// place so the connections page, workflow form, and workflow cards all show
// the same label and glyph for a toolkit slug.
// lucide dropped brand glyphs in v1, so Slack/GitHub fall back to the closest
// generic marks (channel hash, git branch).
import {
  Mail,
  Calendar,
  Hash,
  NotebookText,
  GitBranch,
  Globe,
  type LucideIcon,
} from "lucide-react";

export const TOOLKIT_LABELS: Record<string, string> = {
  googlecalendar: "Google Calendar",
  gmail: "Gmail",
  slack: "Slack",
  notion: "Notion",
  github: "GitHub",
  composio_search: "Web search",
};

export const TOOLKIT_ICONS: Record<string, LucideIcon> = {
  googlecalendar: Calendar,
  gmail: Mail,
  slack: Hash,
  notion: NotebookText,
  github: GitBranch,
  composio_search: Globe,
};

export const TOOLKIT_BLURBS: Record<string, string> = {
  googlecalendar: "Events, availability, conflicts",
  gmail: "Threads, unread, search",
  slack: "Channels, DMs, delivery",
  notion: "Pages and databases",
  github: "Issues, PRs, notifications",
  composio_search: "Public web, no auth needed",
};
