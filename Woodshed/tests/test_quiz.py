import pytest

from woodshed.quiz import QuizSession, QuizSettings
from woodshed.quiz import update_combo_scores
from woodshed.theory import build_seventh_chord


def test_check_answer_accepts_spaces_or_commas():
    session = QuizSession(QuizSettings(rounds=1, chord_types=("maj7",)))
    prompt = build_seventh_chord("C", "maj7")

    assert session.check_answer(prompt, "C E G B").is_correct is True
    assert session.check_answer(prompt, "C,E,G,B").is_correct is True


def test_check_answer_accepts_enharmonics():
    session = QuizSession(QuizSettings(rounds=1, chord_types=("maj7",)))
    prompt = build_seventh_chord("Db", "maj7")

    assert session.check_answer(prompt, "C# F G# C").is_correct is True


def test_check_answer_requires_correct_order():
    session = QuizSession(QuizSettings(rounds=1, chord_types=("maj7",)))
    prompt = build_seventh_chord("C", "maj7")

    assert session.check_answer(prompt, "E C G B").is_correct is False


def test_invalid_chord_type_is_rejected():
    try:
        QuizSession(QuizSettings(rounds=1, chord_types=("sus7",)))
        raised = False
    except ValueError:
        raised = True

    assert raised is True


def test_update_combo_scores_tracks_correct_and_wrong():
    prompt = build_seventh_chord("C", "maj7")
    scores = {}

    scores = update_combo_scores(scores, prompt, is_correct=True)
    assert scores[("C", "maj7")] == 1

    scores = update_combo_scores(scores, prompt, is_correct=False)
    assert scores[("C", "maj7")] == 0


def test_weighted_sampling_prioritizes_negative_scores():
    session = QuizSession(
        QuizSettings(
            rounds=1,
            include_keys=("C", "D"),
            include_modes=("maj7",),
        )
    )

    scores = {
        ("C", "maj7"): -6,
        ("D", "maj7"): 5,
    }

    c_count = 0
    d_count = 0
    for _ in range(200):
        prompt = session.generate_prompt(scores=scores)
        if prompt.symbol.startswith("C"):
            c_count += 1
        elif prompt.symbol.startswith("D"):
            d_count += 1

    assert c_count > d_count


def test_invalid_include_modes_are_rejected():
    with pytest.raises(ValueError, match="Unsupported modes"):
        QuizSession(QuizSettings(rounds=1, include_modes=("sus7",)))


def test_no_available_modes_after_filters_raises():
    with pytest.raises(ValueError, match="No available modes"):
        QuizSession(
            QuizSettings(
                rounds=1,
                include_modes=("maj7",),
                exclude_modes=("maj7",),
            )
        )


def test_weighted_sampling_prioritizes_underexplored_keys():
    session = QuizSession(
        QuizSettings(
            rounds=1,
            include_keys=("C", "D"),
            include_modes=("maj7", "7"),
        )
    )

    scores = {
        ("C", "maj7"): 4,
        ("C", "7"): 3,
        ("D", "maj7"): 0,
        ("D", "7"): 1,
    }

    c_count = 0
    d_count = 0
    for _ in range(300):
        prompt = session.generate_prompt(scores=scores)
        if prompt.symbol.startswith("C"):
            c_count += 1
        elif prompt.symbol.startswith("D"):
            d_count += 1

    assert d_count > c_count


def test_weighted_sampling_prioritizes_underexplored_qualities():
    session = QuizSession(
        QuizSettings(
            rounds=1,
            include_keys=("C", "D"),
            include_modes=("maj7", "7"),
        )
    )

    scores = {
        ("C", "maj7"): 0,
        ("D", "maj7"): 1,
        ("C", "7"): 5,
        ("D", "7"): 4,
    }

    maj7_count = 0
    dominant_count = 0
    for _ in range(300):
        prompt = session.generate_prompt(scores=scores)
        if prompt.symbol.endswith("maj7"):
            maj7_count += 1
        elif prompt.symbol.endswith("7"):
            dominant_count += 1

    assert maj7_count > dominant_count
