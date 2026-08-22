import unittest
from datetime import date
from unittest.mock import Mock, patch

import gmail_client
from gmail_client import build_search_query, is_denylisted, search_thread_ids


class TestBuildSearchQuery(unittest.TestCase):
    @patch("gmail_client.date")
    def test_builds_expected_structure(self, mock_date):
        mock_date.today.return_value = date(2026, 8, 21)

        query = build_search_query(30)

        self.assertIn("after:2026/07/22", query)
        self.assertIn("from:greenhouse-mail.io", query)
        self.assertIn("from:hire.lever.co", query)
        self.assertIn('subject:"application"', query)
        self.assertIn('"application"', query)
        self.assertIn('-subject:"newsletter"', query)
        self.assertIn('-subject:"digest"', query)


class TestDenylist(unittest.TestCase):
    def test_denylist_sender_match(self):
        self.assertTrue(
            is_denylisted("Levels.fyi Jobs <alerts@levels.fyi>", "Weekly opportunities")
        )

    def test_denylist_subject_match(self):
        self.assertTrue(
            is_denylisted("Recruiting <recruiting@company.com>", "Weekly digest of new jobs")
        )

    def test_non_denylisted(self):
        self.assertFalse(
            is_denylisted("Recruiting <recruiting@company.com>", "Interview confirmation")
        )


class TestSearchPagination(unittest.TestCase):
    def test_search_thread_ids_paginates_and_dedupes(self):
        list_call_1 = Mock()
        list_call_1.execute.return_value = {
            "threads": [{"id": "t1"}, {"id": "t2"}],
            "nextPageToken": "next-1",
        }

        list_call_2 = Mock()
        list_call_2.execute.return_value = {
            "threads": [{"id": "t2"}, {"id": "t3"}],
        }

        threads_api = Mock()
        threads_api.list.side_effect = [list_call_1, list_call_2]

        users_api = Mock()
        users_api.threads.return_value = threads_api

        service = Mock()
        service.users.return_value = users_api

        result = search_thread_ids(service, "query")

        self.assertEqual(result, ["t1", "t2", "t3"])
        self.assertEqual(threads_api.list.call_count, 2)
        self.assertIsNone(threads_api.list.call_args_list[0].kwargs["pageToken"])
        self.assertEqual(threads_api.list.call_args_list[1].kwargs["pageToken"], "next-1")


if __name__ == "__main__":
    unittest.main()
