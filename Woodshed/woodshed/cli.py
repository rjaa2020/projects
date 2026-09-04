from __future__ import annotations

import argparse

from .quiz import QuizSession, QuizSettings
from .theory import DEFAULT_CHORD_TYPES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="woodshed",
        description="Practice naming notes in seventh chords.",
    )
    parser.add_argument("--rounds", type=int, default=10, help="Number of quiz rounds (default: 10)")
    parser.add_argument(
        "--types",
        nargs="+",
        default=list(DEFAULT_CHORD_TYPES),
        help="Chord qualities to include (e.g. maj7 7 min7 m7b5 dim7)",
    )
    return parser


def run_cli() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.rounds <= 0:
        parser.error("--rounds must be a positive integer")

    settings = QuizSettings(rounds=args.rounds, chord_types=tuple(args.types))
    session = QuizSession(settings=settings)

    print("Woodshed: Seventh Chord Note Trainer")
    print("Type notes in chord order, separated by spaces or commas (example: C E G B).")

    correct = 0
    for round_number in range(1, settings.rounds + 1):
        prompt = session.generate_prompt()
        answer = input(f"[{round_number}/{settings.rounds}] {prompt.symbol} -> ").strip()
        result = session.check_answer(prompt, answer)
        if result.is_correct:
            correct += 1
            print("  ✅ Correct")
        else:
            print(f"  ❌ Nope. Correct notes: {', '.join(prompt.notes)}")

    percent = (correct / settings.rounds) * 100
    print(f"\nScore: {correct}/{settings.rounds} ({percent:.1f}%)")
    return 0


def main() -> None:
    raise SystemExit(run_cli())


if __name__ == "__main__":
    main()
