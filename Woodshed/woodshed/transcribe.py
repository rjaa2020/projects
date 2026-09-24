from __future__ import annotations

import os
import re
import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

# Fixed speed presets (percent of original speed). 100 always maps straight to
# the source file; the rest are pitch-preserving time-stretched renders that
# are computed once and cached, so switching speeds in the UI is instant.
SPEED_PRESETS: tuple[int, ...] = (100, 90, 80, 70, 60, 50, 40, 30, 20, 10)

CACHE_ROOT = Path(__file__).resolve().parent.parent / ".cache" / "transcribe"

_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_URL_PATTERNS = (
    re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtu\.be/)([A-Za-z0-9_-]{11})"),
)


class TranscribeError(RuntimeError):
    """Raised for any user-facing failure in the transcribe pipeline."""


def extract_video_id(url_or_id: str) -> str:
    """Pull an 11-character YouTube video ID out of a URL, or accept a bare ID."""
    candidate = (url_or_id or "").strip()
    if not candidate:
        raise TranscribeError("Paste a YouTube URL first.")

    if _YOUTUBE_ID_RE.fullmatch(candidate):
        return candidate

    for pattern in _YOUTUBE_URL_PATTERNS:
        match = pattern.search(candidate)
        if match:
            return match.group(1)

    raise TranscribeError(f"Could not find a YouTube video ID in: {url_or_id!r}")


def _video_cache_dir(video_id: str) -> Path:
    directory = CACHE_ROOT / video_id
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _source_audio_path(video_id: str) -> Path:
    return _video_cache_dir(video_id) / "source.wav"


def _speed_audio_path(video_id: str, speed_percent: int) -> Path:
    return _video_cache_dir(video_id) / f"speed_{speed_percent}.wav"


@dataclass(frozen=True)
class FetchResult:
    video_id: str
    duration_seconds: float
    already_cached: bool


def fetch_audio(url_or_id: str) -> FetchResult:
    """Download (or reuse a cached copy of) a YouTube video's audio track."""
    video_id = extract_video_id(url_or_id)
    source_path = _source_audio_path(video_id)
    already_cached = source_path.exists()

    if not already_cached:
        _download_audio(video_id, source_path)

    duration_seconds = _probe_duration_seconds(source_path)
    return FetchResult(video_id=video_id, duration_seconds=duration_seconds, already_cached=already_cached)


YOUTUBE_COOKIES_FILE_ENV = "YOUTUBE_COOKIES_FILE"

# Where a cookies.txt uploaded through the web UI (see save_uploaded_cookies)
# is written. Deliberately a sibling of CACHE_ROOT, not inside it, so it
# isn't deleted by clear_cache()'s startup wipe of cached audio — an uploaded
# cookies file is meant to keep working across fetches within a run, not get
# thrown away the moment the API restarts. It's still on the same plain disk
# as everything else Transcribe caches, though: on hosts with ephemeral
# storage (Render's free plan) it's gone the moment the instance restarts,
# redeploys, or spins down idle, same as the audio cache. That's a deliberate
# tradeoff for "no dashboard access needed" simplicity — see
# YOUTUBE_COOKIES_FILE_ENV / README.md for the persistent alternative (a
# Render Secret File).
UPLOADED_COOKIES_PATH = CACHE_ROOT.parent / "uploaded_youtube_cookies.txt"

# Netscape-format cookies.txt files are tiny (a handful of KB even with many
# cookies); this is a generous ceiling to keep an unauthenticated upload
# endpoint from being used to write arbitrarily large files to disk.
MAX_UPLOADED_COOKIES_BYTES = 256 * 1024


