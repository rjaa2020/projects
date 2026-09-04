import woodshed.ireal as ireal


def test_extract_supported_quiz_chords_from_measures():
    measures = (
        "C7B7Bb7A7",
        "Db^7",
        "Eh7",
        "Ao7",
        "F-7",
        "C6",
    )

    chords = ireal._extract_supported_quiz_chords(measures)

    assert chords == (
        "C7",
        "B7",
        "Bb7",
        "A7",
        "Dbmaj7",
        "Em7b5",
        "Adim7",
        "Fmin7",
    )


def test_parse_minimal_irealb_song_payload():
    uri = "irealb://Test=Composer==Medium Swing=C==1r34LbKcu7C7LZG-7"

    title, composer, style, key, measures = ireal._parse_irealb_song(uri)

    assert title == "Test"
    assert composer == "Composer"
    assert style == "Medium Swing"
    assert key == "C"
    assert measures == ("C7", "G-7")


def test_extract_supported_chords_from_minimal_payload():
    uri = "irealb://Test=Composer==Medium Swing=C==1r34LbKcu7C7LZG-7"

    _, _, _, _, measures = ireal._parse_irealb_song(uri)
    chords = ireal._extract_supported_quiz_chords(measures)

    assert chords == ("C7", "Gmin7")


def test_extract_supported_quiz_chords_maps_ninth_to_seventh():
    measures = ("D9", "C^9", "F-9", "Eh9", "Ao9")

    chords = ireal._extract_supported_quiz_chords(measures)

    assert chords == ("D7", "Cmaj7", "Fmin7", "Em7b5", "Adim7")


def test_extract_supported_quiz_chords_maps_triangle_to_major_seventh():
    measures = ("D△7", "CΔ9")

    chords = ireal._extract_supported_quiz_chords(measures)

    assert chords == ("Dmaj7", "Cmaj7")


def test_transpose_quiz_chords_for_bb_instrument():
    chords = ("C7", "Dbmaj7", "Fmin7", "Bm7b5")

    transposed = ireal.transpose_quiz_chords_for_instrument(chords, "Bb")

    assert transposed == ("D7", "Ebmaj7", "Gmin7", "Dbm7b5")


def test_transpose_quiz_chords_for_eb_instrument():
    chords = ("C7", "Dbmaj7", "Fmin7", "Bm7b5")

    transposed = ireal.transpose_quiz_chords_for_instrument(chords, "Eb")

    assert transposed == ("A7", "Bbmaj7", "Dmin7", "Abm7b5")
