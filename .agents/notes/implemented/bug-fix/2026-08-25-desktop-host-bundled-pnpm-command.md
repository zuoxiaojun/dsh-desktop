# Agent Note: Desktop Host exposes the bundled pnpm command

Status: implemented

English | [中文](2026-08-25-desktop-host-bundled-pnpm-command.zh.md)

## Problem

The packaged Desktop Host runs through Electron's Node mode and carries pnpm as a JavaScript entry, but it does not carry npm or Corepack command installations. A Host plugin that resolves the ordinary `pnpm` command therefore fails when Desktop starts from the Windows shell or another graphical launcher whose PATH does not contain a separately installed package manager.

## Decision

Desktop atomically writes a platform command wrapper named `pnpm` into the existing managed runtime command directory before starting the Host. The wrapper invokes the exact staged pnpm JavaScript entry with Desktop's selected Node executable and enables Electron's Node mode in packaged applications. The Host already receives that managed directory first in PATH, so plugins can use the standard command name without inheriting a terminal configuration.

Every startup replaces the wrapper from current resolved paths. An application update or installation-directory change therefore cannot leave the Host pointing at an obsolete executable. The wrapper adds no package source or version choice: staging and packaged-runtime verification remain authoritative for the pnpm version and entry.

## Alternatives considered

**Bundle npm and Corepack.** Rejected because Desktop already ships the package manager it needs; adding two provisioning mechanisms would increase the runtime and expose additional mutable installation paths.

**Require a global pnpm installation or terminal launch.** Rejected because graphical Desktop launches do not reliably inherit interactive shell configuration, and one-click plugin flows must not depend on workstation setup outside the application.

**Patch only dshmarket.** Rejected because the missing command belongs to the Desktop Host environment. Other installed Host plugins can legitimately use the same bundled package manager contract.

## Consequences

Host plugins can resolve `pnpm` on supported desktop platforms without npm, Corepack, or a global pnpm installation. The command always uses Desktop's staged package manager and inherits the Host process environment. A missing or unwritable managed command directory now blocks Desktop startup before plugins load instead of allowing a later opaque package-installation failure.

## Testing

Desktop runtime tests pin the Windows `.cmd` wrapper with spaced installation paths and Electron Node mode, the executable POSIX wrapper, and the managed command directory's first position in Host PATH. The Windows preview workflow also launches the installed application with a minimal PATH and requires its generated command to report the repository-pinned pnpm version before the installer can be published.