def _cookies_file_path() -> Path | None:
    """Return the best available YouTube cookies file path, if any.

    Checked in order:
    1. The YOUTUBE_COOKIES_FILE environment variable, if set and the file it
       points at actually exists — typically a Render Secret File or similar,
       set up once and persistent across restarts.
    2. A cookies.txt uploaded through the web UI (see save_uploaded_cookies),
       if present. This is NOT persistent storage (see UPLOADED_COOKIES_PATH)
       but works without any dashboard access, so it's a reasonable fallback
       when the environment variable isn't configured.

    Either way, this lets yt-dlp authenticate as a real account, which is
    what gets past YouTube's "Sign in to confirm you're not a bot" anti-bot
    check on hosts (like Render) whose IPs it flags. See README.md's
    Transcribe section for setup instructions.

    Only file paths are ever read from the environment or returned here —
    cookie contents themselves are never logged or embedded in error
    messages.
    """
    raw_path = os.environ.get(YOUTUBE_COOKIES_FILE_ENV)
    if raw_path:
        configured_path = Path(raw_path)
        if configured_path.is_file():
            return configured_path
    if UPLOADED_COOKIES_PATH.is_file():
        return UPLOADED_COOKIES_PATH
    return None


def save_uploaded_cookies(content: str) -> None:
    """Save a YouTube cookies.txt uploaded through the web UI.

    This exists as a no-dashboard-access fallback for when a fetch fails on
    a cloud host due to YouTube's anti-bot check: rather than needing Render
    dashboard access to set up a Secret File, anyone using the app can export
    their own YouTube cookies and upload them directly. See
    UPLOADED_COOKIES_PATH for the important caveat that this is NOT durable
    storage — it's written to the same ephemeral disk as everything else
    Transcribe caches, so it needs re-uploading after a restart/redeploy/
    spin-down on hosts without persistent disk.

    Only youtube.com cookies are needed (and should be exported) — nothing
    else is used or required.
    """
    if len(content.encode("utf-8", errors="ignore")) > MAX_UPLOADED_COOKIES_BYTES:
        raise TranscribeError("Uploaded cookies file is too large.")
    if not content.strip():
        raise TranscribeError("Uploaded cookies file is empty.")
    if "youtube.com" not in content:
        raise TranscribeError(
            "This doesn't look like it contains YouTube cookies (no youtube.com "
            "entries found). Export cookies from a youtube.com page and try again."
        )

    UPLOADED_COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOADED_COOKIES_PATH.write_text(content, encoding="utf-8")


def _build_ydl_opts(cache_dir: Path, cookies_file: Path | None) -> dict:
    outtmpl = str(cache_dir / "source.%(ext)s")
    ydl_opts: dict = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    if cookies_file is not None:
        ydl_opts["cookiefile"] = str(cookies_file)
    return ydl_opts


def _download_audio(video_id: str, destination: Path) -> None:
    try:
        import yt_dlp
    except ImportError as exc:
        raise TranscribeError(
            "yt-dlp is not installed. Install the 'web' extra: pip install -e .[web]"
        ) from exc

    cache_dir = destination.parent
    cookies_file = _cookies_file_path()
    ydl_opts = _build_ydl_opts(cache_dir, cookies_file)
    url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as exc:  # yt_dlp raises its own DownloadError subclasses
        if cookies_file is not None:
            raise TranscribeError(
                "Could not download audio for this video, even with YouTube cookies "
                "configured. The cookies file may have expired — try re-exporting "
                f"it from a logged-in YouTube session. Original error: {exc}"
            ) from exc
        raise TranscribeError(
            "Could not download audio for this video. If Woodshed is running on a "
            "cloud host, YouTube sometimes blocks datacenter IPs for downloads — "
            "upload a YouTube cookies.txt (see the upload option below) to "
            "authenticate as a real account, configure YOUTUBE_COOKIES_FILE for a "
            "persistent setup (see README.md), or try again from a locally-run "
            f"Woodshed instance. Original error: {exc}"
        ) from exc

    if not destination.exists():
        raise TranscribeError("Audio download finished but no output file (source.wav) was produced.")


def _probe_duration_seconds(wav_path: Path) -> float:
    with wave.open(str(wav_path), "rb") as wav_file:
        frames = wav_file.getnframes()
        rate = wav_file.getframerate() or 1
        return frames / float(rate)


