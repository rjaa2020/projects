# Woodshed Note Trainer

Woodshed uses one Python engine for all chord logic.

- `woodshed` package: music theory + quiz engine (single source of truth)
- Python API: exposes engine via HTTP
- Node web app: GUI only, calls the Python API

## Install (local)

```bash
pip install -e .
```

## Run

```bash
woodshed --rounds 10 --types maj7 7 min7 m7b5 dim7
```

You can also run:

```bash
python main.py --rounds 10
```

## Run Python API

```bash
pip install -e .[web]
python -m woodshed.api
```

API base URL: `http://127.0.0.1:8000`

## Test

```bash
pip install -e .[test]
pytest
```

## Build for PyPI

```bash
python -m build
```

This creates distributable files in `dist/`.

## Web GUI (Node.js)

The Node.js web server only renders UI and calls the Python API.

In the GUI, use checkboxes to include keys and chord qualities, then click **Save Filters**.
Filtering logic is enforced by the Python package, not by frontend-only rules.

Use **View Stats** to open a separate table page with key × chord-quality scores:
- `0` = untested
- `+1` per correct answer
- `-1` per incorrect answer

The stats page also includes an **Average Response Time** table by key × chord quality,
displayed as average seconds with attempt count.
Click any average-time cell to view a time-series graph for that specific key/chord quality.

For programmatic access, the web app exposes `GET /stats-data` with scores,
attempt-time arrays, and per-cell average attempt times.

Prompt sampling is adaptive: lower-scored combinations appear more often, and higher-scored combinations appear less often.

```bash
cd web
npm install
npm start
```

Then open http://localhost:3000 in your browser.

Or from the `Woodshed` root:

```bash
npm run web:install
npm run web
```

If your API runs elsewhere, set a custom API URL:

```bash
set WOODSHED_API_URL=http://127.0.0.1:8000
npm run web
```

Optionally set a session secret for web state:

```bash
set WOODSHED_SESSION_SECRET=your_secret_here
npm run web
```

## Transcribe (loop & slow down jazz solos)

**Transcribe is the app's landing page** (`/`; also reachable at
`/transcribe`). The seventh-chord quiz lives at `/quiz`, labeled "Chord
Quiz" in the top nav. Transcribe is a practice aid for transcribing jazz
solos: paste a YouTube URL, browse the video to find a solo, then mark and
name loop regions on a waveform and play them back at a slower speed
without pitch-shifting.

- Speeds are fixed presets from 100% down to 10% in steps of 10, each
  rendered once via `ffmpeg`'s pitch-preserving `atempo` audio filter and
  cached, so switching speed is instant after the first render. Below 50%
  speed, `atempo` is chained across multiple evenly-split stages (it only
  accepts a single value down to 0.5) to keep distortion as low as
  practical. Switching speed preserves your position in the track and
  whether it was playing, and is pre-fetched in the background so the swap
  itself has no network delay.
- A scrub bar under the waveform seeks playback directly (dragging inside
  the waveform itself is reserved for marking loop regions).
- Audio is downloaded once per video with `yt-dlp` and cached on disk under
  `.cache/transcribe/` (gitignored) for the length of a working session — it's
  wiped automatically the next time the API starts up, so it never
  accumulates across runs.
- Named loop regions persist the same way user saves do: Postgres when
  `DATABASE_URL` is set, in-memory otherwise.

Requires `ffmpeg` on `PATH` (used by `yt-dlp` to extract audio, and directly
to render each speed preset); the one-click launcher below installs it
automatically on Windows.

