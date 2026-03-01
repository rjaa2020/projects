# Woodshed LLM Versioning Instructions

This file defines required versioning behavior for LLM/code assistants.

## Required standards

- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) structure in `CHANGELOG.md`.
- Follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- Keep versions aligned between:
  - `pyproject.toml` (`[project].version`)
  - `CHANGELOG.md` (latest released `## [x.y.z] - YYYY-MM-DD` entry)

## Required workflow for feature or behavior changes

1. Add change notes under `## [Unreleased]` during development.
2. When preparing a release:
   - Move unreleased items into a new release section `## [x.y.z] - YYYY-MM-DD`.
   - Update `pyproject.toml` version to the same `x.y.z`.
   - Keep `## [Unreleased]` present for future work.
3. Do not create a release section without updating `pyproject.toml`.
4. Do not update `pyproject.toml` without adding a matching changelog release section.

## Mandatory changelog coverage for LLM edits

- Every non-trivial code change made by an LLM MUST be reflected in `CHANGELOG.md` in the same working session.
- Do not leave placeholder-only unreleased notes when real code changes were made.
- For multi-file work, include concise bullets that cover user-visible behavior changes and important technical changes.
- Classify entries under Keep a Changelog sections (`Added`, `Changed`, `Fixed`, `Removed`) whenever possible.
- Before finishing, verify changelog coverage for modified features/routes/UI and update `Unreleased` if anything is missing.

## Launcher gating requirement

`Launch-Woodshed-Web.bat` gates startup by release version:

- Reads current project version from `pyproject.toml` (`[project].version`).
- Compares to local `.woodshed_last_launched_version`.
- Only proceeds when pyproject version is newer than last launched version.
- Requires `CHANGELOG.md` to include a matching release heading for that version.

When changing this behavior, update both:

- `Launch-Woodshed-Web.bat`
- `README.md` launch instructions

## Release-type guidance

- Patch (`x.y.Z`): bug fixes, non-breaking internal improvements.
- Minor (`x.Y.z`): new backward-compatible features.
- Major (`X.y.z`): breaking behavior/API changes.
