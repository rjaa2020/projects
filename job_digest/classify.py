"""Status classification and company extraction logic."""

from __future__ import annotations

import re
from email.utils import parseaddr
from typing import Iterable, List, Optional

from config import NOISE_COMPANY_PATTERNS, SOURCE_TAG_PATTERNS, STATUS_PATTERNS
from nlp_utils import select_nlp_model, load_spacy_model
from config import TAG_MAX_DIGIT_FRACTION, TAG_MIN_LEN_DIGIT_CHECK, TAG_ENCODED_MIN_LEN, TAG_ENCODED_ENTROPY_THRESHOLD, TAG_ENCODED_MIN_VOWEL_FRACTION
from math import log2

STATUS_ORDER: List[str] = ["rejected", "interview", "action", "submitted"]

PROPER_NOUN_CONNECTORS = {"and", "of", "the", "for", "to", "in", "on", "at", "via", "through", "with", "&"}

PROPER_NOUN_STOPWORDS = {
    "application",
    "applying",
    "candidate",
    "candidates",
    "career",
    "careers",
    "complete",
    "confirmed",
    "dear",
    "experience",
    "hello",
    "hi",
    "interview",
    "job",
    "jobs",
    "next",
    "opportunity",
    "opportunities",
    "please",
    "recruiting",
    "regards",
    "security",
    "steps",
    "thank",
    "thanks",
    "team",
    "update",
    "we",
    "you",
}

PROPER_NOUN_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’&.-]*")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
LONG_HEX_RE = re.compile(r"^[0-9A-Fa-f]{6,}$")
BASE64_LIKE_RE = re.compile(r"^(?=.*[+/=])[A-Za-z0-9+/]{8,}={0,2}$")
HEX_PAIR_SEQ_RE = re.compile(r"(?:[0-9A-Fa-f]{2}){3,}")
URL_TOKEN_RE = re.compile(r"www\.|https?:|%[0-9A-Fa-f]{2}|&source|&sa|mailto:|://")

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


def detect_source_tag(subject: str, from_header: str) -> str:
    """Infer a source/recruiting platform tag from the sender or subject."""
    haystack = " ".join([subject or "", from_header or ""]).lower()

    for label, patterns in SOURCE_TAG_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, haystack, flags=re.IGNORECASE):
                return label

    return ""


def extract_proper_noun_phrases(text: str) -> List[str]:
    """Extract lightweight proper-noun candidates from free text."""
    # If a local spaCy model is available, prefer its NER for ORGANIZATION/PERSON
    try:
        model_name = select_nlp_model()
        if model_name:
            nlp = load_spacy_model(model_name)
            if nlp is not None:
                doc = nlp(text or "")
                ents: List[str] = []
                for ent in doc.ents:
                    if ent.label_ in {"ORG", "PERSON", "GPE"}:
                        ents.append(ent.text.strip())
                if ents:
                    return _dedupe_preserve_order(ents)
    except Exception:
        # silently ignore model-load failures and fallback to heuristic
        pass

    raw = text or ""
    tokens = PROPER_NOUN_TOKEN_RE.findall(raw)

    # Quick noisy-text heuristics: if the text contains several short hex fragments
    # (common when a URL or encoded payload was pasted), bail out entirely.
    short_hex_tokens = re.findall(r"\b[0-9A-Fa-f]{1,2}\b", raw)
    if len(short_hex_tokens) >= 3:
        return []
    # common percent-encoding fragments like '2F' repeated, or pasted URLs
    if raw.count('2F') >= 2 or 'www.' in raw.lower():
        return []

    # Quick noisy-token ratio check: if the text looks dominated by encoded/url fragments,
    # skip extraction entirely to avoid spurious tags.
    noisy = 0
    for t in tokens:
        if UUID_RE.match(t) or LONG_HEX_RE.match(t) or BASE64_LIKE_RE.match(t) or HEX_PAIR_SEQ_RE.search(t) or URL_TOKEN_RE.search(t):
            noisy += 1
        elif any(ch.isdigit() for ch in t) and sum(1 for c in t if c.isalpha()) < 2:
            noisy += 1
    if tokens and (noisy / len(tokens)) > 0.35:
        return []
    phrases: List[str] = []
    current: List[str] = []

    def flush_current() -> None:
        if not current:
            return

        phrase = _normalize_proper_noun_phrase(current)
        if phrase:
            phrases.append(phrase)
        current.clear()

    index = 0
    while index < len(tokens):
        token = tokens[index]

        if _looks_like_proper_noun_word(token):
            current.append(token)
            index += 1
            continue

        if current and token.lower() in PROPER_NOUN_CONNECTORS and index + 1 < len(tokens):
            next_token = tokens[index + 1]
            if _looks_like_proper_noun_word(next_token):
                current.append(token.lower())
                index += 1
                continue

        flush_current()
        index += 1

    flush_current()

    return _dedupe_preserve_order(phrases)