**Known limitations:**
- YouTube sometimes blocks downloads from datacenter/cloud IPs (including
  Render's) with a "Sign in to confirm you're not a bot" error. Configuring
  `YOUTUBE_COOKIES_FILE` (below) fixes this by authenticating `yt-dlp` as a
  real account, and so does uploading a cookies.txt directly through the UI
  when a fetch fails; without either, try the fetch from a locally-launched
  Woodshed instead — a failed fetch shows this in the UI.
- Render's free plan has no persistent disk, so cached audio there doesn't
  survive a redeploy or an idle spin-down; it just re-downloads next time.

### Fixing YouTube's "Sign in to confirm you're not a bot" error on Render

YouTube blocks downloads from IPs it recognizes as datacenter/cloud hosting,
which includes Render's. The fix is to have `yt-dlp` authenticate with
cookies from a real, logged-in YouTube session. There are two ways to supply
them:

**Option A — upload through the app (quick, but not persistent).** When a
fetch fails on the deployed instance, the Transcribe page shows an upload
box right there. Export your **youtube.com** cookies only (a cookie-export
browser extension like "Get cookies.txt LOCALLY" can filter to just that
site — nothing else is needed) to a `cookies.txt` file and upload it, then
try the fetch again. This needs no Render dashboard access, but the
uploaded file lives on the same disk as everything else Transcribe caches:
it disappears the moment the Render instance restarts, redeploys, or spins
down after being idle, so you'll need to re-upload it again after any of
those.

**Option B — a Render Secret File (persistent).**

1. In a browser where you're logged into YouTube, use a cookie-export
   extension (e.g. "Get cookies.txt LOCALLY") to export your YouTube cookies
   in Netscape format to a `cookies.txt` file.
2. In the Render dashboard, open your service → **Environment** → **Secret
   Files**, and add a secret file with that `cookies.txt` content. Render
   mounts secret files at `/etc/secrets/<filename>`, so a file named
   `cookies.txt` is available at `/etc/secrets/cookies.txt`.
3. Add an environment variable `YOUTUBE_COOKIES_FILE` set to that mounted
   path (e.g. `/etc/secrets/cookies.txt`) and redeploy.

This survives restarts/redeploys/spin-downs, unlike Option A. If both are
set up, the `YOUTUBE_COOKIES_FILE` Secret File takes priority; the uploaded
cookies file is only used as a fallback when it isn't configured (or its
path doesn't exist).

Either way, only the cookies file's path or content is ever touched — cookie
contents are never logged or embedded in error messages.

Tradeoffs to know about:
- Exported cookies expire periodically (often after some weeks), so a
  download failure after this has been working for a while usually means
  re-exporting a fresh `cookies.txt` and re-uploading or re-adding it.
- Using your own account's cookies for automated downloads carries a small
  risk of YouTube flagging that account for unusual activity. Consider using
  a secondary/throwaway Google account rather than your primary one.
- Without either option configured, Transcribe falls back to the previous
  unauthenticated behavior (which may hit the bot-check on cloud IPs).

## One-click launch (Windows)

Double-click [Launch-Woodshed-Web.bat](Launch-Woodshed-Web.bat) from the Woodshed folder.

It starts:
- Python API on `http://127.0.0.1:8010`
- Web GUI on `http://127.0.0.1:3010`

Before launching, it automatically:
- Stops existing Woodshed API/web processes and clears conflicts on these ports
- Creates `.venv` if needed
- Reuses existing Python package installation if available; installs only when missing/incomplete
- Installs web npm dependencies (`npm run web:install`) only when web dependency manifests change
- Verifies API health before opening the browser

If Python/Node are missing, the launcher attempts package-manager install where possible:
- Windows: `winget` (fallback: `choco`, `scoop`)

The launcher is version-gated:
- It reads the current version from `pyproject.toml` (`[project].version`).
- It only launches when that version is newer than the local `.woodshed_last_launched_version` marker.
- `CHANGELOG.md` must include a matching release heading for that version.

To bypass the new-version gate for local testing, run:

```bash
Launch-Woodshed-Web.bat --force
```

`--force` also forces a reinstall of only the local Woodshed package (`pip install --force-reinstall --no-deps -e "."`).
Third-party web dependencies (`fastapi`, `uvicorn`) are installed only if missing.

If launch still fails, check the opened **Woodshed API** PowerShell window for the first Python traceback or dependency error.

## Maintainer note for LLM/code-assistant updates

When architecture or startup flow changes, keep launcher dependency checks in sync.
See [LLM_DEPENDENCY_CHECKS.md](LLM_DEPENDENCY_CHECKS.md).

For release/version maintenance rules for coding assistants, see [LLM_VERSIONING_INSTRUCTIONS.md](LLM_VERSIONING_INSTRUCTIONS.md).
