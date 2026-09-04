import re

import pytest

from woodshed.quiz import QuizSession, QuizSettings


def test_include_keys_and_modes_filters_prompt_space():
    session = QuizSession(
        QuizSettings(
            rounds=1,
            include_keys=("C", "Db"),
            include_modes=("maj7",),
        )
    )

    for _ in range(20):
        prompt = session.generate_prompt()
        root = re.match(r"^[A-G](?:b|#)?", prompt.symbol)
        assert root is not None
        assert root.group(0) in {"C", "Db"}
        assert prompt.symbol.endswith("maj7")


def test_exclude_modes_filters_prompt_space():
    session = QuizSession(
        QuizSettings(
            rounds=1,
            include_modes=("maj7", "7", "min7"),
            exclude_modes=("7", "min7"),
        )
    )

    for _ in range(10):
        prompt = session.generate_prompt()
        assert prompt.symbol.endswith("maj7")


def test_no_available_keys_after_filters_raises():
    with pytest.raises(ValueError, match="No available keys"):
        QuizSession(
            QuizSettings(
                rounds=1,
                include_keys=("C",),
                exclude_keys=("C",),
            )
        )
