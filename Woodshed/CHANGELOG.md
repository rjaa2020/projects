# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Placeholder for upcoming changes.

## [0.3.0] - 2026-02-27

### Added
- Added a visual two-octave piano keyboard for note input in the web quiz.
- Added a root-note marker dot on the lower octave key for each prompt.
- Added keyboard utility controls for note entry (`Backspace` and `Clear`).
- Added per-question timer controls with `Pause` and `Resume` in the web quiz.
- Added an overall running timer display in `MM:SS` format (auto-expands to `HH:MM:SS` after one hour).

### Changed
- Sorted incorrect-answer note comparison chips from the prompt root instead of fixed chromatic order.
- Highlighted the correct chord tones directly on the piano keyboard after incorrect submissions.
- Added a fade-out animation for correct-note highlights that lasts 10 seconds after submit.
- Updated graph display behavior to show the inline timing graph only when a stats cell is explicitly clicked.
- Updated pause behavior to hide quiz interaction content (prompt, answer area, and result feedback) until resumed.
- Updated timing calculation to exclude paused duration from recorded answer time.

## [0.2.1] - 2026-02-27

### Changed
- Disabled browser autocomplete/autofill more aggressively in web quiz forms and answer inputs.
- Added an incorrect-answer comparison view that highlights matched, missing, and extra notes.
- Normalized note-name display formatting across feedback, graph titles/labels, stats key labels, and key filter labels (for example, `Bb`, `Eb`).

## [0.2.0] - 2026-02-27

### Changed
- Replaced the separate stats page with an inline stats panel shown to the right of the quiz.
- Scoped stats display to currently selected keys and chord qualities.
- Simplified stats table cells to show score only.
- Added click-to-select score cells that render a labeled "Time vs Attempt" graph below the quiz.
- Updated stats interaction flow to preserve quiz state while viewing timing details.

## [0.1.0] - 2026-02-27

### Added
- Initial Woodshed CLI, API, and web trainer setup.
- Adaptive score tracking by key × chord quality.
- Any-order chord-tone answer checking.
- Attempt-time tracking by key × chord quality.
- Stats page average response-time table and click-through time-series graph view.
