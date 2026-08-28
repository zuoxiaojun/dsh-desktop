# Agent Note: Desktop Preset Square installation

Status: implemented

English | [中文](2026-08-17-desktop-preset-square-installation.zh.md)

## Problem

Agent Presets already let a user choose the composition of a new session, but the shipped Desktop exposed only the local roster and its authoring controls. Discovering a community Preset required leaving the app, understanding the on-disk layout, and copying executable configuration by hand. Treating a Preset as an ordinary plugin would also be misleading: a Preset selects Agent, plugin, tool, and prompt composition, while plugin installation mutates the live Host package graph.

## Decision

Preset Square is a first-level page beside Plugin Center and Plugin Discovery, backed by one client component with separate Square and Installed views. The Square view reads the complete public list, applies search immediately in memory, preserves the service-owned Downloads/Newest ordering, and opens a native detail view. The Installed view keeps the local Preset roster independently usable when the public service fails. The browser development bridge provides deterministic read-only entries; installation, deletion, and session selection remain Desktop-only.

The Square merges two explicit catalog provenances. **Fufan Official** (`赋范官方`) means application-bundled content maintained by the Fufan Desktop team; it does not claim DeepSeek Harness ownership. Seven compact packs ship in read-only Desktop resources: AI WebApp, PPT Office, video generation, content factory, AI report, Feishu digital employee, and LLM Wiki Producer. LLM Wiki Producer installs the `LLM Wiki 全栈工程师` Agent Preset and its bundled plugin-discovery Skill while retaining project and global Skill discovery. Its detail view identifies that Agent prompt, bundled Skill, standard tools, and runtime Skill discovery before installation. Community entries continue to come from the fixed service. Both paths use the same preview and Host importer, and Fufan packs deliberately land in the user root so they remain removable and reinstallable.

Desktop main owns every network request to the fixed `https://www.dshdesktop.com/preset/` service. Catalog metadata may use either that host or its canonical `https://dshdesktop.com` apex for detail and artifact URLs; no other origin is accepted. Strict contracts reject unknown response shapes, non-HTTPS or foreign artifact URLs, oversized metadata, invalid identifiers, and malformed hashes. Before Host import, Desktop re-resolves detail, downloads the bounded `.dshpreset` artifact without redirects, verifies the declared byte length and SHA-256, and sends the bytes through a dedicated loopback binary endpoint. Renderer input can choose only a published slug and a validated local target id; it cannot supply an origin, download URL, filesystem path, or archive bytes.

The Host previews and installs the archive with compressed, expanded, per-file, and file-count limits. It rejects absolute, parent-traversal, drive-letter, backslash, NUL, and out-of-layout paths; requires the versioned `dsh-preset` manifest and `preset/agent.cordis.yml`; and scans text for absolute-path, possible-secret, and DSH-version warnings. Drive-letter detection requires a path boundary, so URL schemes such as `https://` are not reported as local paths, and the comparison version comes from the running DSH package rather than a release-specific literal. Installation writes into a temporary directory under the writable user Preset root, validates the result with the existing Preset scanner, and atomically renames it into place. Existing ids, including system-owned ids, are never overwritten.

The same surface reads the live Host roster after installation or deletion. System Presets remain visible and protected; only user Presets expose deletion. Both a catalog card and its detail dialog consult that roster: when the published id is already installed, they offer “Use for new session” or environment setup instead of reopening an import that must conflict. Installation stays disabled until the local roster has loaded successfully, so a fast click cannot race local discovery. “Use for new session” asks the Workspace runtime for a reusable or newly created blank session, switches that session through `agentPreset.select`, updates the session projection, opens it, and then closes the first-level catalog page. The new-session Preset chip reconciles from the current blank session after an external surface confirms that switch, so its label shows the composition that will actually run rather than the previously staged choice. Existing conversations are never recomposed.

## Alternatives considered

**Open the public Preset website in a browser.** This avoids native UI work but does not provide one-click verified installation, local state, deletion, or a direct new-session path.

**Let the renderer download and unpack archives.** That would give untrusted catalog data network and filesystem authority in the least trusted process and would duplicate the Host's Preset validation rules.

**Accept arbitrary URLs or local archive paths.** This expands the first release into a general package importer and breaks the fixed-origin, reviewed-entry boundary. The shipped surface installs only artifacts re-resolved from Preset Square.

**Overwrite an existing Preset id.** Silent replacement could change future Agent composition and could shadow a system Preset. Conflicts instead block installation until the user chooses a new valid id.

**Apply a Preset to the current conversation.** A started conversation's history and tool calls belong to its original composition. The action therefore targets only a blank session and reuses the existing per-session Preset invariant.

## Verification

Contract tests cover valid public entries and rejection of foreign URLs, malformed identifiers, hashes, and response shapes. Desktop client tests cover list/detail reads, verified preview/install, digest mismatch, redirect rejection, and Host unavailability. Host tests cover archive traversal, decompression limits, required layout, warnings, conflicts, atomic installation, and the dedicated binary carrier. Client tests cover local search, explicit sort, preview acknowledgement, install refresh, user-only deletion, staying on the Preset page, and routing an already installed detail directly to new-session use without previewing a duplicate import.

## Consequences

Users can discover, inspect, install, manage, and use Fufan-maintained or community Presets without editing files, while the current Host roster remains the authority for what is actually installed. Community installation makes a second download between preview and confirmation so installation revalidates current published metadata rather than trusting stale renderer state; bundled installation rematerializes the same deterministic archive. This release deliberately omits publishing, accounts, ratings, automatic updates, and arbitrary-source import; adding any of those requires a separate authority and trust decision.
