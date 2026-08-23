"""Measure job_digest runtime in two modes: no model and simulated model load.

This script programmatically invokes `job_digest.run()` while monkeypatching
`nlp_utils.select_nlp_model` and `nlp_utils.load_spacy_model` to control whether
an NLP model is used. The "with model" run simulates model load/inference cost
without requiring `spacy` to be installed.
"""
from __future__ import annotations

import time
import types
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import job_digest
import nlp_utils


def _run_once(force_model: bool = False) -> float:
    # Monkeypatch model selection/load
    orig_select = nlp_utils.select_nlp_model
    orig_load = nlp_utils.load_spacy_model

    if force_model:
        nlp_utils.select_nlp_model = lambda: "en_core_web_sm"

        def fake_loader(name: str):
            # simulate model load cost
            time.sleep(1.2)

            class DummyNLP:
                def __call__(self, text: str):
                    class Doc:
                        ents = []

                    time.sleep(0.001)  # tiny per-doc inference cost
                    return Doc()

            return DummyNLP()

        nlp_utils.load_spacy_model = fake_loader
    else:
        nlp_utils.select_nlp_model = lambda: None

    start = time.perf_counter()
    try:
        # call run with a small days window to limit work
        sys_argv_orig = sys.argv[:]
        sys.argv[:] = [sys.argv[0], "--days", "1"]
        job_digest.run(logger=None)
    finally:
        sys.argv[:] = sys_argv_orig
        nlp_utils.select_nlp_model = orig_select
        nlp_utils.load_spacy_model = orig_load

    return time.perf_counter() - start


def main():
    print("Measuring digest runtime (baseline, no model)...")
    t0 = _run_once(force_model=False)
    print(f"Baseline runtime: {t0:.3f} seconds")

    print("Measuring digest runtime (with simulated model load)...")
    t1 = _run_once(force_model=True)
    print(f"With-model (simulated) runtime: {t1:.3f} seconds")
    print(f"Model overhead (approx): {t1 - t0:.3f} seconds")


if __name__ == "__main__":
    main()
