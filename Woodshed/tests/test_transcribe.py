import math
import shutil
import wave

import pytest

import woodshed.transcribe as transcribe


def test_extract_video_id_from_watch_url():
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert transcribe.extract_video_id(url) == "dQw4w9WgXcQ"


def test_extract_video_id_from_watch_url_with_extra_params():
    url = "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=42s"
    assert transcribe.extract_video_id(url) == "dQw4w9WgXcQ"


def test_extract_video_id_from_short_url():
    url = "https://youtu.be/dQw4w9WgXcQ?t=10"
    assert transcribe.extract_video_id(url) == "dQw4w9WgXcQ"


def test_extract_video_id_from_shorts_url():
    url = "https://www.youtube.com/shorts/dQw4w9WgXcQ"
    assert transcribe.extract_video_id(url) == "dQw4w9WgXcQ"


def test_extract_video_id_accepts_bare_id():
    assert transcribe.extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_extract_video_id_rejects_empty_input():
    with pytest.raises(transcribe.TranscribeError):
        transcribe.extract_video_id("   ")


def test_extract_video_id_rejects_unrecognized_url():
    with pytest.raises(transcribe.TranscribeError):
        transcribe.extract_video_id("https://example.com/not-a-video")


def test_get_speed_audio_path_rejects_unsupported_preset(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    with pytest.raises(transcribe.TranscribeError, match="Unsupported speed preset"):
        transcribe.get_speed_audio_path("abcdefghijk", 73)


def test_get_speed_audio_path_requires_fetch_first(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    with pytest.raises(transcribe.TranscribeError, match="hasn't been fetched"):
        transcribe.get_speed_audio_path("abcdefghijk", 100)


def test_get_speed_audio_path_at_100_percent_returns_source_directly(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    video_id = "abcdefghijk"
    source_path = transcribe._source_audio_path(video_id)
    _write_tone_wav(source_path, seconds=1.0)

    result_path = transcribe.get_speed_audio_path(video_id, 100)

    assert result_path == source_path


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not on PATH")
def test_render_speed_produces_a_longer_file_when_slowed_down(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    video_id = "abcdefghijk"
    source_path = transcribe._source_audio_path(video_id)
    _write_tone_wav(source_path, seconds=2.0)

    output_path = transcribe.get_speed_audio_path(video_id, 50)

    assert output_path.exists()
    rendered_seconds = _wav_duration_seconds(output_path)
    # Slowing to 50% speed should roughly double the duration.
    assert math.isclose(rendered_seconds, 4.0, rel_tol=0.2)

    # Cached on the second call rather than re-rendered.
    cached_path = transcribe.get_speed_audio_path(video_id, 50)
    assert cached_path == output_path


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not on PATH")
def test_render_speed_scales_correctly_and_distinctly_across_all_presets(tmp_path, monkeypatch):
    # Regression test: audiostretchy (a previous implementation of this
    # feature) silently collapsed several distinct speed presets to the same
    # output duration for short clips (e.g. 90/80/70% all rendered
    # identically, as did 60/50%), even though the requested ratios were
    # clearly different. This test renders every preset from SPEED_PRESETS
    # and checks each produces a duration proportional to its own speed,
    # and that no two non-100% presets collapse to the same duration.
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    video_id = "abcdefghijk"
    source_path = transcribe._source_audio_path(video_id)
    source_seconds = 6.0
    _write_tone_wav(source_path, seconds=source_seconds)

    durations_by_speed = {}
    for speed_percent in transcribe.SPEED_PRESETS:
        output_path = transcribe.get_speed_audio_path(video_id, speed_percent)
        durations_by_speed[speed_percent] = _wav_duration_seconds(output_path)

    for speed_percent, rendered_seconds in durations_by_speed.items():
        expected_seconds = source_seconds * (100.0 / speed_percent)
        assert math.isclose(rendered_seconds, expected_seconds, rel_tol=0.15), (
            f"speed {speed_percent}%: expected ~{expected_seconds:.2f}s, "
            f"got {rendered_seconds:.2f}s"
        )

    non_source_durations = [
        round(duration, 1)
        for speed, duration in durations_by_speed.items()
        if speed != 100
    ]
    assert len(non_source_durations) == len(set(non_source_durations)), (
        f"expected a distinct duration per non-100% speed preset, got: {durations_by_speed}"
    )


def _write_tone_wav(path, seconds, frame_rate=22050, frequency=220.0):
    """Write a synthetic sine-tone WAV (not silence) at the given path.

    A real (non-silent) tone is used rather than silence so that any future
    stretch implementation which analyzes the waveform (as audiostretchy's
    period-detection algorithm did) is exercised the same way real audio
    would exercise it.
    """
    import math as _math
    import struct

    path.parent.mkdir(parents=True, exist_ok=True)
    frame_count = int(seconds * frame_rate)
    amplitude = 8000
    samples = [
        int(amplitude * _math.sin(2 * _math.pi * frequency * (i / frame_rate)))
        for i in range(frame_count)
    ]
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(frame_rate)
        wav_file.writeframes(struct.pack("<%dh" % len(samples), *samples))


def _wav_duration_seconds(path):
    with wave.open(str(path), "rb") as wav_file:
        return wav_file.getnframes() / float(wav_file.getframerate())
