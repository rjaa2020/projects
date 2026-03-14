from __future__ import annotations

import random
import re
from dataclasses import dataclass

from .theory import (
    CHORD_FORMULAS,
    DEFAULT_CHORD_TYPES,
    PRACTICE_ROOTS,
    ChordPrompt,
    build_seventh_chord,
    split_chord_symbol,
)


@dataclass(frozen=True)
class QuizSettings:
    rounds: int = 10
    chord_types: tuple[str, ...] = DEFAULT_CHORD_TYPES
    include_keys: tuple[str, ...] | None = None
    exclude_keys: tuple[str, ...] = ()
    include_modes: tuple[str, ...] | None = None
    exclude_modes: tuple[str, ...] = ()


@dataclass(frozen=True)
class RoundResult:
    prompt: ChordPrompt
    guess: tuple[str, ...]
    is_correct: bool


class QuizSession:
    def __init__(self, settings: QuizSettings, rng: random.Random | None = None) -> None:
        self.settings = settings
        self.rng = rng or random.Random()

        base_modes = settings.include_modes if settings.include_modes is not None else settings.chord_types
        self._modes = _resolve_allowed_items(
            all_items=DEFAULT_CHORD_TYPES,
            include_items=base_modes,
            exclude_items=settings.exclude_modes,
            label="modes",
        )
        self._roots = _resolve_allowed_items(
            all_items=PRACTICE_ROOTS,
            include_items=settings.include_keys,
            exclude_items=settings.exclude_keys,
            label="keys",
        )

    def generate_prompt(self, scores: dict[tuple[str, str], int] | None = None) -> ChordPrompt:
        if not scores:
            root = self.rng.choice(self._roots)
            quality = self.rng.choice(self._modes)
            return build_seventh_chord(root, quality)

        combinations: list[tuple[str, str]] = [(root, quality) for root in self._roots for quality in self._modes]
        key_totals = _aggregate_key_scores(scores, self._roots, self._modes)
        quality_totals = _aggregate_quality_scores(scores, self._roots, self._modes)

        weights = [
            _selection_weight(scores.get((root, quality), 0))
            * _underexplored_weight(key_totals[root])
            * _underexplored_weight(quality_totals[quality])
            for root, quality in combinations
        ]
        root, quality = self.rng.choices(combinations, weights=weights, k=1)[0]
        return build_seventh_chord(root, quality)

    def generate_prompt_from_symbols(
        self,
        chord_symbols: tuple[str, ...],
        scores: dict[tuple[str, str], int] | None = None,
    ) -> ChordPrompt:
        parsed: list[tuple[str, str]] = []
        for symbol in chord_symbols:
            try:
                parsed.append(split_chord_symbol(symbol))
            except ValueError:
                continue

        if not parsed:
            raise ValueError("No supported chord symbols available in chart")

        if not scores:
            root, quality = self.rng.choice(parsed)
            return build_seventh_chord(root, quality)

        weights = [_selection_weight(scores.get((root, quality), 0)) for root, quality in parsed]
        root, quality = self.rng.choices(parsed, weights=weights, k=1)[0]
        return build_seventh_chord(root, quality)

    def check_answer(self, prompt: ChordPrompt, raw_answer: str) -> RoundResult:
        tokens = re.split(r"[\s,]+", raw_answer.strip())
        guess = tuple(_normalize_note_token(token) for token in tokens if token.strip())
        is_correct = _is_enharmonically_correct(prompt.notes, guess)
        return RoundResult(prompt=prompt, guess=guess, is_correct=is_correct)


def _normalize_note_token(note: str) -> str:
    cleaned = (
        note.strip()
        .replace("♯", "#")
        .replace("♭", "b")
        .replace("𝄪", "x")
        .replace("𝄫", "bb")
    )
    if not cleaned:
        return ""
    return cleaned[0].upper() + cleaned[1:]


_NATURAL_NOTE_PITCH = {
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
}


