from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .quiz import QuizSession, QuizSettings, update_combo_attempt_times, update_combo_scores
from .theory import DEFAULT_CHORD_TYPES, PRACTICE_ROOTS, ChordPrompt, split_chord_symbol

app = FastAPI(title="Woodshed API", version="3.1.0")


class PromptRequest(BaseModel):
    chord_types: list[str] = Field(default_factory=list)
    include_keys: list[str] = Field(default_factory=list)
    exclude_keys: list[str] = Field(default_factory=list)
    include_chord_qualities: list[str] = Field(default_factory=list)
    exclude_chord_qualities: list[str] = Field(default_factory=list)
    include_modes: list[str] = Field(default_factory=list)
    exclude_modes: list[str] = Field(default_factory=list)
    scores: dict[str, int] = Field(default_factory=dict)


class PromptResponse(BaseModel):
    symbol: str
    notes: list[str]


class OptionsResponse(BaseModel):
    keys: list[str]
    chord_qualities: list[str]


class CheckRequest(BaseModel):
    symbol: str
    notes: list[str] = Field(min_length=4, max_length=4)
    answer: str
    scores: dict[str, int] = Field(default_factory=dict)
    attempt_times: dict[str, dict[str, list[float]]] = Field(default_factory=dict)
    answer_time_seconds: float | None = None


class CheckResponse(BaseModel):
    is_correct: bool
    guess: list[str]
    symbol: str
    notes: list[str]
    root: str
    chord_quality: str
    updated_scores: dict[str, int]
    updated_attempt_times: dict[str, dict[str, list[float]]]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/options", response_model=OptionsResponse)
def options() -> OptionsResponse:
    return OptionsResponse(keys=list(PRACTICE_ROOTS), chord_qualities=list(DEFAULT_CHORD_TYPES))


@app.post("/prompt", response_model=PromptResponse)
def generate_prompt(request: PromptRequest) -> PromptResponse:
    include_qualities = (
        request.include_chord_qualities
        or request.include_modes
        or request.chord_types
        or list(DEFAULT_CHORD_TYPES)
    )
    exclude_qualities = request.exclude_chord_qualities or request.exclude_modes
    settings = QuizSettings(
        rounds=1,
        chord_types=tuple(request.chord_types) if request.chord_types else DEFAULT_CHORD_TYPES,
        include_keys=tuple(request.include_keys) if request.include_keys else None,
        exclude_keys=tuple(request.exclude_keys),
        include_modes=tuple(include_qualities),
        exclude_modes=tuple(exclude_qualities),
    )
    session = QuizSession(settings)
    prompt = session.generate_prompt(scores=_deserialize_scores(request.scores))
    return PromptResponse(symbol=prompt.symbol, notes=list(prompt.notes))


@app.post("/check", response_model=CheckResponse)
def check_answer(request: CheckRequest) -> CheckResponse:
    session = QuizSession(QuizSettings(rounds=1))
    prompt = ChordPrompt(symbol=request.symbol, notes=tuple(request.notes))  # type: ignore
    result = session.check_answer(prompt, request.answer)
    root, chord_quality = split_chord_symbol(result.prompt.symbol)
    updated_scores = update_combo_scores(_deserialize_scores(request.scores), result.prompt, result.is_correct)
    updated_attempt_times = update_combo_attempt_times(
        _deserialize_attempt_times(request.attempt_times),
        result.prompt,
        request.answer_time_seconds,
    )

    return CheckResponse(
        is_correct=result.is_correct,
        guess=list(result.guess),
        symbol=result.prompt.symbol,
        notes=list(result.prompt.notes),
        root=root,
        chord_quality=chord_quality,
        updated_scores=_serialize_scores(updated_scores),
        updated_attempt_times=_serialize_attempt_times(updated_attempt_times),
    )


def _serialize_scores(scores: dict[tuple[str, str], int]) -> dict[str, int]:
    return {f"{root}|{quality}": score for (root, quality), score in scores.items()}


def _deserialize_scores(raw_scores: dict[str, int]) -> dict[tuple[str, str], int]:
    parsed: dict[tuple[str, str], int] = {}
    for key, value in raw_scores.items():
        if "|" not in key:
            continue
        root, quality = key.split("|", 1)
        parsed[(root, quality)] = int(value)
    return parsed


def _serialize_attempt_times(
    attempt_times: dict[tuple[str, str], list[float]],
) -> dict[str, dict[str, list[float]]]:
    serialized: dict[str, dict[str, list[float]]] = {}
    for (root, quality), times in attempt_times.items():
        serialized.setdefault(root, {})[quality] = [float(value) for value in times]
    return serialized


def _deserialize_attempt_times(
    raw_attempt_times: dict[str, dict[str, list[float]]],
) -> dict[tuple[str, str], list[float]]:
    parsed: dict[tuple[str, str], list[float]] = {}
    for root, by_quality in raw_attempt_times.items():
        if not isinstance(by_quality, dict):
            continue
        for quality, times in by_quality.items():
            if not isinstance(times, list):
                continue
            key = (str(root), str(quality))
            numeric_times: list[float] = []
            for value in times:
                try:
                    numeric_times.append(float(value))
                except (TypeError, ValueError):
                    continue
            parsed[key] = numeric_times
    return parsed


def main() -> None:
    import uvicorn

    uvicorn.run("woodshed.api:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
