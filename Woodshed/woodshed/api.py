from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .quiz import QuizSession, QuizSettings
from .theory import DEFAULT_CHORD_TYPES, ChordPrompt

app = FastAPI(title="Woodshed API", version="0.1.0")


class PromptRequest(BaseModel):
    chord_types: list[str] = Field(default_factory=lambda: list(DEFAULT_CHORD_TYPES))


class PromptResponse(BaseModel):
    symbol: str
    notes: list[str]


class CheckRequest(BaseModel):
    symbol: str
    notes: list[str] = Field(min_length=4, max_length=4)
    answer: str


class CheckResponse(BaseModel):
    is_correct: bool
    guess: list[str]
    symbol: str
    notes: list[str]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/prompt", response_model=PromptResponse)
def generate_prompt(request: PromptRequest) -> PromptResponse:
    session = QuizSession(QuizSettings(rounds=1, chord_types=tuple(request.chord_types)))
    prompt = session.generate_prompt()
    return PromptResponse(symbol=prompt.symbol, notes=list(prompt.notes))


@app.post("/check", response_model=CheckResponse)
def check_answer(request: CheckRequest) -> CheckResponse:
    session = QuizSession(QuizSettings(rounds=1))
    prompt = ChordPrompt(symbol=request.symbol, notes=tuple(request.notes))
    result = session.check_answer(prompt, request.answer)

    return CheckResponse(
        is_correct=result.is_correct,
        guess=list(result.guess),
        symbol=result.prompt.symbol,
        notes=list(result.prompt.notes),
    )


def main() -> None:
    import uvicorn

    uvicorn.run("woodshed.api:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
