# Agent Note: Plugin recovery runtime-mismatch safe mode

Status: implemented

English | [中文](2026-08-24-plugin-recovery-safe-mode.zh.md)

## Problem

Plugin installation can fail after the Desktop has captured a complete prior snapshot. Recovery may then restore the Profile files and packages, restart a Host that passes loopback health, yet fail the final exact comparison of Loader entries, client modules, or Skills. The durable journal records `runtime-verification-failed`, and the startup gate historically treated it like an unreadable snapshot or failed package restore: every later launch opened only the standalone recovery page.

Issue #22 supplied a Windows diagnostic with one `package-mutation-failed` installation followed by 14 recovery attempts. Every attempt reached profile restoration, package restoration, Host restart, and runtime verification before failing with the same reason. Reinstalling the application did not remove the user-data journal, so replacing binaries could not release the startup gate. Retry alone offered no converging action, even though the Host was healthy enough to serve the Plugin Center.

## Decision

Recovery separates Host health from exact runtime evidence. Failure to answer the loopback health request is `host-start-failed` and remains a hard recovery failure. `runtime-verification-failed` means health passed and only the canonical Loader/client/Skill inventory differs.

On startup, only a durable `runtime-verification-failed` snapshot may enter Plugin safe mode. Desktop starts the restored Profile without running ordinary application-update migrations, loads the normal renderer directly on Plugin Center, retains the recovery card, and automatically expands the installed manager. The standalone recovery page remains the only interface for unreadable journals and snapshot, Profile, package, lock, or Host failures.

Safe mode is enforced twice. The renderer disables catalog installation and installed update/enable actions, while keeping configuration, recovery retry, diagnostic export, disable, and uninstall available. The main-process IPC independently decodes every request and accepts only `disable` or `uninstall`; a forged install, update, or enable request is rejected. Both permitted actions reduce or remove third-party runtime authority and run through the same snapshot, Host replacement, verification, and recovery transaction as ordinary management.

A successful recovery retry or committed safe-mode management operation clears the startup restriction. A retry that changes into a hard recovery reason navigates back to the protected recovery page. Reinstalling the application remains intentionally non-destructive to user data, but no longer strands a healthy Host behind an infinite retry-only screen.

## Alternatives considered

**Treat every recovery failure as safe.** Rejected because a damaged snapshot, incomplete dependency restore, live Profile lock, or unhealthy Host cannot support a trustworthy Plugin Center.

**Start the entire ordinary product after a runtime mismatch.** Rejected because conversations and unrelated workflows could exercise the differing runtime before the user removes its cause. Safe mode opens only Plugin Center and narrows mutation authority.

**Ignore the evidence mismatch and rewrite the old journal as `rolled-back`.** Rejected because `rolled-back` promises verified prior evidence. Safe mode preserves the failure record and requires either exact retry convergence or a new verified disable/uninstall transaction.

**Delete the plugin journal during application reinstall.** Rejected because uninstalling binaries must not silently discard recovery evidence or user Profile state, and it would not prove that the plugin environment is safe.

## Consequences

Users can inspect installed plugins and remove or deactivate a likely offender instead of repeatedly restoring the same non-converging inventory. Safe cleanup replaces the terminal failed journal with a new recovery-backed transaction; after its target and unrelated continuity evidence pass, normal plugin operations resume.

The safe-mode classifier depends on `runtime-verification-failed` meaning Host health already passed. The recovery controller therefore owns separate health and evidence failure mappings, and future changes must not merge those observations back into one reason.

New diagnostic exports add the Desktop version and supported platform while retaining the stable phase and reason instead of raw local paths or error objects. More granular redacted expected/observed inventory differences remain a separate support improvement; they are not required for safe entry or cleanup.

## Testing

Desktop crash-recovery tests use a real journal to pin safe Host startup only for runtime mismatch, hard blocking for Profile and unreadable-journal failures, and the disable/uninstall-only action classifier. Recovery-controller tests pin the health/evidence distinction and same-operation retry convergence. Plugin Center component tests pin the safe-mode title and explanation, automatic installed-manager expansion, disabled update, enabled disable/uninstall, confirmed uninstall handoff, retry, and diagnostic export. Diagnostic tests pin the added Desktop version and platform without exposing profile paths or canary content. The keyless built-bundle Web composition mounts the real Plugin Center client with a 14-attempt runtime mismatch and proves the normal page exposes its safe-mode installed manager. Desktop and Plugin Center TypeScript programs compile independently before packaging.
