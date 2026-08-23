"""Configuration constants for the job application digest tool."""

from __future__ import annotations

from typing import Dict, List

SCOPES: List[str] = [
    "https://www.googleapis.com/auth/gmail.readonly",
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
    r"reddit",
    r"indeed",
    r"zoom\.us",
    r"northeastern\.edu",
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

NOISE_COMPANY_PATTERNS: List[str] = [
    r"\breddit\b",
    r"\bindeed\b",
    r"\bzoom\b",
    r"\bnortheastern\b",
    r"\b55[- ]?57\s+york\b",
]

SOURCE_TAG_PATTERNS: Dict[str, List[str]] = {
    "Greenhouse": [r"greenhouse", r"greenhouse-mail\.io", r"greenhouse-jobs\.com"],
    "Lever": [r"lever", r"hire\.lever\.co"],
    "Ashby": [r"ashby", r"ashbyhq\.com"],
    "Workday": [r"workday", r"myworkday\.com"],
    "iCIMS": [r"icims", r"icims\.com"],
    "SmartRecruiters": [r"smartrecruiters", r"smartrecruiters\.com"],
    "Jobvite": [r"jobvite", r"jobvite\.com"],
    "Taleo": [r"taleo", r"taleo\.net"],
    "SuccessFactors": [r"successfactors", r"successfactors\.com"],
    "Weekday": [r"weekday", r"weekdayhire\.com", r"weekday\.tools"],
    "Paraform": [r"paraform", r"paraform\.com"],
    "Indeed": [r"indeed"],
    "Zoom": [r"zoom"],
    "Northeastern": [r"northeastern"],
    "Jack and Jill": [r"jack\s+and\s+jill", r"jack\s*&\s*jill"],
}

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

# Fuzzy matching and tag similarity settings
# When True, server-side tag merging will use `rapidfuzz` to cluster similar tags.
ENABLE_FUZZY_MATCHING: bool = True
# rapidfuzz token_sort_ratio threshold (0-100) for merging similar tag slugs
FUZZY_SIMILARITY_THRESHOLD: int = 85

# Tag token digit heuristics
# Maximum fraction of digits in a token before rejecting it as an id-like token.
TAG_MAX_DIGIT_FRACTION: float = 0.75
# Tokens shorter than or equal to this length skip the digit-fraction check.
TAG_MIN_LEN_DIGIT_CHECK: int = 3
# Encoded-token detection: tokens longer than TAG_ENCODED_MIN_LEN with
# high character entropy or very low vowel fraction are treated as encoded ids
# and will be rejected as tags.
TAG_ENCODED_MIN_LEN: int = 20
TAG_ENCODED_ENTROPY_THRESHOLD: float = 3.8
TAG_ENCODED_MIN_VOWEL_FRACTION: float = 0.12
