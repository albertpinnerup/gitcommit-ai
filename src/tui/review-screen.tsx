/** @jsxImportSource @opentui/react */
// The main picker screen: banner, settings block, committed line, commit list
// in a scrollbox (native scrolling replaces the old height-windowing math),
// footer legend.

import { useRef, useLayoutEffect } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { Banner, shouldShowBanner } from "./banner.tsx";
import { CommitBlock } from "./commit-block.tsx";
import { formatCommitMessage } from "../core/message.ts";
import { theme } from "./theme.ts";
import type { PlannedCommit, Committed, Settings } from "../types.ts";

// Compute the number of rows a CommitBlock occupies: label + subject + files + body lines.
function blockRowHeight(commit: PlannedCommit): number {
  const lines = formatCommitMessage(commit).split("\n");
  const bodyLines = lines.slice(1).filter((l) => l.trim() !== "");
  return 3 + bodyLines.length;
}

// BANNER_ROWS: 6 art rows + 1 row for marginBottom (matches banner.tsx constant).
const BANNER_ROWS = 7;
// Fixed rows in the chrome outside the scrollbox: Settings (4) + legend (2).
const SETTINGS_ROWS = 4;
const LEGEND_ROWS = 2;

export const LEGEND_NAV = "↑/↓ move · enter accept · a accept all · s skip · q quit";
export const LEGEND_EDIT =
  "n new · p ask claude · e msg · E body · r regen all · R regen one · c settings";

export function ReviewScreen({
  commits, cursor, committed, settings, height, width,
}: {
  commits: PlannedCommit[];
  cursor: number;
  committed: Committed[];
  settings: Settings;
  height: number;
  width: number;
}) {
  const modelStyle = theme.model[settings.model] ?? { fg: theme.accent, bg: "" };
  const bannerVisible = shouldShowBanner(width, height, 12);
  const bannerRows = bannerVisible ? BANNER_ROWS : 0;
  const committedRows = committed.length > 0 ? 1 : 0;
  // Give the scrollbox an explicit height so Yoga doesn't squeeze the footer.
  // ascii-font doesn't reliably report its height to Yoga, so we derive it.
  const scrollboxRows = Math.max(1, height - bannerRows - SETTINGS_ROWS - committedRows - LEGEND_ROWS);

  // Scroll-follow: imperatively set scrollTop so the focused commit stays visible.
  // useLayoutEffect fires synchronously after the React commit, before OpenTUI renders
  // the frame buffer — so the scroll position is correct in the very next renderOnce().
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const offset = commits.slice(0, cursor).reduce(
      (acc, c) => acc + blockRowHeight(c),
      0,
    );
    scrollRef.current.scrollTop = offset;
  }, [cursor]);

  return (
    <box flexDirection="column" height={height}>
      {bannerVisible && (
        <box height={BANNER_ROWS} overflow="hidden">
          <Banner width={width} height={height} />
        </box>
      )}
      <box flexDirection="column" height={SETTINGS_ROWS}>
        <text fg={theme.dim}>Settings</text>
        <text fg={theme.dim}>
          {"Model: "}
          <span fg={modelStyle.fg} bg={modelStyle.bg}>{settings.model}</span>
        </text>
        <text fg={theme.dim}>
          {"Effort: "}
          <span fg={theme.effortColor[settings.effort] ?? theme.accent}>{settings.effort}</span>
        </text>
        <text fg={theme.dim}>
          {"Verbose: "}
          <span fg={settings.verbose ? theme.onColor : theme.offColor}>
            {settings.verbose ? "verbose" : "subject-only"}
          </span>
        </text>
      </box>
      {committed.length > 0 && (
        <text fg={theme.dim}>
          {"✓ committed " + committed.length + ": " + committed.map((c) => c.subject).join(", ")}
        </text>
      )}
      <scrollbox ref={scrollRef} height={scrollboxRows}>
        {commits.map((commit, index) => (
          <CommitBlock key={index} commit={commit} index={index} focused={index === cursor} />
        ))}
      </scrollbox>
      <box flexDirection="column" height={LEGEND_ROWS}>
        <text fg={theme.dim}>{LEGEND_NAV}</text>
        <text fg={theme.dim}>{LEGEND_EDIT}</text>
      </box>
    </box>
  );
}
