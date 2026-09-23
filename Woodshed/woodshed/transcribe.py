from __future__ import annotations

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


def _download_audio(video_id: str, destination: Path) -> None:
    try:
        import yt_dlp
    except ImportError as exc:
        raise TranscribeError(
            "yt-dlp is not installed. Install the 'web' extra: pip install -e .[web]"
        ) from exc

    cache_dir = destination.parent
    outtmpl = str(cache_dir / "source.%(ext)s")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as exc:  # yt_dlp raises its own DownloadError subclasses
        raise TranscribeError(
            "Could not download audio for this video. If Woodshed is running on a "
            "cloud host, YouTube sometimes blocks datacenter IPs for downloads — "
            "try again from a locally-run Woodshed instance. "
            f"Original error: {exc}"
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


def _atempo_filter_chain(tempo: float) -> str:
    """Build an ffmpeg filter graph string for a pitch-preserving tempo change.

    ffmpeg's atempo filter only accepts a single value in [0.5, 100.0]. Our
    SPEED_PRESETS go down to 10% (tempo 0.1), so below 0.5 we chain multiple
    atempo stages that multiply together to the requested tempo, each one
    itself within the valid range (peeling off factors of 0.5 until what's
    left is >= 0.5).
    """
    if tempo >= 0.5:
        return f"atempo={tempo}"

    stages: list[float] = []
    remaining = tempo
    while remaining < 0.5:
        stages.append(0.5)
        remaining /= 0.5
    stages.append(remaining)

    return ",".join(f"atempo={stage}" for stage in stages)


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
