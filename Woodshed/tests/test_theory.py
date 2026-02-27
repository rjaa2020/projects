from woodshed.theory import build_seventh_chord


def test_build_major_seventh_chord():
    prompt = build_seventh_chord("C", "maj7")
    assert prompt.symbol == "Cmaj7"
    assert prompt.notes == ("C", "E", "G", "B")


def test_build_dominant_flat_root():
    prompt = build_seventh_chord("Bb", "7")
    assert prompt.notes == ("Bb", "D", "F", "Ab")
