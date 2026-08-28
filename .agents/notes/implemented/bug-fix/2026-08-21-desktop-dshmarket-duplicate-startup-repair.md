# Agent Note: Desktop dshmarket duplicate startup repair

Status: implemented

English | [中文](2026-08-21-desktop-dshmarket-duplicate-startup-repair.zh.md)

## Problem

Profiles created by an older Desktop release can contain a manual `dshmarket` insert in `cordis.patch.yml`. Current Desktop installation also activates `dshmarket` through `dsh.profile.bundles`. Both layers therefore instantiate the package, and the second instance fails before readiness when it tries to register the existing `dsh-market` locale namespace.

## Decision

Desktop now runs a narrow migration before normal Host startup. It acts only when the selected Profile lists `dshmarket` as active or disabled, the installed package manifest declares a real Bundle patch, and that patch itself inserts `dshmarket`. The migration removes only nested manual `insert` entries whose package name is exactly `dshmarket`; it preserves direct `id: dsh-market` configuration overrides, unrelated entries, comments, and supported YAML tags. The changed profile patch is written atomically.

## Verification

The Desktop test fixture reproduces both activation layers, runs the migration, and composes the resulting Profile through the production profile loader. It proves that exactly one `dshmarket` entry remains, the id-targeted configuration still applies, unrelated entries and YAML content survive, and a second migration is a no-op. Negative fixtures prove that a manual install is not changed when the verified Bundle activation is absent.

## Alternatives considered

**Ignore duplicate locale registration.** Rejected because it would hide duplicate plugin instances while leaving their other services, routes, and side effects duplicated.

**Delete the profile patch or every `dshmarket` reference.** Rejected because the file can contain user configuration and unrelated plugins, while the direct id override is the intended way to configure the Bundle-owned entry.

**Deduplicate every package across all layers.** Rejected because other packages may intentionally support multiple instances, and no general migration contract has been established.

## Consequences

Affected existing installations repair themselves on the next Desktop start without requiring users to delete their Profile. The repair remains intentionally limited to the confirmed `dshmarket` migration shape; unrelated cross-layer conflicts continue to fail explicitly instead of being guessed away.
