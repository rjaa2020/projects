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
  python job_digest.py [--days N] [--no-send] [--to EMAIL]
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List

from googleapiclient.errors import HttpError

from classify import classify_status, extract_company_name
from config import ATS_DOMAINS
from gmail_client import (
    JobDigestError,
    build_search_query,
    build_service,
    get_authenticated_email,
    get_latest_message_metadata,
    get_plaintext_body,
    is_denylisted,
    search_thread_ids,
    send_digest_email,
)
from render import format_portable_date, render_digest_html


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate and optionally email a Gmail-based job application digest.")
    parser.add_argument("--days", type=int, default=30, help="Lookback window in days (default: 30)")
    parser.add_argument("--no-send", action="store_true", help="Only write digest.html and do not send email")
    parser.add_argument("--to", type=str, default="", help="Recipient email. Defaults to authenticated account")
    return parser.parse_args()


def to_utc_datetime(epoch_ms: int) -> datetime:
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)


def build_entries(service, days: int) -> List[Dict[str, object]]:
    query = build_search_query(days)
    thread_ids = search_thread_ids(service, query)

    entries: List[Dict[str, object]] = []

    for thread_id in thread_ids:
        latest = get_latest_message_metadata(service, thread_id)
        if not latest or not latest.message_id:
            continue

        if is_denylisted(latest.from_header, latest.subject):
            continue

        body_text = get_plaintext_body(service, latest.message_id)
        status = classify_status(latest.subject, latest.snippet, body_text)
        company = extract_company_name(latest.subject, latest.from_header, ATS_DOMAINS)

        message_dt = to_utc_datetime(latest.internal_date_ms)
        excerpt_source = body_text.strip() or latest.snippet.strip()
        excerpt = excerpt_source[:300] + ("..." if len(excerpt_source) > 300 else "")

        entries.append(
            {
                "thread_id": latest.thread_id,
                "company": company,
                "status": status,
                "subject": latest.subject,
                "excerpt": excerpt,
                "date": message_dt,
                "date_label": format_portable_date(message_dt),
            }
        )

    entries.sort(key=lambda item: item["date"], reverse=True)
    return entries


def count_statuses(entries: List[Dict[str, object]]) -> Dict[str, int]:
    counts: Dict[str, int] = {"rejected": 0, "interview": 0, "action": 0, "submitted": 0}
    for entry in entries:
        status = str(entry.get("status", "submitted"))
        if status in counts:
            counts[status] += 1
        else:
            counts["submitted"] += 1
    return counts


def run() -> int:
    args = parse_args()

    if args.days <= 0:
        print("Error: --days must be a positive integer.", file=sys.stderr)
        return 2

    script_dir = Path(__file__).resolve().parent
    credentials_path = script_dir / "credentials.json"
    token_path = script_dir / "token.json"
    digest_path = script_dir / "digest.html"

    service = build_service(credentials_path, token_path)
    entries = build_entries(service, args.days)
    counts = count_statuses(entries)

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=args.days)
    generated_at = datetime.now(timezone.utc)

    html = render_digest_html(entries, counts, start_date, end_date, generated_at)
    digest_path.write_text(html, encoding="utf-8")
    print(f"Saved digest to {digest_path}")

    if not args.no_send:
        to_email = args.to.strip() if args.to else get_authenticated_email(service)
        subject = f"Job Application Digest ({args.days}-day lookback)"
        send_digest_email(service, to_email, subject, html)
        print(f"Sent digest email to {to_email}")

    return 0


def main() -> None:
    try:
        exit_code = run()
    except JobDigestError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except HttpError as exc:
        print(f"Error: Gmail API request failed: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"Error: Unexpected failure: {exc}", file=sys.stderr)
        sys.exit(1)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
