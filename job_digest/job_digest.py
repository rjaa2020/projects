#!/usr/bin/env python3
"""
Job Application Digest Generator

Setup:
1. Create/select a Google Cloud project: https://console.cloud.google.com/
2. Enable Gmail API: APIs & Services -> Library -> Gmail API
3. Configure OAuth consent screen (External), and add your Gmail as a test user
4. Create OAuth client ID of type Desktop app
5. Download client JSON as credentials.json in this folder
6. Install deps:
   pip install --upgrade google-api-python-client google-auth-httplib2 google-auth-oauthlib
7. Run:
   python job_digest.py --days 30

Usage:
    python job_digest.py [--days N]
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List

from googleapiclient.errors import HttpError

from classify import classify_status, company_key, extract_company_name, extract_proper_noun_phrases, is_noise_company, tag_key
from config import ATS_DOMAINS
from gmail_client import (
    JobDigestError,
    build_search_query,
    build_service,
    get_latest_message_metadata,
    get_plaintext_body,
    is_denylisted,
    search_thread_ids,
)
from render import format_portable_date, render_digest_html

LOG_FILENAME = "job_digest.log"
LOG_MAX_BYTES = 3 * 1024 * 1024
COMMON_TAG_MIN_COUNT = 2
MAX_TAGS_TOTAL = 18


def _configure_logging(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("job_digest")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def _trim_log_file(log_path: Path, max_bytes: int = LOG_MAX_BYTES) -> None:
    if not log_path.exists():
        return

    raw = log_path.read_bytes()
    if len(raw) <= max_bytes:
        return

    trimmed = raw[-max_bytes:]
    log_path.write_text(trimmed.decode("utf-8", errors="ignore"), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a Gmail-based job application digest.")
    parser.add_argument("--days", type=int, default=30, help="Lookback window in days (default: 30)")
    return parser.parse_args()


def to_utc_datetime(epoch_ms: int) -> datetime:
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)


def build_entries(service, days: int, logger: logging.Logger | None = None) -> List[Dict[str, object]]:
    query = build_search_query(days)
    thread_ids = search_thread_ids(service, query)

    if logger:
        logger.info("Searching Gmail with query: %s", query)
        logger.info("Found %d candidate threads", len(thread_ids))

    entries: List[Dict[str, object]] = []

    for thread_id in thread_ids:
        latest = get_latest_message_metadata(service, thread_id)
        if not latest or not latest.message_id:
            if logger:
                logger.info("Skipped thread %s: missing latest message metadata", thread_id)
            continue

        if is_denylisted(latest.from_header, latest.subject):
            if logger:
                logger.info(
                    "Skipped thread %s (%s): denylisted sender or subject",
                    thread_id,
                    latest.subject,
                )
            continue

        body_text = get_plaintext_body(service, latest.message_id)
        status = classify_status(latest.subject, latest.snippet, body_text)
        company = extract_company_name(latest.subject, latest.from_header, ATS_DOMAINS)

        if is_noise_company(company, latest.subject, latest.from_header):
            if logger:
                logger.info(
                    "Skipped thread %s (%s): noisy company match %s",
                    thread_id,
                    latest.subject,
                    company,
                )
            continue

        message_dt = to_utc_datetime(latest.internal_date_ms)
        excerpt_source = body_text.strip() or latest.snippet.strip()
        excerpt = excerpt_source[:300] + ("..." if len(excerpt_source) > 300 else "")
        company_sort_key = company_key(company)

        entries.append(
            {
                "thread_id": latest.thread_id,
                "company": company,
                "company_key": company_sort_key,
                "status": status,
                "subject": latest.subject,
                "excerpt": excerpt,
                "date": message_dt,
                "date_label": format_portable_date(message_dt),
                "tag_keys": [],
                "tag_labels": [],
                "raw_text": " ".join([company, latest.subject, latest.snippet, body_text, latest.from_header]),
            }
        )

        if logger:
            logger.info("Kept thread %s -> %s [%s]", thread_id, company, status)

    _assign_proper_noun_tags(entries)
    entries.sort(key=lambda item: (str(item.get("company_key", "")), item["date"]))

    if logger:
        logger.info("Built %d digest entries", len(entries))
    return entries


def _assign_proper_noun_tags(entries: List[Dict[str, object]], max_tags: int = MAX_TAGS_TOTAL) -> None:
    tag_counts: Counter[str] = Counter()
    tag_labels: Dict[str, str] = {}
    entry_candidates: List[List[tuple[str, str]]] = []

    for entry in entries:
        raw_text = str(entry.get("raw_text", ""))
        candidates: List[tuple[str, str]] = []
        seen: set[str] = set()

        for phrase in extract_proper_noun_phrases(raw_text):
            normalized = tag_key(phrase)
            if not normalized or normalized in seen or _is_generic_tag(phrase):
                continue

            seen.add(normalized)
            candidates.append((normalized, phrase))
            tag_counts[normalized] += 1
            tag_labels.setdefault(normalized, phrase)

        entry_candidates.append(candidates)

    ranked_keys = [key for key, count in tag_counts.most_common() if count >= COMMON_TAG_MIN_COUNT]
    if not ranked_keys:
        ranked_keys = [key for key, _ in tag_counts.most_common(max_tags)]

    allowed = set(ranked_keys[:max_tags])

    for entry, candidates in zip(entries, entry_candidates):
        keys: List[str] = []
        labels: List[str] = []

        for normalized, phrase in candidates:
            if normalized not in allowed or normalized in keys:
                continue

            keys.append(normalized)
            labels.append(tag_labels.get(normalized, phrase))

        if not keys:
            fallback_key = str(entry.get("company_key", "")).strip()
            fallback_label = str(entry.get("company", "")).strip()
            if fallback_key and fallback_label:
                keys = [fallback_key]
                labels = [fallback_label]

        entry["tag_keys"] = keys
        entry["tag_labels"] = labels
        entry.pop("raw_text", None)


def _is_generic_tag(value: str) -> bool:
    lowered = value.strip().lower()
    if not lowered:
        return True

    return lowered in {
        "application",
        "applying",
        "candidate",
        "candidates",
        "complete",
        "email",
        "gmail",
        "google",
        "interview",
        "job",
        "jobs",
        "meet",
        "meeting",
        "next steps",
        "opportunity",
        "opportunities",
        "please",
        "recruiting",
        "security",
        "team",
        "thank you",
        "thanks",
        "update",
        "zoom",
    }


def count_statuses(entries: List[Dict[str, object]]) -> Dict[str, int]:
    counts: Dict[str, int] = {"rejected": 0, "interview": 0, "action": 0, "submitted": 0}
    for entry in entries:
        status = str(entry.get("status", "submitted"))
        if status in counts:
            counts[status] += 1
        else:
            counts["submitted"] += 1
    return counts


def run(logger: logging.Logger | None = None) -> int:
    args = parse_args()

    if args.days <= 0:
        print("Error: --days must be a positive integer.", file=sys.stderr)
        return 2

    if logger:
        logger.info("Starting digest generation for the last %d days", args.days)

    script_dir = Path(__file__).resolve().parent
    credentials_path = script_dir / "credentials.json"
    token_path = script_dir / "token.json"
    digest_path = script_dir / "digest.html"

    service = build_service(credentials_path, token_path)
    entries = build_entries(service, args.days, logger=logger)
    counts = count_statuses(entries)

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=args.days)
    generated_at = datetime.now(timezone.utc)

    html = render_digest_html(entries, counts, start_date, end_date, generated_at)
    digest_path.write_text(html, encoding="utf-8")
    print(f"Saved digest to {digest_path}")

    if logger:
        logger.info("Saved digest to %s", digest_path)
        logger.info("Status counts: %s", counts)

    return 0


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    log_path = script_dir / LOG_FILENAME
    logger = _configure_logging(log_path)

    try:
        exit_code = run(logger=logger)
    except JobDigestError as exc:
        logger.exception("Job digest failed: %s", exc)
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except HttpError as exc:
        logger.exception("Gmail API request failed: %s", exc)
        print(f"Error: Gmail API request failed: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        logger.exception("Unexpected failure: %s", exc)
        print(f"Error: Unexpected failure: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        logging.shutdown()
        _trim_log_file(log_path)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