def get_speed_audio_path(video_id: str, speed_percent: int) -> Path:
    """Return the cached audio file for a speed preset, rendering it first if needed."""
    if speed_percent not in SPEED_PRESETS:
        allowed = ", ".join(str(value) for value in SPEED_PRESETS)
        raise TranscribeError(f"Unsupported speed preset '{speed_percent}'. Choose one of: {allowed}")

    source_path = _source_audio_path(video_id)
    if not source_path.exists():
        raise TranscribeError("This video hasn't been fetched yet. Fetch it before requesting audio.")

    if speed_percent == 100:
        return source_path

    output_path = _speed_audio_path(video_id, speed_percent)
    if output_path.exists():
        return output_path

    _render_speed(source_path, output_path, speed_percent)
    return output_path


_ATEMPO_MIN_STAGE = 0.5


def _atempo_filter_chain(tempo: float) -> str:
    """Build an ffmpeg filter graph string for a pitch-preserving tempo change.

    ffmpeg's atempo filter only accepts a single value in [0.5, 100.0]. Our
    SPEED_PRESETS go down to 10% (tempo 0.1), so below 0.5 we chain multiple
    atempo stages that multiply together to the requested tempo.

    Each stage is set to the same value (the geometric mean, tempo ** (1/n)
    for the smallest n that keeps every stage >= 0.5), rather than peeling off
    stages pinned at the extreme 0.5 floor. atempo's resampling artifacts get
    worse the further a single stage is from 1.0, so pinning repeated stages
    at the most aggressive value ffmpeg allows compounds distortion far more
    than splitting the same overall change evenly. Empirically (comparing
    spectral energy outside a test tone's expected harmonics) this roughly
    halved-or-better the stray energy introduced at 40% and below versus the
    old peel-off-0.5 approach, and removed the audible jump right at the
    50%->40% boundary where a second stage first becomes necessary.
    """
    if tempo >= _ATEMPO_MIN_STAGE:
        return f"atempo={tempo}"

    stage_count = 1
    while tempo ** (1.0 / stage_count) < _ATEMPO_MIN_STAGE:
        stage_count += 1
    stage_value = tempo ** (1.0 / stage_count)

    return ",".join(f"atempo={stage_value}" for _ in range(stage_count))


@dataclass(frozen=True)
class CacheClearResult:
    videos_removed: int
    bytes_freed: int


def clear_cache() -> CacheClearResult:
    """Delete every cached video's audio (source + all rendered speeds).

    Cached audio only earns its keep for the length of a working session —
    it exists purely to make switching speeds instant while you're actively
    using Transcribe. Called when the app is shutting down (see the web
    app's `/quit` route) so the cache doesn't just grow forever across runs.
    """
    if not CACHE_ROOT.exists():
        return CacheClearResult(videos_removed=0, bytes_freed=0)

    videos_removed = 0
    bytes_freed = 0
    for entry in CACHE_ROOT.iterdir():
        if not entry.is_dir():
            continue
        bytes_freed += sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
        shutil.rmtree(entry, ignore_errors=True)
        videos_removed += 1

    return CacheClearResult(videos_removed=videos_removed, bytes_freed=bytes_freed)


def _render_speed(source_path: Path, output_path: Path, speed_percent: int) -> None:
    if shutil.which("ffmpeg") is None:
        raise TranscribeError(
            "ffmpeg is not on PATH. It's required to render slowed-down audio."
        )

    # ffmpeg's atempo filter takes a tempo multiplier directly: 50% speed is
    # atempo=0.5, 90% speed is atempo=0.9, etc. This is pitch-preserving.
    tempo = speed_percent / 100.0
    command = [
        "ffmpeg",
        "-y",
        "-i", str(source_path),
        "-filter:a", _atempo_filter_chain(tempo),
        "-vn",
        str(output_path),
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise TranscribeError(f"Failed to run ffmpeg for {speed_percent}% speed: {exc}") from exc

    if result.returncode != 0 or not output_path.exists():
        stderr_tail = (result.stderr or "").strip().splitlines()[-5:]
        raise TranscribeError(
            f"Failed to render {speed_percent}% speed (ffmpeg exit code {result.returncode}): "
            + " | ".join(stderr_tail)
        )
