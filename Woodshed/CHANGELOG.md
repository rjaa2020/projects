# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.9.2] - 2026-09-24

### Fixed
- Fixed the 3.9.0 cookie upload actually failing for a real user-reported cookies file: it was in the JSON format several cookie-export tools (Chrome's "Cookie-Editor"/"EditThisCookie" extensions, Chrome DevTools' own export, Puppeteer/Playwright's cookie format) produce by default, rather than the Netscape `cookies.txt` format yt-dlp requires — the upload was accepted (it does contain `youtube.com` text) but yt-dlp couldn't parse it, so the fetch kept failing with a misleading "cookies may have expired" message. `save_uploaded_cookies()` now detects a JSON cookie export and converts it to proper Netscape format (including the `#HttpOnly_` domain-prefix convention for HttpOnly cookies, and `0`/"session" handling for cookies with no expiration), verified against yt-dlp's own cookie-jar loader. Also fixed the upload file picker's `accept` attribute only listing `.txt`, which hid `.json` exports (like the one reported) from being selectable at all — it now accepts both.
- Slightly clarified the "cookies configured but download still failed" error message to mention a possible parse issue, not just expiry, since that ambiguity is what made this bug harder to diagnose from the error message alone.

## [3.9.1] - 2026-09-24

### Changed
- Added step-by-step instructions (with a direct link to install the "Get cookies.txt LOCALLY" Chrome extension) next to Transcribe's cookie-upload box, added in 3.9.0. Browsers don't let one site's JavaScript read another site's cookies — and YouTube's session cookies are `HttpOnly`, so not even YouTube's own page scripts can read them — so there's no way to build a button that fetches YouTube cookies automatically; a cookie-export browser extension (with its own opt-in, domain-scoped permission) is the only way to get them out. This just makes that manual step easier to follow instead of only naming the extension in passing.

## [3.9.0] - 2026-09-24

### Added
- Added a way to upload a YouTube cookies.txt directly through the Transcribe UI, as a no-dashboard-access fallback for the "Sign in to confirm you're not a bot" error added in 3.8.0. When a fetch fails, the page now shows an upload box; the file is validated (non-empty, contains youtube.com entries, under 256KB) and saved for `yt-dlp` to use on the next fetch. This is explicitly **not persistent** — it's written to the same ephemeral disk as the rest of Transcribe's cache, so it's lost on a Render restart/redeploy/idle spin-down, unlike the `YOUTUBE_COOKIES_FILE` Secret File setup from 3.8.0 (which still takes priority when both are configured). Only youtube.com cookies are needed for this to work.

## [3.8.0] - 2026-09-23

### Added
- Added optional cookie-based YouTube authentication for Transcribe's audio fetch, to fix "Sign in to confirm you're not a bot" download failures on cloud hosts like Render (YouTube blocks datacenter IPs from downloading without auth). Set the `YOUTUBE_COOKIES_FILE` environment variable to the path of a cookies.txt exported from a logged-in YouTube session (e.g. a Render Secret File) and `yt-dlp` will use it to authenticate. See README.md's Transcribe section for export/setup steps and tradeoffs (cookies expire periodically and need re-exporting). Behavior is unchanged when the variable isn't set.

### Changed
- Refined the Transcribe fetch-failure error message to distinguish "no cookies configured" (suggests setting `YOUTUBE_COOKIES_FILE` or trying a local instance) from "cookies configured but the download still failed" (suggests the cookies file has expired and needs re-exporting).

## [3.7.0] - 2026-09-23

### Added
- Added automatic cleanup of Transcribe's cached audio: on API startup, every previously cached video's audio (the original download plus every rendered speed) is deleted. Previously nothing ever cleaned this up, so `.cache/transcribe/` just grew forever across fetches. Cleanup runs on startup rather than on a clean shutdown so it happens no matter how the previous run ended (the "Quit" button, closing the terminal, Ctrl+C, or a crash), and never risks delaying shutdown.

## [3.6.1] - 2026-09-23

### Removed
- Removed the "phrase view" added in 3.6.0. User feedback: "there's never any silence" — the gap-detection heuristic looked for quiet spans in the full mixed-track audio, but with a rhythm section playing underneath, the track rarely drops in volume just because the soloist pauses, so it almost never found a gap. Same underlying limitation as the spectrogram it replaced (analyzing the full mix instead of the isolated soloist), which really needs stem separation (the deferred v4 roadmap item) to do well. The waveform + scrub bar (unaffected by this change) remain the way to find your spot for now.

## [3.6.0] - 2026-09-23

### Fixed
- Fixed audible quality loss when switching to speeds at or below 40% in Transcribe. Below 50% speed, `ffmpeg`'s `atempo` filter has to be chained across multiple stages (a single stage only goes down to 0.5), and the previous chaining strategy always used the most extreme stage value ffmpeg allows (0.5) for as many stages as possible, which measurably increases distortion — that's why 40% and below sounded like a bigger drop than 50% and above. Stages are now split evenly (each stage is the geometric mean of the target tempo), which keeps every stage closer to 1.0 and, in spectral testing against a sustained test tone, cut stray/distortion energy at 40% by roughly an order of magnitude versus the old approach, with no change to how far down speeds can go.

### Changed
- Switching speed presets in Transcribe now swaps in already-downloaded audio instead of fetching it fresh over the network, removing most of the "jump" (pause/reset) that switching speeds used to have. All non-current speeds are pre-fetched in the background as soon as a loop section is opened, so by the time you click a different speed preset it's usually already in memory.
- Replaced the spectrogram ("pitch view") below the waveform with a "phrase view": a simpler display that shades quiet gaps (likely phrase boundaries) and marks note onsets, computed once from the audio's volume envelope. Unlike the spectrogram, it isolates timing information from the full mixed-band frequency content, which testing showed was cluttered by drums/bass/piano rather than helpful for finding the soloist's phrasing. It also now tracks the current playback position live, which the spectrogram never did. It's off by default and can be toggled on with the "Show" checkbox.

## [3.5.0] - 2026-09-23

### Changed
- Transcribe is now the app's landing page (`/`); the seventh-chord quiz moved to `/quiz` and is relabeled "Chord Quiz" in the top nav (was "Practice"). `/transcribe` still works as an alias.
- Switching speed presets in Transcribe now preserves your position in the track and whether it was playing, instead of jumping back to the start.
- Reworked the Loop & Slow transport controls for clarity: a single play/pause button that reflects actual playback state (icon changes, and updates automatically at end-of-track), current-time/duration labels, and a clearer "Loop this section when it plays through" label.
- Extended the speed presets down to 10% (100/90/80/70/60/50/40/30/20/10%), for very difficult passages. Below 50% speed, `ffmpeg`'s `atempo` filter is chained across multiple stages internally (it only accepts a single value down to 0.5) — this is invisible to the user and was verified to still scale durations correctly and preserve pitch at every preset.

### Added
- Added a scrub bar under the waveform in Transcribe for seeking playback directly, instead of only being able to click within the waveform (which is reserved for marking loop regions).
- Added a spectrogram ("pitch view") below the waveform in Transcribe, to make note onsets/changes and phrase boundaries easier to spot than on the amplitude waveform alone. It can be toggled off if not wanted.

## [3.4.0] - 2026-09-23

### Fixed
- Fixed incorrect Transcribe speed-preset rendering: `audiostretchy` (used by the previous release) silently quantized output duration for short clips, so several distinct speed presets (e.g. 90/80/70%, and separately 60/50%) rendered to the exact same duration instead of scaling with the requested speed. Replaced it with `ffmpeg`'s `atempo` audio filter, which was verified (via direct duration checks and FFT pitch analysis) to scale correctly per-preset while still preserving pitch. `audiostretchy` is no longer a dependency.

### Added
- Added a live timestamp display in the Transcribe "Loop & Slow" section: current playback position / total duration, and the start–end–duration of the currently marked loop region, both updating live as you play, drag, or resize.
- Added a shared, unit-tested time-conversion/formatting module (`web/public/transcribeTime.js`) used by both the waveform UI and its test suite.
- Added a regression test (`tests/test_transcribe.py`) that renders every speed preset and asserts each produces a distinct, correctly-scaled duration — the exact class of bug fixed above.
- Added `web/tests/transcribeTime.test.js` covering the new time-conversion/formatting helpers.

## [3.3.0] - 2026-09-23

### Added
- Added a new Transcribe feature: paste a YouTube URL, browse the video, then mark and name loop regions on a waveform to practice jazz solos phrase by phrase.
- Added pitch-preserving slow-down for Transcribe loops via fixed speed presets (100/90/80/70/60/50%), rendered once per video and cached.
- Added a Python `woodshed.transcribe` module: YouTube audio fetch/cache via `yt-dlp`, and speed-preset rendering via `audiostretchy`.
- Added FastAPI endpoints `POST /transcribe/fetch` and `GET /transcribe/audio/{video_id}` to the Woodshed API.
- Added a new "Transcribe" page and top navigation link in the web GUI, built with wavesurfer.js for waveform display and drag-to-select loop regions.
- Added named loop region storage (`web/lib/transcribeStore.js`) using the same Postgres-when-`DATABASE_URL`-is-set / in-memory-otherwise pattern as existing named user saves, so it works both locally and on the current Render deployment.
- Added `ffmpeg` to the Docker image and to `Launch-Woodshed-Web.bat`'s dependency checks (with winget/choco/scoop auto-install), since `yt-dlp` needs it to extract audio.
- Added `yt-dlp` and `audiostretchy` to the `web` extra in `pyproject.toml`.
- Added tests for the transcribe pipeline's pure logic (video ID parsing, speed-preset validation, stretch rendering) and for the loop store (`tests/test_transcribe.py`, `web/tests/transcribeStore.test.js`).

### Known limitations
- Downloading YouTube audio from a cloud host (e.g. Render) can be blocked by YouTube's bot detection on datacenter IPs; Transcribe fetches are most reliable when run from a locally-launched Woodshed instance. A failed fetch surfaces this in the UI.
- On Render's free plan there's no persistent disk, so cached audio for Transcribe doesn't survive a redeploy or an idle spin-down; a video's audio simply re-downloads on the next fetch.

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
