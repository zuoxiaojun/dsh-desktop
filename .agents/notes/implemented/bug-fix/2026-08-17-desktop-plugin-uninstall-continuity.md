# Agent Note: Desktop plugin uninstall continuity

Status: implemented

English | [中文](2026-08-17-desktop-plugin-uninstall-continuity.zh.md)

## Problem

Some ecosystem Bundles register runtime Skills without listing them in `dsh.pluginCenter.expectedSkillIds`. Disabling or uninstalling one of those Bundles correctly removes its Loader entry and runtime Skills, but the continuity verifier cannot attribute the undeclared Skill to the target. It classifies the missing Skill as unrelated, rolls the transaction back, and restores the package, so the plugin reappears after refresh. A successful Host replacement also navigates the BrowserWindow to a new loopback origin and briefly exposes the blank intermediate renderer. Although the primary Plugin Center page is restored, the expanded installed manager previously lived only in component memory and collapsed when that renderer remounted.

## Decision

Disable and uninstall retain strict checks for the target's declared identities, the owning `agent-presets` entry, every unrelated restart-stable Loader entry, and every unrelated client module. For these two deactivation actions only, Skill continuity is compatibility evidence rather than a rollback boundary: Skills omitted from every affected candidate's `expectedSkillIds` may disappear after the target Loader identity disappears. Activation and update keep their existing strict evidence rules.

Host reconnect keeps the last rendered BrowserWindow frame in a sandboxed, memory-only `WebContentsView` while the real renderer navigates. The held frame is mounted only after its data document loads and is released after the replacement renderer paints, or after a short bound. Capture, paint-wait, and release failures are diagnostic-only; the authoritative navigation failure still rejects the mutation path. The installed manager writes its open state to one fixed renderer URL parameter. Replacement URL composition carries that exact value only when returning to the Plugin Center and discards every arbitrary query parameter, so the new renderer remounts the same subview without turning renderer state into navigation authority.

## Verification

The runtime-verifier unit test covers undeclared target Skill removal while unrelated Loader, client, and Skill evidence remains. The installed-management integration fixture registers an undeclared runtime Skill and proves uninstall commits instead of restoring the Profile. The held-frame transition unit tests pin ordering, best-effort capture and paint handling, release, and propagation of navigation failure. Client coverage proves the installed manager restores from and updates its URL marker; Desktop URL coverage proves the marker survives an intended Plugin Center replacement while unrelated parameters and other primary pages do not inherit it.

## Alternatives considered

**Require every existing ecosystem package to publish `expectedSkillIds` before it can be removed.** Rejected because already installed packages cannot repair their own manifest while the uninstall transaction is blocked.

**Drop post-restart runtime verification for uninstall.** Rejected because Profile projection, target Loader removal, and unrelated Loader and client continuity remain useful safeguards against a damaged mutation.

**Show a loading or recovery page during every successful Host replacement.** Rejected because it exposes an internal restart as a whole-window state change even though the user remains in the same Plugin Center workflow.

## Consequences

Plugins with incomplete Skill metadata can now be disabled and uninstalled without a false rollback, while declared identities and stronger Loader and client continuity still protect the transaction. An undeclared unrelated Skill that disappears during the same deactivation is no longer independently attributable and therefore cannot alone force rollback; packages that declare their Skills retain exact verification. Desktop briefly owns one in-memory screenshot and one sandboxed child WebContents during Host navigation, then disposes both after the replacement paints. The installed-manager selection is visible in the local loopback URL and survives controlled Host replacement, but it creates no new history entry and carries no mutation authority.
