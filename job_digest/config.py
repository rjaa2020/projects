"""Configuration constants for the job application digest tool."""

from __future__ import annotations

from typing import Dict, List

SCOPES: List[str] = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

ATS_DOMAINS: List[str] = [
    "greenhouse-mail.io",
    "greenhouse-jobs.com",
    "hire.lever.co",
    "ashbyhq.com",
    "myworkday.com",
    "icims.com",
    "smartrecruiters.com",
    "jobvite.com",
    "taleo.net",
    "successfactors.com",
    "workablemail.com",
    "paraform.com",
    "weekdayhire.com",
    "weekday.tools",
]

SEARCH_KEYWORDS: List[str] = [
    "application",
    "applying",
    "interview",
    "next steps",
    "offer",
    "candidacy",
    "thank you for applying",
    "update on your application",
    "not moving forward",
]

NEGATIVE_SUBJECT_TERMS: List[str] = [
    "newsletter",
    "digest",
    "job matches",
    "new job",
]

# These are editable post-filters for sources that commonly generate noise.
DENYLIST_SENDER_PATTERNS: List[str] = [
    r"levels\.fyi",
    r"leetcode",
    r"simplify\.jobs",
    r"wayup\.com",
    r"substack",
    r"admissions",
    r"university",
    r"college",
]

DENYLIST_SUBJECT_PATTERNS: List[str] = [
    r"newsletter",
    r"weekly digest",
    r"job matches",
    r"new jobs?",
    r"admissions",
]

STATUS_PATTERNS: Dict[str, List[str]] = {
    "rejected": [
        r"not moving forward",
        r"will not be moving forward",
        r"decided to pursue other candidates",
        r"decided to move forward with other candidates",
        r"won['’]?t be able to continue with your candidacy",
        r"regret to inform",
        r"unfortunately",
    ],
    "interview": [
        r"interview",
        r"zoom meeting",
        r"google meet",
        r"intro call",
        r"interview confirmation",
        r"interview plan",
    ],
    "action": [
        r"next steps",
        r"please complete",
        r"assessment",
        r"complete your",
        r"still interested",
        r"awaiting submission",
        r"finish\s+.*onboarding",
    ],
    "submitted": [
        r"thank you for applying",
        r"thanks for applying",
        r"application has been received",
        r"application was received",
        r"application\s+.*submitted",
        r"we['’]?re confirming that your application",
        r"received your application",
    ],
}

STATUS_COLORS: Dict[str, str] = {
    "rejected": "#B42318",
    "interview": "#175CD3",
    "action": "#B54708",
    "submitted": "#027A48",
}

STATUS_LABELS: Dict[str, str] = {
    "rejected": "Rejected",
    "interview": "Interview",
    "action": "Action Needed",
    "submitted": "Submitted",
}
