from __future__ import annotations

from dataclasses import dataclass

# Chromatic spellings with enharmonic preference presets.
_SHARP_SCALE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT_SCALE = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

ROOT_INDEX = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "Fb": 4,
    "F": 5,
    "E#": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}

CHORD_FORMULAS = {
    "maj7": [0, 4, 7, 11],
    "7": [0, 4, 7, 10],
    "min7": [0, 3, 7, 10],
    "m7b5": [0, 3, 6, 10],
    "dim7": [0, 3, 6, 9],
}

_QUALITY_ALIASES: dict[str, str] = {
    "^": "maj7",
    "^7": "maj7",
    "△": "maj7",
    "△7": "maj7",
    "Δ": "maj7",
    "Δ7": "maj7",
    "maj": "maj7",
    "Maj": "maj7",
    "MAJ": "maj7",
    "maj7": "maj7",
    "Maj7": "maj7",
    "MAJ7": "maj7",
    "M": "maj7",
    "M7": "maj7",
    "M9": "maj7",
    "m7": "min7",
    "m": "min7",
    "-7": "min7",
    "-": "min7",
    "min": "min7",
    "min7": "min7",
    "ø7": "m7b5",
    "ø": "m7b5",
    "h7": "m7b5",
    "h": "m7b5",
    "o7": "dim7",
    "o": "dim7",
    "°7": "dim7",
    "°": "dim7",
    "9": "7",
    "maj9": "maj7",
    "Maj9": "maj7",
    "MAJ9": "maj7",
    "min9": "min7",
    "m9": "min7",
    "-9": "min7",
    "m9b5": "m7b5",
    "dim9": "dim7",
    "o9": "dim7",
}

DEFAULT_CHORD_TYPES = tuple(CHORD_FORMULAS.keys())
PRACTICE_ROOTS = (
    "C",
    "Db",
    "D",
    "Eb",
    "E",
    "F",
    "Gb",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
)

_FLAT_ROOTS = {"Db", "Eb", "Gb", "Ab", "Bb"}


@dataclass(frozen=True)
class ChordPrompt:
    symbol: str
    notes: tuple[str, str, str, str]


def _normalize_root(root: str) -> str:
    cleaned = root.strip().replace("♯", "#").replace("♭", "b")
    if not cleaned:
        raise ValueError("Root cannot be empty.")

    letter = cleaned[0].upper()
    accidental = cleaned[1:] if len(cleaned) > 1 else ""
    candidate = f"{letter}{accidental}"

    if candidate not in ROOT_INDEX:
        raise ValueError(f"Unsupported root note: {root}")
    return candidate


def _choose_scale(root: str) -> list[str]:
    return _FLAT_SCALE if root in _FLAT_ROOTS or "b" in root else _SHARP_SCALE


def build_seventh_chord(root: str, quality: str) -> ChordPrompt:
    normalized_root = _normalize_root(root)
    if quality not in CHORD_FORMULAS:
        allowed = ", ".join(sorted(CHORD_FORMULAS))
        raise ValueError(f"Unsupported quality '{quality}'. Choose one of: {allowed}")

    scale = _choose_scale(normalized_root)
    root_idx = ROOT_INDEX[normalized_root]
    semitone_offsets = CHORD_FORMULAS[quality]
    notes = tuple(scale[(root_idx + offset) % 12] for offset in semitone_offsets)
    symbol = f"{normalized_root}{quality}"
    return ChordPrompt(symbol=symbol, notes=notes) # type: ignore


def split_chord_symbol(symbol: str) -> tuple[str, str]:
    clean_symbol = symbol.strip()
    if not clean_symbol:
        raise ValueError("Chord symbol cannot be empty")

    for root in sorted(PRACTICE_ROOTS, key=len, reverse=True):
        if clean_symbol.startswith(root):
            quality = clean_symbol[len(root):]
            if quality in CHORD_FORMULAS:
                return root, quality
            aliased_quality = _QUALITY_ALIASES.get(quality)
            if aliased_quality is not None:
                return root, aliased_quality

    allowed = ", ".join(f"{root}{quality}" for root in PRACTICE_ROOTS[:3] for quality in DEFAULT_CHORD_TYPES[:2])
    raise ValueError(f"Unsupported chord symbol '{symbol}'. Example symbols: {allowed}")
