# Agent Note: Plugin recovery tolerates historical lockfile incompatibility

Status: implemented

English | [中文](2026-08-22-plugin-recovery-lockfile-compatibility.zh.md)

## Problem

Plugin recovery restores the pre-mutation Profile manifest and lockfile before re-materializing its dependencies. When that historical `pnpm-lock.yaml` is incompatible with the packaged pnpm version or the current platform, every explicit retry repeats the same `--frozen-lockfile` command and leaves Desktop permanently blocked on `package-restore-failed`.

## Decision

Recovery still attempts the exact frozen lock first. If that process exits unsuccessfully and the snapshot contained a lockfile, Desktop performs one compatibility install from the restored `package.json` with `--no-frozen-lockfile --lockfile=false`. This fallback may re-materialize `node_modules`, but it cannot rewrite the historical lockfile. The existing target-package presence check and prior Host, client, and Skill evidence verification remain mandatory before recovery publishes `rolled-back` and releases normal startup.

Process-launch errors do not trigger the fallback because retrying the same missing or unusable packaged runtime cannot repair it. A Profile whose snapshot had no lockfile already uses the non-frozen command and receives no duplicate attempt. When both commands fail, the bounded diagnostic includes both failure summaries and recovery remains closed.

## Alternatives considered

**Discard the recovery journal after repeated failures.** Rejected because the Profile may still contain a partially applied package mutation, and starting it without runtime evidence can load untrusted or inconsistent plugin code.

**Delete the Profile and silently start from built-ins.** Rejected because that would remove user-installed plugins and composition choices without an explicit reset decision.

**Regenerate the historical lockfile.** Rejected because the lockfile is recovery evidence. Compatibility mode deliberately leaves it byte-identical and changes only the disposable dependency tree.

## Consequences

Old Windows Profiles can recover across pnpm and platform changes when their exact package specifications remain resolvable, without weakening the post-recovery runtime checks. Missing packaged pnpm, unavailable plugin archives, and genuinely unresolvable dependencies still fail closed and remain diagnosable.

## Testing

The package-manager suite pins the two-step Windows invocation, requires `--lockfile=false` only on the compatibility attempt, and proves Profiles without historical lockfiles do not run a duplicate command. Existing recovery-controller tests continue to require exact target-package presence and runtime evidence before startup resumes.
