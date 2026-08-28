# Agent Note: Complete conversation outline navigation

Status: implemented

English | [中文](2026-08-24-conversation-outline-navigation.zh.md)

## Problem

ChatView initially renders only the latest 50 messages and extends that window through explicit backward pagination. Long sessions therefore require repeated page loads and manual scanning before a reader can revisit an earlier prompt, answer, or Tool call. A directory derived only from mounted DOM rows would preserve that limitation, while eagerly mounting the complete transcript would make directory discovery compete with Markdown, Tool cards, images, and layout work for every historical row.

The navigation surface must also preserve addressed-subagent transport. A child transcript is read through a catalog-derived `SubagentAddress`; using ordinary session history for that view would bypass the routing facts already retained by the sessions domain.

## Decision

The built-in ChatView owns one session-local right-edge outline. It indexes append-origin user messages whose durable source is human, visible assistant messages, and root `tool/call` events. Each entry carries the rendered row's sequence, a user/assistant/tool role, and a normalized one-line summary bounded to 80 characters. Tool summaries contain the Tool name rather than arguments, so directory navigation does not create a second place that exposes call parameters.

The outline reads the complete history independently from the rendered transcript. It pages `session.history` in 50-message requests for ordinary sessions and `subagent.history` with the retained mode-bearing address for addressed children. This read builds only sequence, role, and summary values and does not mutate the Session event window. Current assembled Chat nodes are merged over the durable index so a new or streaming tail appears without rescanning the complete log.

Every Chat row publishes `data-chat-anchor-seq` beside its stable key. Selecting an already mounted outline entry uses that sequence and smooth-scrolls to its row. Selecting an unloaded entry serially calls the existing `loadOlder()` operation, waits for each React commit, and repeats until the target appears or history stops advancing. A successful selection collapses the panel before scrolling and marks the complete transcript row with a theme-aware 2.2-second highlight; the directory remains navigation rather than a second full-text reader, while the destination is unmistakable in the owning transcript. A newer selection invalidates the previous jump, and unmount invalidates all pending jump and highlight work.

The expanded panel renders a fixed-height 48px row window with overscan rather than one DOM row per history entry. Its collapsed rail samples at most 80 role-colored marks. The active mark follows the first visible stable transcript row on scroll and after open, prepend, or tail insertion. Hovering the collapsed rail opens the panel, while collapse and hide are explicit controls: pointer departure never collapses because expansion changes the reserved gutter and an enter/leave pair tied to that reflow would oscillate. Expanding the panel reserves a right-side transcript gutter; hiding it leaves one explicit restore control. The surface uses shared theme tokens and is omitted below 760px, where the desktop-width navigation posture does not fit without reducing the message column excessively.

## Alternatives considered

**Index only mounted Chat rows.** Rejected because the directory would omit exactly the older content that makes navigation necessary and would still require repeated manual “Load earlier” actions.

**Load every history page into the Session window when the outline opens.** Rejected because complete transcript rendering performs the expensive Markdown and Tool-card work the lightweight index avoids and changes reader position before the user requests a jump.

**Replace the transcript with a general-purpose virtualized chat list.** Deferred because it changes measurement, prepend anchoring, sticky composer behavior, streaming resize follow, and semantic scroll restoration. The outline provides bounded directory rendering without changing those existing contracts.

**Ship an optional third-party directory plugin.** Rejected for the default product because complete history routing, row anchor identity, active-scroll ownership, and non-obscuring layout are already owned by the built-in conversation package. Existing community implementations informed the lightweight-index and chain-loading patterns but are not runtime dependencies.

## Consequences

Opening an established session starts an additional sequential read over its complete history. The response data remains lightweight, but the number of history requests grows with session length. The existing Host pagination, authorization, and subagent-address checks remain the only data authority; no new RPC or persisted index is introduced.

Jumping to an unloaded target intentionally extends the ordinary transcript window, so the newly loaded rows remain available afterward exactly as if the reader had pressed “Load earlier.” The outline itself remains bounded in DOM size regardless of entry count.

Hidden, expanded, active, and in-flight jump state is session-view memory only. It is not persisted across a page reload. Cross-session search, bookmarks, and full transcript virtualization remain separate capabilities.

## Testing

`conversation-outline.client.spec.ts` pins summary bounds, role filtering, complete ordinary-session pagination, addressed-subagent routing, ordering, and live-summary replacement. `conversation-outline-view.client.spec.tsx` pins bounded DOM rendering for 500 entries, current-row semantics, hide/restore behavior, and the non-collapsing pointer departure plus explicit collapse control. `chat-view.client.spec.tsx` pins the complete unloaded-target path from directory selection through `loadOlder()` to a smooth scroll, automatic panel collapse, and target-row highlight on the rendered sequence. `apply-inject.client.spec.tsx` pins the ordinary-history injection. The keyless built-product `conversation-outline.snapshot.ts` opens the assembled 75-turn fixture, confirms that the complete index exceeds the initial transcript window, and selects turn zero through chained pagination to a mounted row and final scroll.
