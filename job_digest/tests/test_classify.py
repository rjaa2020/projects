import unittest

from classify import classify_status, extract_company_name
from config import ATS_DOMAINS


class TestClassification(unittest.TestCase):
    def test_rejected_takes_precedence_over_interview(self):
        subject = "Update on your application"
        snippet = "We will not be moving forward"
        body = "Thanks for the interview process"
        self.assertEqual(classify_status(subject, snippet, body), "rejected")

    def test_interview_detection(self):
        subject = "Interview Confirmation"
        snippet = ""
        body = "Your interview is confirmed via Google Meet"
        self.assertEqual(classify_status(subject, snippet, body), "interview")

    def test_action_detection(self):
        subject = "Next steps for your candidacy"
        snippet = "Please complete the assessment"
        body = ""
        self.assertEqual(classify_status(subject, snippet, body), "action")

    def test_submitted_detection(self):
        subject = "Thank you for applying"
        snippet = "Your application has been received"
        body = ""
        self.assertEqual(classify_status(subject, snippet, body), "submitted")

    def test_default_is_submitted(self):
        subject = "General update"
        snippet = "We will keep your profile on file"
        body = "No immediate action required"
        self.assertEqual(classify_status(subject, snippet, body), "submitted")

    def test_full_precedence_chain_rejected_over_interview_action_submitted(self):
        subject = "Interview next steps"
        snippet = "Please complete your assessment"
        body = (
            "Thank you for applying. Unfortunately, we decided to move forward with other candidates."
        )
        self.assertEqual(classify_status(subject, snippet, body), "rejected")

    def test_interview_beats_action(self):
        subject = "Interview plan and next steps"
        snippet = "Please complete your availability form"
        body = "We are confirming your interview schedule"
        self.assertEqual(classify_status(subject, snippet, body), "interview")


class TestCompanyExtraction(unittest.TestCase):
    def test_extracts_from_subject_for_greenhouse(self):
        subject = "Thank you for applying to Acme Robotics"
        from_header = "no-reply@us.greenhouse-mail.io"
        result = extract_company_name(subject, from_header, ATS_DOMAINS)
        self.assertEqual(result, "Acme Robotics")

    def test_extracts_from_subject_for_lever(self):
        subject = "Interview with Atlas AI"
        from_header = "jobs@hire.lever.co"
        result = extract_company_name(subject, from_header, ATS_DOMAINS)
        self.assertEqual(result, "Atlas AI")

    def test_extracts_from_subject_for_ashby(self):
        subject = "Update on your application to Beacon Labs"
        from_header = "team@ashbyhq.com"
        result = extract_company_name(subject, from_header, ATS_DOMAINS)
        self.assertEqual(result, "Beacon Labs")

    def test_uses_domain_fallback_for_non_ats(self):
        subject = "Application update"
        from_header = "talent@contoso.com"
        result = extract_company_name(subject, from_header, ATS_DOMAINS)
        self.assertEqual(result, "Contoso")

    def test_ats_domain_without_subject_pattern_falls_back_to_display_name(self):
        subject = "Your application status update"
        from_header = "Stark Industries via Greenhouse <no-reply@greenhouse-mail.io>"
        result = extract_company_name(subject, from_header, ATS_DOMAINS)
        self.assertEqual(result, "Stark Industries")


if __name__ == "__main__":
    unittest.main()
