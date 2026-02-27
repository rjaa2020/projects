from woodshed.quiz import QuizSession, QuizSettings
from woodshed.theory import build_seventh_chord


def test_check_answer_accepts_spaces_or_commas():
    session = QuizSession(QuizSettings(rounds=1, chord_types=("maj7",)))
    prompt = build_seventh_chord("C", "maj7")

    assert session.check_answer(prompt, "C E G B").is_correct is True
    assert session.check_answer(prompt, "C,E,G,B").is_correct is True


def test_invalid_chord_type_is_rejected():
    try:
        QuizSession(QuizSettings(rounds=1, chord_types=("sus7",)))
        raised = False
    except ValueError:
        raised = True

    assert raised is True
