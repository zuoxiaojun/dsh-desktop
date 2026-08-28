# Agent Note: Plugin catalog package subpaths

Status: implemented

English | [中文](2026-08-21-plugin-catalog-package-subpaths.zh.md)

## Problem

The npm catalog listed `dsh-builtin-browser`, but exact-version hydration rejected its Loader module names such as `dsh-builtin-browser/browser` as invalid package names. The UI therefore reported that version detail was temporarily unavailable before installation could begin, even though the package and artifact were available.

## Decision

Catalog authority now separates each Loader module specifier into its npm package owner and optional export subpath. A Bundle may mount its own valid export subpaths, and aggregate Bundles may mount valid subpaths of exact declared dependencies or closed Host-provided packages. Empty segments, `.` and `..` segments, backslashes, unsupported characters, undeclared packages, and non-exact dependency versions remain rejected.

## Verification

The npm ecosystem catalog test reproduces the three published `dsh-builtin-browser@0.1.15` Loader rows, including its YAML expression, and verifies that exact detail becomes eligible with the expected `browser`, `browser-electron`, and `tool-browser` entries. A negative case retains rejection of a traversal-shaped subpath. A live npm smoke check also completed search and exact-version hydration for the published package.

## Alternatives considered

**Treat every string after `name:` as trusted.** Rejected because aggregate packages could then reference undeclared dependencies or unsafe paths.

**Require the publisher to replace subpaths with three packages.** Rejected because npm package export subpaths are valid Loader module specifiers and the published package already exposes them explicitly.

**Special-case `dsh-builtin-browser`.** Rejected because the defect is in module-specifier parsing, and a name-specific exception would repeat for the next valid Bundle using exports.

## Consequences

Issue 17 can proceed through exact detail and installation preflight without weakening archive, package identity, dependency, or path validation. This change does not install Chromium or alter the plugin's runtime dependency behavior; those checks remain owned by the plugin after installation.
