from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from urllib.parse import unquote
from urllib.request import urlopen

from .theory import PRACTICE_ROOTS

JAZZ_1460_INDIVIDUAL_URL = "https://forums.irealpro.com/threads/jazz-1460-standards-individual-songs.27435/"
_CHORD_PREFIX = "1r34LbKcu7"
_CACHE_TTL_SECONDS = 60 * 60 * 24
_PRACTICE_ROOT_SET = set(PRACTICE_ROOTS)
_ROOT_TO_INDEX = {root: index for index, root in enumerate(PRACTICE_ROOTS)}
_INSTRUMENT_TRANSPOSE = {
    "C": 0,
    "Bb": 2,
    "Eb": 9,
}


@dataclass(frozen=True)
class IRealSongSummary:
    title: str
    uri: str


@dataclass(frozen=True)
class IRealChart:
    title: str
    composer: str
    style: str
    key: str
    quiz_chords: tuple[str, ...]


def transpose_quiz_chords_for_instrument(chords: tuple[str, ...], instrument_key: str) -> tuple[str, ...]:
    semitones = _INSTRUMENT_TRANSPOSE.get(str(instrument_key or "").strip(), 0)
    if semitones == 0:
        return chords

    transposed: list[str] = []
    for symbol in chords:
        match = re.match(r"^([A-G][#b]?)(.*)$", symbol)
        if match is None:
            continue
        root = _normalize_root_for_practice(match.group(1))
        quality = match.group(2)
        root_index = _ROOT_TO_INDEX[root]
        shifted_root = PRACTICE_ROOTS[(root_index + semitones) % 12]
        transposed.append(f"{shifted_root}{quality}")
    return tuple(transposed)


def get_jazz1460_catalog() -> tuple[IRealSongSummary, ...]:
    cache_file = _cache_root() / "jazz1460_catalog.json"
    cached = _read_json(cache_file)
    if cached and _is_cache_fresh(cached):
        songs = tuple(
            IRealSongSummary(title=item["title"], uri=item["uri"])
            for item in cached.get("songs", [])
            if isinstance(item, dict) and item.get("title") and item.get("uri")
        )
        if songs:
            return songs

    html = _fetch_text(JAZZ_1460_INDIVIDUAL_URL)
    songs = _extract_ireal_anchors(html)
    payload = {
        "saved_at": time.time(),
        "songs": [{"title": song.title, "uri": song.uri} for song in songs],
    }
    _write_json(cache_file, payload)
    return songs


def get_or_fetch_jazz1460_chart(song_title: str) -> IRealChart:
    normalized_title = song_title.strip()
    if not normalized_title:
        raise ValueError("Song title cannot be empty")

    cache_file = _cache_root() / "jazz1460_songs" / f"{_slugify(normalized_title)}.json"
    cached = _read_json(cache_file)
    if cached and str(cached.get("title", "")).casefold() == normalized_title.casefold():
        return IRealChart(
            title=str(cached.get("title", "")).strip(),
            composer=str(cached.get("composer", "")).strip(),
            style=str(cached.get("style", "")).strip(),
            key=str(cached.get("key", "")).strip(),
            quiz_chords=tuple(str(item) for item in cached.get("quiz_chords", []) if isinstance(item, str)),
        )

    catalog = get_jazz1460_catalog()
    lookup = {song.title.casefold(): song for song in catalog}
    song = lookup.get(normalized_title.casefold())
    if song is None:
        raise ValueError(f"Song not found in Jazz 1460 catalog: {song_title}")

    title, composer, style, key, measures = _parse_irealb_song(song.uri)
    quiz_chords = _extract_supported_quiz_chords(measures)
    if not quiz_chords:
        raise ValueError(f"No supported seventh chords were found in: {title}")

    chart = IRealChart(
        title=title,
        composer=composer,
        style=style,
        key=key,
        quiz_chords=quiz_chords,
    )
    _write_json(
        cache_file,
        {
            "saved_at": time.time(),
            "title": chart.title,
            "composer": chart.composer,
            "style": chart.style,
            "key": chart.key,
            "quiz_chords": list(chart.quiz_chords),
        },
    )
    return chart


def _cache_root() -> Path:
    return Path(__file__).resolve().parent.parent / ".cache" / "ireal"


def _is_cache_fresh(payload: dict[str, object]) -> bool:
    saved_at = payload.get("saved_at")
    try:
        saved_at_float = float(saved_at)
    except (TypeError, ValueError):
        return False
    return (time.time() - saved_at_float) < _CACHE_TTL_SECONDS


