import pytest

from woodshed.theory import build_seventh_chord, split_chord_symbol


def test_build_major_seventh_chord():
    prompt = build_seventh_chord("C", "maj7")
    assert prompt.symbol == "Cmaj7"
    assert prompt.notes == ("C", "E", "G", "B")


def test_build_dominant_flat_root():
    prompt = build_seventh_chord("Bb", "7")
    assert prompt.notes == ("Bb", "D", "F", "Ab")


def test_build_chord_accepts_unicode_accidentals():
    prompt = build_seventh_chord("D♭", "maj7")
    assert prompt.symbol == "Dbmaj7"


def test_split_chord_symbol_returns_root_and_quality():
    root, quality = split_chord_symbol("Dbmin7")
    assert root == "Db"
    assert quality == "min7"


def test_split_chord_symbol_rejects_unknown_symbol():
    with pytest.raises(ValueError, match="Unsupported chord symbol"):
        split_chord_symbol("Hmaj7")


def test_build_chord_rejects_unknown_quality():
    with pytest.raises(ValueError, match="Unsupported quality"):
        build_seventh_chord("C", "sus7")
