"""Status classification and company extraction logic."""

from __future__ import annotations

import re
from email.utils import parseaddr
from typing import Iterable, List, Optional

from config import NOISE_COMPANY_PATTERNS, STATUS_PATTERNS

STATUS_ORDER: List[str] = ["rejected", "interview", "action", "submitted"]

SUBJECT_COMPANY_PATTERNS: List[re.Pattern[str]] = [
    re.compile(r"\bthank you for applying to\s+(.+?)(?:\s*[|:,-].*|$)", re.IGNORECASE),
    re.compile(r"\bupdate on your application to\s+(.+?)(?:\s*[|:,-].*|$)", re.IGNORECASE),
    re.compile(r"\binterview with\s+(.+?)(?:\s*[|:,-].*|$)", re.IGNORECASE),
    re.compile(r"\bapplying to\s+(.+?)(?:\s*[|:,-].*|$)", re.IGNORECASE),
    re.compile(r"\byour application to\s+(.+?)(?:\s*[|:,-].*|$)", re.IGNORECASE),
]


def classify_status(subject: str, snippet: str, body_text: str) -> str:
    """Classify a message according to precedence-ordered status rules."""
    haystack = " ".join([subject or "", snippet or "", body_text or ""]).lower()

    for status in STATUS_ORDER:
        for pattern in STATUS_PATTERNS[status]:
            if re.search(pattern, haystack, flags=re.IGNORECASE):
                return status

    return "submitted"


def extract_company_name(subject: str, from_header: str, ats_domains: Iterable[str]) -> str:
    """Extract a human-readable company name for display."""
    subject_company = _extract_company_from_subject(subject)
    if subject_company:
        return subject_company

    display_name, sender_addr = parseaddr(from_header or "")
    sender_domain = _extract_domain(sender_addr)

    if display_name:
        clean_display = _clean_display_name(display_name)
        if clean_display:
            return clean_display

    if sender_domain and not _is_ats_domain(sender_domain, ats_domains):
        return _title_from_domain(sender_domain)

    if sender_domain:
        return _title_from_domain(sender_domain)

    return "Unknown Company"


def is_noise_company(company: str, subject: str = "", from_header: str = "") -> bool:
    """Detect noisy non-application sources that should be excluded from the digest."""
    haystack = " ".join([company or "", subject or "", from_header or ""]).lower()

    for pattern in NOISE_COMPANY_PATTERNS:
        if re.search(pattern, haystack, flags=re.IGNORECASE):
            return True

    return False


def company_key(company: str) -> str:
    """Build a stable normalized key for grouping and timeline matching."""
    value = (company or "").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\b(inc|llc|ltd|co|corp|corporation|company|jobs?|careers?|team|online)\b", "", value)
    return re.sub(r"\s+", " ", value).strip()


def _extract_company_from_subject(subject: str) -> Optional[str]:
    if not subject:
        return None

    for pattern in SUBJECT_COMPANY_PATTERNS:
        match = pattern.search(subject)
        if match:
            value = _normalize_company_name(match.group(1))
            if value:
                return value

    return None


def _extract_domain(email_address: str) -> str:
    if "@" not in email_address:
        return ""
    return email_address.split("@", 1)[1].strip().lower()


def _is_ats_domain(domain: str, ats_domains: Iterable[str]) -> bool:
    domain = domain.lower()
    for ats_domain in ats_domains:
        normalized = ats_domain.lower()
        if domain == normalized or domain.endswith("." + normalized):
            return True
    return False


def _title_from_domain(domain: str) -> str:
    parts = [p for p in domain.split(".") if p]
    if len(parts) >= 2:
        base = parts[-2]
    elif parts:
        base = parts[0]
    else:
        return "Unknown Company"

    base = base.replace("-", " ").replace("_", " ").strip()
    return " ".join(piece.capitalize() for piece in base.split()) or "Unknown Company"


def _normalize_company_name(raw: str) -> str:
    value = re.sub(r"\s+", " ", raw).strip(" \t\n\r\"'.,:;-|")

    # Trim common suffixes that are not part of the company identity.
    value = re.sub(r"\s+(team|careers|jobs?)$", "", value, flags=re.IGNORECASE).strip()
    return value


def _clean_display_name(display_name: str) -> str:
    value = re.sub(r"\s+", " ", display_name).strip()
    value = re.sub(
        r"\b(via|through)\s+(greenhouse|lever|ashby|workday|icims|smartrecruiters|jobvite)\b.*$",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip(" -|")

    # Avoid labels that are clearly not employers.
    if not value:
        return ""
    if re.search(r"\b(no\s*reply|notifications?)\b", value, flags=re.IGNORECASE):
        return ""

    return value
