import unittest

from classify import classify_status, company_key, extract_company_name, extract_proper_noun_phrases, is_noise_company
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


class TestCompanyFiltering(unittest.TestCase):
    def test_filters_noise_companies(self):
        self.assertTrue(is_noise_company("Reddit", "Some update", "alerts@reddit.com"))
        self.assertTrue(is_noise_company("Northeastern Online", "Interview confirmation", "jobs@northeastern.edu"))
        self.assertTrue(is_noise_company("Zoom", "Meeting assets ready", "no-reply@zoom.us"))
        self.assertTrue(is_noise_company("Indeed", "Application alert", "no-reply@indeed.com"))
        self.assertTrue(is_noise_company("55-57 York", "Purchase update", "noreply@example.com"))

    def test_company_key_normalizes_variants(self):
        self.assertEqual(company_key("Northeastern Online"), "northeastern")
        self.assertEqual(company_key("Acme Robotics, Inc."), "acme robotics")

    def test_extracts_proper_noun_phrases(self):
        phrases = extract_proper_noun_phrases("Jack and Jill Recruiting forwarded your PlayStation Global update")
        self.assertIn("Jack and Jill", phrases)
        self.assertIn("PlayStation Global", phrases)

    def test_rejects_encoded_like_tokens(self):
        blob = (
            "8VLODqhALbx-D4jBKlUw23E2RYKItJxQoCsLKnJuZx6qALxlRHPEtPpduINH "
            "jzosJpS4WR8qZUOEEeWrMVIF5FjqTaK om3QNstaYBdPpVOSCldVoy4pv7n-cMQ6wVwYje4YO "
            "6lOBKXVPq2NOpAFP-i06rzxnYA0u7SI428tRjsf EaJfOYByapQxSKEd2GFu4q23BJviEFCBpApcnxtsUZ7SQPql2mUUhMLNeuF4Q1HFzMwCUwLNnverqX6Kdh"
        )
        phrases = extract_proper_noun_phrases(f"Update from {blob} regarding your application")
        # should not return the encoded-like blob as a proper-noun phrase
        self.assertEqual(phrases, [])

    def test_rejects_url_and_encoded_fragments(self):
        s = "2FCtc 2FI82Fd31rwt042Fintro30AM PDT Jordan Lowe30AM PDT Jordan LoweHi Rahul Your Google3A 2F3A 2F 2Fwww.samba.tv 2Fcareers&sa D&source"
        phrases = extract_proper_noun_phrases(f"Update from {s} about your application")
        # none of those fragments should be treated as proper noun tags
        self.assertEqual(phrases, [])


if __name__ == "__main__":
    unittest.main()
