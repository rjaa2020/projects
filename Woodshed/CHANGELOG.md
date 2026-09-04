# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.2.0] - 2026-03-13

### Added
- Replaced the quiz's piano input area with a selectable Circle of Fifths key selector.
- Added a styled Circle of Fifths visualization with concentric rings, radial dividers, and inner relative-minor labels.
- Added support in note-comparison feedback for enharmonic matching across sharps/flats and double accidentals (`bb`, `##`, `x`, `𝄫`, `𝄪`).
- Added backend quiz-grading support for double accidentals and equivalent enharmonic pitch-class matching.
- Added a regression test for double-accidental answer acceptance.
- Added a `Quit` button in the web UI to stop Woodshed backend processes.
- Added named user save caching in the web app with `Load User` and `Save User` controls.
- Added on-disk web save storage at `web/data/user-saves.json` for cross-session progress continuation.
- Added a saved-user dropdown with one-click load behavior in the web filters.
- Added Jazz 1460 catalog integration via iReal forum links with on-demand song fetch and local chart caching.
- Added chart-only quiz mode so prompts are restricted to supported seventh-chord symbols from the selected song.
- Added instrument-key selection (`C`, `Bb`, `Eb`) for chart mode with transposed quiz prompts.
- Added chart-mode and parser tests for iReal extraction, minimal payload parsing, and instrument transposition.
- Added filter-mode tabs in the right panel above stats, with `Jazz 1460` as the default tab and `Circle + Qualities` as the second tab.

### Changed
- Wired Circle of Fifths key toggles directly to practice-key selection (`includeKeys`) in the web filters.
- Reworked web layout so quiz content remains on the left while the right column stacks filters, stats, and selected-cell timing graph.
- Moved chord-quality filters above the Circle of Fifths and aligned all five qualities on a single row.
- Refined Circle of Fifths geometry and typography so labels sit between divider lines, minor labels sit closer to the center dial, and the overall diagram is smaller.
- Updated center dial border thickness to 5px.
- Replaced stats net-score cells with color-coded correct/incorrect ratio cells.
- Moved selected-cell timing graph placement to below the stats table in the right column.
- Added a shutdown route that invokes the existing process cleanup script to terminate Woodshed API/web processes across sessions.
- Updated web session flow to preserve in-progress state on refresh and persist active-user progress after score/filter/stat updates.
- Moved named-save controls into a dedicated panel below the logo and above the quiz, separate from filters/stats content.
- Restyled named-save controls as a top horizontal ribbon (login-style) with inline user/select fields and compact load/save/quit actions.
- Updated stats rendering in chart mode to grey out unavailable key/chord cells and disable their click-through behavior.

### Removed
- Removed obsolete piano/timer-adjacent UI code paths and styling now that key selection is circle-based.

## [3.1.0] - 2026-02-28

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
- Replaced score cells with color-coded correct/incorrect ratio cells in the stats table.
- Removed the standalone stats time-series page route in favor of the inline graph flow.
- Removed the per-question timer UI and pause/resume controls from the quiz screen.

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