def _read_json(path: Path) -> dict[str, object] | None:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    return json.loads(raw)


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _fetch_text(url: str) -> str:
    with urlopen(url, timeout=20) as response:  # nosec B310 - fixed trusted https URL
        return response.read().decode("utf-8", errors="replace")


def _extract_ireal_anchors(html: str) -> tuple[IRealSongSummary, ...]:
    pattern = re.compile(r'<a[^>]+href="(irealb://[^"]+)"[^>]*>([^<]+)</a>', re.IGNORECASE)
    songs: list[IRealSongSummary] = []
    seen: set[str] = set()
    for match in pattern.finditer(html):
        uri = unescape(match.group(1).strip())
        title = unescape(match.group(2).strip())
        if not title:
            continue
        key = title.casefold()
        if key in seen:
            continue
        seen.add(key)
        songs.append(IRealSongSummary(title=title, uri=uri))

    songs.sort(key=lambda item: item.title.casefold())
    return tuple(songs)


def _parse_irealb_song(uri: str) -> tuple[str, str, str, str, tuple[str, ...]]:
    decoded = unquote(unescape(uri.strip()))
    if not decoded.startswith("irealb://"):
        raise ValueError("Expected an irealb:// URI")

    payload = decoded[len("irealb://") :]
    tune = payload.split("===", 1)[0]
    parts = re.split(r"=+", tune)
    if len(parts) < 5:
        raise ValueError("Malformed iReal payload")

    title = parts[0].strip()
    composer = parts[1].strip()
    style = parts[2].strip()
    key = parts[3].strip()

    offset = 0
    if not parts[4].startswith(_CHORD_PREFIX):
        offset = 1
    chord_part_index = 4 + offset
    if chord_part_index >= len(parts) or _CHORD_PREFIX not in parts[chord_part_index]:
        raise ValueError("Unable to locate iReal chord payload")

    scrambled = parts[chord_part_index].split(_CHORD_PREFIX, 1)[1]
    chord_string = _cleanup_chord_string(_unscramble_chord_string(scrambled))
    measures = _get_measures(chord_string)
    return title, composer, style, key, tuple(measures)


def _unscramble_chord_string(scrambled: str) -> str:
    out = ""
    text = scrambled
    while len(text) > 50:
        block = text[:50]
        text = text[50:]
        if len(text) < 2:
            out += block
        else:
            out += _obfusc50(block)
    out += text
    return out


def _obfusc50(block: str) -> str:
    chars = list(block)
    for i in range(5):
        chars[i], chars[49 - i] = block[49 - i], block[i]
    for i in range(10, 24):
        chars[i], chars[49 - i] = block[49 - i], block[i]
    return "".join(chars)


