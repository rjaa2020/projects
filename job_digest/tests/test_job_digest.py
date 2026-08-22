import unittest
from unittest.mock import patch

import job_digest
from gmail_client import ThreadLatestMessage


class TestJobDigestLogic(unittest.TestCase):
    @patch("job_digest.extract_company_name")
    @patch("job_digest.classify_status")
    @patch("job_digest.get_plaintext_body")
    @patch("job_digest.is_denylisted")
    @patch("job_digest.get_latest_message_metadata")
    @patch("job_digest.search_thread_ids")
    @patch("job_digest.build_search_query")
    def test_build_entries_sorts_desc_and_skips_denylisted(
        self,
        mock_build_query,
        mock_search,
        mock_get_latest,
        mock_is_denylisted,
        mock_get_body,
        mock_classify,
        mock_company,
    ):
        mock_build_query.return_value = "query"
        mock_search.return_value = ["t1", "t2", "t3"]

        msg_1 = ThreadLatestMessage(
            thread_id="t1",
            message_id="m1",
            internal_date_ms=1000,
            from_header="Recruiting <a@contoso.com>",
            subject="S1",
            snippet="Snippet 1",
        )
        msg_2 = ThreadLatestMessage(
            thread_id="t2",
            message_id="m2",
            internal_date_ms=3000,
            from_header="Recruiting <b@contoso.com>",
            subject="S2",
            snippet="Snippet 2",
        )
        msg_3 = ThreadLatestMessage(
            thread_id="t3",
            message_id="m3",
            internal_date_ms=2000,
            from_header="Recruiting <c@contoso.com>",
            subject="S3",
            snippet="Snippet 3",
        )
        mock_get_latest.side_effect = [msg_1, msg_2, msg_3]
        mock_is_denylisted.side_effect = [False, True, False]
        mock_get_body.side_effect = ["Body 1", "Body 3"]
        mock_classify.side_effect = ["submitted", "interview"]
        mock_company.side_effect = ["Contoso", "Fabrikam"]

        entries = job_digest.build_entries(service=object(), days=30)

        self.assertEqual(len(entries), 2)
        self.assertEqual([e["thread_id"] for e in entries], ["t3", "t1"])
        self.assertEqual(entries[0]["company"], "Fabrikam")
        self.assertEqual(entries[1]["company"], "Contoso")

    def test_count_statuses(self):
        entries = [
            {"status": "rejected"},
            {"status": "interview"},
            {"status": "interview"},
            {"status": "action"},
            {"status": "unknown"},
        ]

        counts = job_digest.count_statuses(entries)

        self.assertEqual(counts["rejected"], 1)
        self.assertEqual(counts["interview"], 2)
        self.assertEqual(counts["action"], 1)
        self.assertEqual(counts["submitted"], 1)

    @patch("job_digest.get_plaintext_body")
    @patch("job_digest.is_denylisted")
    @patch("job_digest.get_latest_message_metadata")
    @patch("job_digest.search_thread_ids")
    @patch("job_digest.build_search_query")
    def test_build_entries_uses_real_status_and_company_logic(
        self,
        mock_build_query,
        mock_search,
        mock_get_latest,
        mock_is_denylisted,
        mock_get_body,
    ):
        mock_build_query.return_value = "query"
        mock_search.return_value = ["t1", "t2"]

        msg_1 = ThreadLatestMessage(
            thread_id="t1",
            message_id="m1",
            internal_date_ms=1000,
            from_header="no-reply@greenhouse-mail.io",
            subject="Thank you for applying to Acme Robotics",
            snippet="Application has been received",
        )
        msg_2 = ThreadLatestMessage(
            thread_id="t2",
            message_id="m2",
            internal_date_ms=2000,
            from_header="jobs@hire.lever.co",
            subject="Update on your application to Atlas AI",
            snippet="",
        )

        mock_get_latest.side_effect = [msg_1, msg_2]
        mock_is_denylisted.side_effect = [False, False]
        mock_get_body.side_effect = [
            "Thanks for applying. Your application has been received.",
            "Unfortunately, we decided to move forward with other candidates.",
        ]

        entries = job_digest.build_entries(service=object(), days=30)

        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["status"], "rejected")
        self.assertEqual(entries[0]["company"], "Atlas AI")
        self.assertEqual(entries[1]["status"], "submitted")
        self.assertEqual(entries[1]["company"], "Acme Robotics")


if __name__ == "__main__":
    unittest.main()
