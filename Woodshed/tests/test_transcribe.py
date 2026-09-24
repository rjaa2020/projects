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


def test_atempo_filter_chain_single_stage_for_tempo_at_or_above_half():
    assert transcribe._atempo_filter_chain(1.0) == "atempo=1.0"
    assert transcribe._atempo_filter_chain(0.5) == "atempo=0.5"


def test_atempo_filter_chain_splits_evenly_below_half():
    # Below 0.5, every stage should be the SAME value (the geometric mean),
    # not one stage pinned at the extreme 0.5 floor plus a leftover stage.
    # Pinning a stage at the most aggressive value atempo allows compounds
    # distortion more than splitting the change evenly across stages.
    chain = transcribe._atempo_filter_chain(0.4)
    stages = [float(part.split("=")[1]) for part in chain.split(",")]
    assert len(stages) == 2
    assert stages[0] == pytest.approx(stages[1])
    assert math.prod(stages) == pytest.approx(0.4)
    assert all(stage >= 0.5 for stage in stages)


def test_atempo_filter_chain_stage_count_grows_for_very_low_tempo():
    chain = transcribe._atempo_filter_chain(0.1)
    stages = [float(part.split("=")[1]) for part in chain.split(",")]
    assert len(stages) == 4
    assert all(stage == pytest.approx(stages[0]) for stage in stages)
    assert math.prod(stages) == pytest.approx(0.1)
    assert all(stage >= 0.5 for stage in stages)


def test_clear_cache_on_empty_cache_removes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path / "does-not-exist-yet")
    result = transcribe.clear_cache()
    assert result.videos_removed == 0
    assert result.bytes_freed == 0