def _cleanup_chord_string(chord_string: str) -> str:
    cleaned = re.sub(r"LZ|K", "|", chord_string)
    cleaned = re.sub(r"cl", "x", cleaned)
    cleaned = re.sub(r"\*\s*\*", "", cleaned)
    cleaned = re.sub(r"Y+", "", cleaned)
    cleaned = re.sub(r"XyQ|,", " ", cleaned)
    cleaned = re.sub(r"\|\s*\|", "|", cleaned)
    cleaned = re.sub(r"Z", "", cleaned)
    cleaned = re.sub(r"\|\s+", "|", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.rstrip()


def _remove_annotations(chord_string: str) -> str:
    stripped = re.sub(r"[\[\]]", "|", chord_string)
    stripped = re.sub(r"\|\s*\|", "|", stripped)
    stripped = re.sub(r"<.*?>", "", stripped)
    stripped = re.sub(r"\([^)]*\)", "", stripped)
    stripped = re.sub(r"[lf]", "", stripped)
    stripped = re.sub(r"(?<!su)s(?!us)", "", stripped)
    stripped = re.sub(r"\*\w", "", stripped)
    stripped = re.sub(r"T\d+", "", stripped)
    return stripped


def _remove_markers(chord_string: str) -> str:
    return re.sub(r"U|S|Q|N\d", "", chord_string)


def _fill_long_repeats(chord_string: str) -> str:
    repeat_match = re.search(r"{(.+?)}", chord_string)
    if repeat_match is None:
        return chord_string

    number_match = re.search(r"N(\d)", repeat_match.group(1))
    if number_match is not None:
        first_repeat = re.sub(r"N\d", "", repeat_match.group(1))
        new_string = chord_string[: repeat_match.start()] + "|" + first_repeat + chord_string[repeat_match.end() :]
        repeat_section = re.search(r"([^N]+)N\d", repeat_match.group(1))
        if repeat_section is None:
            return new_string
        repeat = _remove_markers(repeat_section.group(1))
        while re.search(r"\|\s*N(\d)", new_string) is not None:
            new_string = re.sub(r"\|\s*N(\d)", "|" + repeat, new_string, count=1)
        return new_string

    new_string = (
        chord_string[: repeat_match.start()]
        + "|"
        + repeat_match.group(1)
        + " |"
        + _remove_markers(repeat_match.group(1))
        + chord_string[repeat_match.end() :]
        + "|"
    )
    return _fill_long_repeats(new_string)


def _fill_codas(chord_string: str) -> str:
    q_count = chord_string.count("Q")
    if q_count == 1:
        return chord_string.replace("Q", "")
    if q_count != 2:
        return chord_string

    q_positions = [idx for idx, char in enumerate(chord_string) if char == "Q"]
    q1, q2 = q_positions[0], q_positions[1]
    segno = chord_string.find("S")
    if segno == -1:
        segno = 0
    coda = chord_string[q2 + 1 :]
    repeat = chord_string[segno + 1 : q1]
    merged = chord_string[:q2] + repeat + " |" + coda
    return re.sub(r"[QS]", "", merged)


def _fill_single_double_repeats(measures: list[str]) -> list[str]:
    for i in range(1, len(measures)):
        if measures[i] == "x":
            measures[i] = _remove_markers(measures[i - 1])
    for i in range(2, len(measures) - 1):
        if measures[i] == "r":
            measures[i] = _remove_markers(measures[i - 2])
            measures[i + 1] = _remove_markers(measures[i - 1])
    return measures


def _fill_slashes(measures: list[str]) -> list[str]:
    chord_regex = re.compile(r"(?<!/)([A-Gn][^A-G/]*(?:/[A-G][#b]?)?)")
    for i in range(1, len(measures)):
        while "p" in measures[i]:
            slash_index = measures[i].find("p")
            if slash_index == 0:
                previous = chord_regex.findall(measures[i - 1])[-1]
                measures[i] = previous + measures[i][1:]
                measures[i] = re.sub(r"^(p+)", previous, measures[i])
            else:
                previous = chord_regex.findall(measures[i][:slash_index])[-1]
                measures[i] = measures[i][:slash_index] + previous + measures[i][slash_index + 1 :]
    return measures


def _get_measures(chord_string: str) -> list[str]:
    normalized = _cleanup_chord_string(chord_string)
    normalized = _remove_annotations(normalized)
    normalized = _fill_long_repeats(normalized)
    normalized = _fill_codas(normalized)
    measures = re.split(r"\||LZ|K|Z|{|}|\[|\]", normalized)
    measures = [item.replace(" ", "") for item in measures if item.strip()]
    measures = _fill_single_double_repeats(measures)
    return _fill_slashes(measures)


def _extract_supported_quiz_chords(measures: tuple[str, ...]) -> tuple[str, ...]:
    # Tokenize at each root note, preserving accidental and suffix text.
    chord_regex = re.compile(r"(?<!/)([A-G][#b]?[^A-G/]*)")
    results: list[str] = []
    seen: set[str] = set()
    for measure in measures:
        for token in chord_regex.findall(measure):
            normalized = _normalize_quiz_chord_token(token)
            if normalized is None or normalized in seen:
                continue
            seen.add(normalized)
            results.append(normalized)
    return tuple(results)


def _normalize_quiz_chord_token(token: str) -> str | None:
    compact = token.strip().replace(" ", "")
    if not compact:
        return None

    root_match = re.match(r"^([A-G])([#b]?)(.*)$", compact)
    if root_match is None:
        return None

    root = _normalize_root_for_practice(root_match.group(1) + root_match.group(2))
    quality_text = root_match.group(3)
    quality = _map_ireal_quality(quality_text)
    if quality is None:
        return None
    return f"{root}{quality}"


def _normalize_root_for_practice(root: str) -> str:
    normalized = root.strip()
    enharmonic = {
        "B#": "C",
        "C#": "Db",
        "D#": "Eb",
        "E#": "F",
        "F#": "Gb",
        "G#": "Ab",
        "A#": "Bb",
        "Cb": "B",
        "Fb": "E",
    }
    root_name = enharmonic.get(normalized, normalized)
    if root_name not in _PRACTICE_ROOT_SET:
        raise ValueError(f"Unsupported chart root: {root}")
    return root_name


def _map_ireal_quality(quality_text: str) -> str | None:
    q = quality_text or ""
    if "7" not in q:
        return None

    if q.startswith("h") or "h7" in q or "-7b5" in q:
        return "m7b5"
    if q.startswith("o"):
        return "dim7"
    if q.startswith("-"):
        return "min7"
    if q.startswith("^"):
        return "maj7"
    if q.startswith("7") or "7" in q:
        return "7"
    return None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "song"