def _note_to_pitch_class(note: str) -> int | None:
    normalized = _normalize_note_token(note)
    match = re.fullmatch(r"([A-G])([#bxBX]*)", normalized)
    if not match:
        return None

    base_note = match.group(1)
    accidental_text = match.group(2) or ""
    base_pitch = _NATURAL_NOTE_PITCH.get(base_note)
    if base_pitch is None:
        return None

    delta = 0
    for accidental in accidental_text:
        if accidental == "#":
            delta += 1
        elif accidental in {"b", "B"}:
            delta -= 1
        elif accidental in {"x", "X"}:
            delta += 2
        else:
            return None

    return (base_pitch + delta) % 12


def _is_enharmonically_correct(correct_notes: tuple[str, ...], guess: tuple[str, ...]) -> bool:
    if len(correct_notes) != len(guess):
        return False

    correct_pcs = []
    for note in correct_notes:
        pitch_class = _note_to_pitch_class(note)
        if pitch_class is None:
            return False
        correct_pcs.append(pitch_class)

    guess_pcs = []
    for note in guess:
        pitch_class = _note_to_pitch_class(note)
        if pitch_class is None:
            return False
        guess_pcs.append(pitch_class)

    if len(correct_pcs) != len(guess_pcs):
        return False

    return sorted(guess_pcs) == sorted(correct_pcs)


def update_combo_scores(
    scores: dict[tuple[str, str], int],
    prompt: ChordPrompt,
    is_correct: bool,
) -> dict[tuple[str, str], int]:
    root, quality = split_chord_symbol(prompt.symbol)
    updated = dict(scores)
    delta = 1 if is_correct else -1
    updated[(root, quality)] = updated.get((root, quality), 0) + delta
    return updated


def update_combo_attempt_times(
    attempt_times: dict[tuple[str, str], list[float]],
    prompt: ChordPrompt,
    answer_time_seconds: float | None,
) -> dict[tuple[str, str], list[float]]:
    if answer_time_seconds is None:
        return dict(attempt_times)

    try:
        answer_time = float(answer_time_seconds)
    except (TypeError, ValueError):
        return dict(attempt_times)

    if answer_time < 0:
        return dict(attempt_times)

    root, quality = split_chord_symbol(prompt.symbol)
    updated = {combo: list(times) for combo, times in attempt_times.items()}
    key = (root, quality)
    updated.setdefault(key, []).append(answer_time)
    return updated


def _selection_weight(score: int) -> float:
    if score < 0:
        return 1.0 + (abs(score) * 2.0)
    if score == 0:
        return 1.0
    return max(0.05, 1.0 / (1.0 + score))


def _underexplored_weight(aggregate_score: int) -> float:
    if aggregate_score <= 1:
        return 2.0
    return 1.0 / (1.0 + (aggregate_score - 1) * 0.4)


def _aggregate_key_scores(
    scores: dict[tuple[str, str], int],
    roots: tuple[str, ...],
    modes: tuple[str, ...],
) -> dict[str, int]:
    return {root: sum(scores.get((root, mode), 0) for mode in modes) for root in roots}


def _aggregate_quality_scores(
    scores: dict[tuple[str, str], int],
    roots: tuple[str, ...],
    modes: tuple[str, ...],
) -> dict[str, int]:
    return {mode: sum(scores.get((root, mode), 0) for root in roots) for mode in modes}


def _resolve_allowed_items(
    *,
    all_items: tuple[str, ...],
    include_items: tuple[str, ...] | None,
    exclude_items: tuple[str, ...],
    label: str,
) -> tuple[str, ...]:
    include_values = all_items if include_items is None else include_items

    unknown_include = [item for item in include_values if item not in all_items]
    if unknown_include:
        allowed = ", ".join(all_items)
        invalid = ", ".join(unknown_include)
        raise ValueError(f"Unsupported {label}: {invalid}. Allowed: {allowed}")

    unknown_exclude = [item for item in exclude_items if item not in all_items]
    if unknown_exclude:
        allowed = ", ".join(all_items)
        invalid = ", ".join(unknown_exclude)
        raise ValueError(f"Unsupported {label}: {invalid}. Allowed: {allowed}")

    include_set = set(include_values)
    exclude_set = set(exclude_items)
    allowed_items = tuple(item for item in all_items if item in include_set and item not in exclude_set)

    if not allowed_items:
        raise ValueError(f"No available {label} after include/exclude filters")

    return allowed_items