def test_clear_cache_removes_every_video_and_reports_bytes_freed(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    video_a = "aaaaaaaaaaa"
    video_b = "bbbbbbbbbbb"
    _write_tone_wav(transcribe._source_audio_path(video_a), seconds=1.0)
    _write_tone_wav(transcribe._speed_audio_path(video_a, 50), seconds=2.0)
    _write_tone_wav(transcribe._source_audio_path(video_b), seconds=1.0)

    expected_bytes = sum(
        f.stat().st_size for f in tmp_path.rglob("*") if f.is_file()
    )
    assert expected_bytes > 0

    result = transcribe.clear_cache()

    assert result.videos_removed == 2
    assert result.bytes_freed == expected_bytes
    # Check existence directly rather than via _video_cache_dir(), which
    # would recreate the directory (mkdir(exist_ok=True)) as a side effect.
    assert not (tmp_path / video_a).exists()
    assert not (tmp_path / video_b).exists()
    # The cache root itself is left in place (individual video directories
    # are what get removed), ready for the next fetch to recreate a subdir.
    assert tmp_path.exists()


def test_clear_cache_is_safe_to_call_again_with_nothing_left(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "CACHE_ROOT", tmp_path)
    _write_tone_wav(transcribe._source_audio_path("ccccccccccc"), seconds=1.0)

    first = transcribe.clear_cache()
    second = transcribe.clear_cache()

    assert first.videos_removed == 1
    assert second.videos_removed == 0
    assert second.bytes_freed == 0


def test_cookies_file_path_is_none_when_env_var_unset(monkeypatch):
    monkeypatch.delenv(transcribe.YOUTUBE_COOKIES_FILE_ENV, raising=False)
    assert transcribe._cookies_file_path() is None


def test_cookies_file_path_is_none_when_configured_file_does_not_exist(tmp_path, monkeypatch):
    missing_path = tmp_path / "cookies.txt"
    monkeypatch.setenv(transcribe.YOUTUBE_COOKIES_FILE_ENV, str(missing_path))
    assert transcribe._cookies_file_path() is None


def test_cookies_file_path_returns_path_when_configured_file_exists(tmp_path, monkeypatch):
    cookies_path = tmp_path / "cookies.txt"
    cookies_path.write_text("# Netscape HTTP Cookie File\n")
    monkeypatch.setenv(transcribe.YOUTUBE_COOKIES_FILE_ENV, str(cookies_path))
    assert transcribe._cookies_file_path() == cookies_path


def test_build_ydl_opts_omits_cookiefile_when_not_configured(tmp_path):
    opts = transcribe._build_ydl_opts(tmp_path, cookies_file=None)
    assert "cookiefile" not in opts


def test_build_ydl_opts_includes_cookiefile_when_configured(tmp_path):
    cookies_path = tmp_path / "cookies.txt"
    cookies_path.write_text("# Netscape HTTP Cookie File\n")
    opts = transcribe._build_ydl_opts(tmp_path, cookies_file=cookies_path)
    assert opts["cookiefile"] == str(cookies_path)


def test_save_uploaded_cookies_rejects_empty_content(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", tmp_path / "uploaded_youtube_cookies.txt")
    with pytest.raises(transcribe.TranscribeError, match="empty"):
        transcribe.save_uploaded_cookies("   ")


def test_save_uploaded_cookies_rejects_content_without_youtube_domain(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", tmp_path / "uploaded_youtube_cookies.txt")
    with pytest.raises(transcribe.TranscribeError, match="doesn't look like"):
        transcribe.save_uploaded_cookies("# Netscape HTTP Cookie File\nexample.com\tTRUE\t/\tFALSE\t0\tfoo\tbar\n")


def test_save_uploaded_cookies_rejects_oversized_content(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", tmp_path / "uploaded_youtube_cookies.txt")
    oversized = "youtube.com\t" + ("x" * (transcribe.MAX_UPLOADED_COOKIES_BYTES + 1))
    with pytest.raises(transcribe.TranscribeError, match="too large"):
        transcribe.save_uploaded_cookies(oversized)


def test_save_uploaded_cookies_writes_valid_content_to_disk(tmp_path, monkeypatch):
    uploaded_path = tmp_path / "uploaded_youtube_cookies.txt"
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", uploaded_path)
    content = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n"

    transcribe.save_uploaded_cookies(content)

    assert uploaded_path.read_text(encoding="utf-8") == content


def test_cookies_file_path_falls_back_to_uploaded_file_when_env_var_unset(tmp_path, monkeypatch):
    uploaded_path = tmp_path / "uploaded_youtube_cookies.txt"
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", uploaded_path)
    monkeypatch.delenv(transcribe.YOUTUBE_COOKIES_FILE_ENV, raising=False)
    transcribe.save_uploaded_cookies("youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n")

    assert transcribe._cookies_file_path() == uploaded_path


def test_cookies_file_path_prefers_env_var_over_uploaded_file(tmp_path, monkeypatch):
    uploaded_path = tmp_path / "uploaded_youtube_cookies.txt"
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", uploaded_path)
    transcribe.save_uploaded_cookies("youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n")

    configured_path = tmp_path / "configured_cookies.txt"
    configured_path.write_text("# Netscape HTTP Cookie File\n")
    monkeypatch.setenv(transcribe.YOUTUBE_COOKIES_FILE_ENV, str(configured_path))

    assert transcribe._cookies_file_path() == configured_path


# A representative JSON cookie export (the shape Chrome's "Cookie-Editor"/
# "EditThisCookie" extensions and Chrome DevTools produce, also the shape
# Puppeteer/Playwright return from page.cookies()) — trimmed from a real
# user-reported export that yt-dlp couldn't read because it wasn't Netscape
# format.
_SAMPLE_JSON_COOKIE_EXPORT = """
[
  {"domain": ".youtube.com", "expirationDate": 1824838459.74928, "hostOnly": false,
   "httpOnly": false, "name": "PREF", "path": "/", "sameSite": "unspecified",
   "secure": true, "session": false, "storeId": "0", "value": "f6=40000000"},
  {"domain": ".youtube.com", "expirationDate": 1824771682.194392, "hostOnly": false,
   "httpOnly": true, "name": "__Secure-1PSID", "path": "/", "sameSite": "unspecified",
   "secure": true, "session": false, "storeId": "0", "value": "secretvalue123"},
  {"domain": ".youtube.com", "hostOnly": false, "httpOnly": true, "name": "YSC",
   "path": "/", "sameSite": "no_restriction", "secure": true, "session": true,
   "storeId": "0", "value": "VEe1kT3ObNk"},
  {"domain": ".doubleclick.net", "hostOnly": false, "httpOnly": false, "name": "IDE",
   "path": "/", "sameSite": "no_restriction", "secure": true, "session": false,
   "expirationDate": 1824771682.0, "storeId": "0", "value": "unrelated-ad-cookie"}
]
"""


def test_as_json_cookie_list_recognizes_a_json_cookie_array():
    parsed = transcribe._as_json_cookie_list(_SAMPLE_JSON_COOKIE_EXPORT)
    assert parsed is not None
    assert len(parsed) == 4


def test_as_json_cookie_list_returns_none_for_plain_netscape_text():
    assert transcribe._as_json_cookie_list("youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n") is None


def test_as_json_cookie_list_returns_none_for_unrelated_json():
    assert transcribe._as_json_cookie_list('{"foo": "bar"}') is None
    assert transcribe._as_json_cookie_list("[1, 2, 3]") is None


def test_json_cookies_to_netscape_converts_and_filters_to_youtube_only():
    cookies = transcribe._as_json_cookie_list(_SAMPLE_JSON_COOKIE_EXPORT)
    netscape = transcribe._json_cookies_to_netscape(cookies)

    assert netscape.startswith("# Netscape HTTP Cookie File")
    # The unrelated doubleclick.net cookie must not survive the conversion.
    assert "doubleclick" not in netscape
    assert "IDE" not in netscape
    # A non-HttpOnly cookie is written as a plain 7-field Netscape line.
    assert "\t.youtube.com\tTRUE\t/\tTRUE\t" in netscape or netscape.count(".youtube.com\tTRUE\t/\tTRUE\t") >= 1
    # An HttpOnly cookie gets the "#HttpOnly_" domain prefix real cookies.txt
    # files use, not a plain domain field.
    assert "#HttpOnly_.youtube.com" in netscape
    assert "__Secure-1PSID" in netscape
    # A session cookie (no expirationDate) is written with expiration "0",
    # meaning "expires at end of session" in this format, not "expired".
    assert "\tYSC\tVEe1kT3ObNk" in netscape
    for line in netscape.splitlines()[1:]:
        if not line.strip():
            continue
        fields = line.split("\t")
        assert len(fields) == 7


def test_save_uploaded_cookies_accepts_a_json_export(tmp_path, monkeypatch):
    uploaded_path = tmp_path / "uploaded_youtube_cookies.txt"
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", uploaded_path)

    transcribe.save_uploaded_cookies(_SAMPLE_JSON_COOKIE_EXPORT)

    saved = uploaded_path.read_text(encoding="utf-8")
    assert saved.startswith("# Netscape HTTP Cookie File")
    assert "__Secure-1PSID" in saved
    assert "doubleclick" not in saved


def test_save_uploaded_cookies_rejects_json_with_no_youtube_cookies(tmp_path, monkeypatch):
    uploaded_path = tmp_path / "uploaded_youtube_cookies.txt"
    monkeypatch.setattr(transcribe, "UPLOADED_COOKIES_PATH", uploaded_path)
    only_ad_cookies = """[{"domain": ".doubleclick.net", "name": "IDE", "value": "x", "path": "/"}]"""

    with pytest.raises(transcribe.TranscribeError, match="doesn't look like"):
        transcribe.save_uploaded_cookies(only_ad_cookies)


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
