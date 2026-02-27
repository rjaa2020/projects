from __future__ import annotations

import random
import re
from dataclasses import dataclass

from .theory import CHORD_FORMULAS, DEFAULT_CHORD_TYPES, PRACTICE_ROOTS, ChordPrompt, build_seventh_chord


@dataclass(frozen=True)
class QuizSettings:
    rounds: int = 10
    chord_types: tuple[str, ...] = DEFAULT_CHORD_TYPES


@dataclass(frozen=True)
class RoundResult:
    prompt: ChordPrompt
    guess: tuple[str, ...]
    is_correct: bool


class QuizSession:
    def __init__(self, settings: QuizSettings, rng: random.Random | None = None) -> None:
        self.settings = settings
        self.rng = rng or random.Random()
        invalid_types = [quality for quality in settings.chord_types if quality not in CHORD_FORMULAS]
        if invalid_types:
            allowed = ", ".join(sorted(CHORD_FORMULAS))
            invalid = ", ".join(invalid_types)
            raise ValueError(f"Unsupported chord types: {invalid}. Allowed: {allowed}")

        self._roots = PRACTICE_ROOTS

    def generate_prompt(self) -> ChordPrompt:
        root = self.rng.choice(self._roots)
        quality = self.rng.choice(self.settings.chord_types)
        return build_seventh_chord(root, quality)

    def check_answer(self, prompt: ChordPrompt, raw_answer: str) -> RoundResult:
        tokens = re.split(r"[\s,]+", raw_answer.strip())
        guess = tuple(_normalize_note_token(token) for token in tokens if token.strip())
        is_correct = guess == prompt.notes
        return RoundResult(prompt=prompt, guess=guess, is_correct=is_correct)


def _normalize_note_token(note: str) -> str:
    cleaned = note.strip().replace("♯", "#").replace("♭", "b")
    if not cleaned:
        return ""
    return cleaned[0].upper() + cleaned[1:]
