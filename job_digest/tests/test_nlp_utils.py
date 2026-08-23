import unittest

import nlp_utils
from render import render_digest_html
from datetime import datetime, timezone, date


class TestNLPModelSelection(unittest.TestCase):
    def test_selects_transformer_on_gpu(self):
        orig = nlp_utils.detect_resources
        nlp_utils.detect_resources = lambda: {"total_mem_gb": 32, "cpu_count": 8, "has_gpu": True, "platform": "Linux", "machine": "x86_64"}
        try:
            model = nlp_utils.select_nlp_model()
            self.assertEqual(model, "en_core_web_trf")
        finally:
            nlp_utils.detect_resources = orig

    def test_selects_trf_on_big_cpu_mem(self):
        orig = nlp_utils.detect_resources
        nlp_utils.detect_resources = lambda: {"total_mem_gb": 16, "cpu_count": 4, "has_gpu": False, "platform": "Linux", "machine": "x86_64"}
        try:
            model = nlp_utils.select_nlp_model()
            # Conservative policy: CPU-only machines should prefer the small model
            self.assertEqual(model, "en_core_web_sm")
        finally:
            nlp_utils.detect_resources = orig

    def test_selects_small_model_on_modest_machine(self):
        orig = nlp_utils.detect_resources
        nlp_utils.detect_resources = lambda: {"total_mem_gb": 8, "cpu_count": 2, "has_gpu": False, "platform": "Darwin", "machine": "arm64"}
        try:
            model = nlp_utils.select_nlp_model()
            self.assertEqual(model, "en_core_web_sm")
        finally:
            nlp_utils.detect_resources = orig

    def test_selects_none_on_constrained_env(self):
        orig = nlp_utils.detect_resources
        nlp_utils.detect_resources = lambda: {"total_mem_gb": 1, "cpu_count": 1, "has_gpu": False, "platform": "Linux", "machine": "x86_64"}
        try:
            model = nlp_utils.select_nlp_model()
            self.assertIsNone(model)
        finally:
            nlp_utils.detect_resources = orig


class TestRenderRuntimeInfo(unittest.TestCase):
    def test_runtime_info_shown_in_digest(self):
        entries = []
        counts = {"rejected": 0, "interview": 0, "action": 0, "submitted": 0}
        start = date.today()
        end = start
        generated = datetime.now(timezone.utc)
        runtime_info = {"selected_model": "en_core_web_sm", "platform": "Darwin", "machine": "arm64", "cpu_count": 8, "total_mem_gb": 16.0, "has_gpu": False}

        html = render_digest_html(entries, counts, start, end, generated, runtime_info)
        self.assertIn("Model: en_core_web_sm", html)
        self.assertIn("Platform: Darwin arm64", html)


if __name__ == "__main__":
    unittest.main()