def company_key(company: str) -> str:
    """Build a stable normalized key for grouping and timeline matching."""
    value = (company or "").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\b(inc|llc|ltd|co|corp|corporation|company|jobs?|careers?|team|online)\b", "", value)
    return re.sub(r"\s+", " ", value).strip()


def tag_key(label: str) -> str:
    """Build a slug-style key for display tags and client-side filtering."""
    value = (label or "").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return re.sub(r"-+", "-", value).strip("-")


def _looks_like_proper_noun_word(token: str) -> bool:
    if not token:
        return False

    # Reject tokens with obvious appended time markers or salutations
    if re.search(r"\d+(?::\d{2})?\s?(?:AM|PM)$", token, flags=re.IGNORECASE):
        return False
    if token.lower().endswith("hi") and any(c.isalpha() for c in token[:-2]):
        return False

    cleaned = token.strip("'’.-")
    # strip trailing timezone / time artifacts like '30AM', 'PDT', etc.
    cleaned = re.sub(r"(?i)(?:\b(?:PDT|EDT|EST|CST|UTC|GMT)\b)|(?:\d{1,2}(?::\d{2})?\s?(?:AM|PM))$", "", cleaned).strip()
    # Reject encoded ids, long hex/base64, UUIDs, or tokens with lots of digits/symbols
    if not cleaned:
        return False
    lowered = cleaned.lower()
    # tokens with special characters often indicate encoded fragments or ids
    if re.search(r"[<>@/\\=]", token):
        return False
    if UUID_RE.match(cleaned) or LONG_HEX_RE.match(cleaned) or BASE64_LIKE_RE.match(cleaned):
        return False
    if HEX_PAIR_SEQ_RE.search(cleaned) or URL_TOKEN_RE.search(cleaned):
        return False
    # reject tokens with small trailing hex-like fragments appended to words (eg 'Google3A')
    if re.search(r"[A-Za-z]+[0-9A-Fa-f]{1,2}$", cleaned):
        return False
    # too many digits -> likely an id; skip this check for very short tokens
    if len(cleaned) > TAG_MIN_LEN_DIGIT_CHECK:
        digit_frac = sum(1 for c in cleaned if c.isdigit()) / max(1, len(cleaned))
        if digit_frac > TAG_MAX_DIGIT_FRACTION:
            return False

    # low alphabetic fraction indicates non-word token
    alpha_frac = sum(1 for c in cleaned if c.isalpha()) / max(1, len(cleaned))
    if len(cleaned) > 2 and alpha_frac < 0.4:
        return False

    # For short tokens, require some vowels to avoid odd alphanumeric fragments
    if len(cleaned) <= 6:
        vowel_frac = sum(1 for c in cleaned.lower() if c in "aeiou") / max(1, len(cleaned))
        if vowel_frac < 0.15 and any(ch.isdigit() for ch in cleaned):
            return False

    # Detect long encoded-like tokens using entropy and vowel fraction heuristics
    if _is_likely_encoded(cleaned):
        return False
    if not cleaned:
        return False

    lowered = cleaned.lower()
    if lowered in PROPER_NOUN_STOPWORDS:
        return False

    if cleaned.isupper() and len(cleaned) > 1:
        return True

    if cleaned[0].isupper():
        return True

    return any(char.isupper() for char in cleaned[1:]) and any(char.islower() for char in cleaned)


def _normalize_proper_noun_phrase(tokens: List[str]) -> str:
    words: List[str] = []

    for token in tokens:
        lowered = token.lower()
        if lowered in PROPER_NOUN_CONNECTORS:
            words.append(lowered)
        elif token.isupper() and len(token) > 1:
            words.append(token)
        elif any(char.isupper() for char in token[1:]) and any(char.islower() for char in token):
            words.append(token)
        else:
            words.append(token[:1].upper() + token[1:].lower())

    phrase = re.sub(r"\s+", " ", " ".join(words)).strip(" \t\n\r\"'.,:;-|")
    if len(phrase) < 2:
        return ""

    if phrase.lower() in PROPER_NOUN_STOPWORDS:
        return ""

    return phrase


def _is_likely_encoded(token: str) -> bool:
    """Return True if token looks like an encoded id or random blob.

    Heuristics: token length >= TAG_ENCODED_MIN_LEN AND (high entropy OR low vowel fraction).
    """
    t = token
    if len(t) < TAG_ENCODED_MIN_LEN:
        return False

    # entropy
    counts: dict[str, int] = {}
    for ch in t:
        counts[ch] = counts.get(ch, 0) + 1
    probs = [v / len(t) for v in counts.values()]
    entropy = -sum(p * log2(p) for p in probs if p > 0)

    # vowel fraction
    vowels = sum(1 for c in t.lower() if c in "aeiou")
    vowel_frac = vowels / max(1, len(t))

    if entropy >= TAG_ENCODED_ENTROPY_THRESHOLD or vowel_frac <= TAG_ENCODED_MIN_VOWEL_FRACTION:
        return True

    return False


def _dedupe_preserve_order(values: List[str]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []

    for value in values:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            result.append(value)

    return result


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
