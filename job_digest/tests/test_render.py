import unittest
from datetime import date, datetime, timezone

from render import format_portable_date, render_digest_html


class TestRender(unittest.TestCase):
    def test_portable_date_has_no_leading_zero_dependency(self):
        value = format_portable_date(datetime(2026, 8, 3, tzinfo=timezone.utc))
        self.assertEqual(value, "Aug 3, 2026")

    def test_render_contains_expected_sections_and_escapes(self):
        entries = [
            {
                "company": "A & B Co",
                "company_key": "a b",
                "status": "action",
                "subject": "Please complete <assessment>",
                "excerpt": "Use this link & confirm.",
                "date_label": "Aug 20, 2026",
            }
        ]
        counts = {"rejected": 1, "interview": 2, "action": 3, "submitted": 4}

        html = render_digest_html(
            entries=entries,
            counts=counts,
            range_start=date(2026, 7, 22),
            range_end=date(2026, 8, 21),
            generated_at=datetime(2026, 8, 21, tzinfo=timezone.utc),
        )

        self.assertIn("Job Application Digest", html)
        self.assertIn("Coverage: Jul 22, 2026 to Aug 21, 2026", html)
        self.assertIn("Status", html)
        self.assertIn("Tags", html)
        self.assertIn("Action Needed", html)
        self.assertIn("A &amp; B Co", html)
        self.assertIn("1 updates", html)
        self.assertIn('data-filter-key="all"', html)
        self.assertIn("Click a status or tag to filter the dashboard.", html)
        self.assertIn("Please complete &lt;assessment&gt;", html)
        self.assertIn("Use this link &amp; confirm.", html)
        self.assertIn('role="presentation"', html)
        self.assertIn("data-entry-row", html)
        self.assertIn('data-status-key="action"', html)
        self.assertIn('data-filter-group="status"', html)


if __name__ == "__main__":
    unittest.main()
