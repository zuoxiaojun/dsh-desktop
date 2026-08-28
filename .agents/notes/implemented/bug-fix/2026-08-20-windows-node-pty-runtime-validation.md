# Agent Note: Windows node-pty runtime validation

Status: implemented

English | [中文](2026-08-20-windows-node-pty-runtime-validation.zh.md)

## Problem

The Desktop package verifier required `node-pty/prebuilds/win32-x64/pty.node`. In `node-pty` 1.2.0 beta, `pty.node` is the Unix binding; Windows loads `conpty.node` and `conpty_console_list.node`. A correct Windows x64 runtime therefore failed packaging before installer creation.

## Decision

Windows package validation now requires the two native modules loaded by the installed Windows implementation: `conpty.node` and `conpty_console_list.node`. The verifier continues to require the other Koffi, built-in loader, Sharp, Host, frontend, and package-manager artifacts.

## Verification

The verifier unit fixture contains both Windows `node-pty` modules and proves that removing `conpty_console_list.node` fails the package. The GitHub Windows preview workflow remains the platform acceptance boundary and must still install, launch the Host, uninstall, repair a residual installation, and upload the verified installer.

## Alternatives considered

**Add an empty or copied `pty.node` file.** Rejected because it would satisfy a filename check without representing a loadable Windows runtime.

**Remove all `node-pty` validation.** Rejected because a package can build while missing a native module that only fails when a terminal feature starts.

## Consequences

Windows packaging follows the runtime contract of the pinned `node-pty` version while retaining native-module coverage. Future `node-pty` upgrades must update this list only when the modules actually loaded on Windows change.
