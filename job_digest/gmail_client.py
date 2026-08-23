"""Gmail API authentication and operations."""

from __future__ import annotations

import base64
import html
import re
from dataclasses import dataclass
from datetime import date, timedelta
from email.utils import parseaddr
from pathlib import Path
from typing import Dict, List, Optional

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import Resource, build
from googleapiclient.errors import HttpError

from config import ATS_DOMAINS, DENYLIST_SENDER_PATTERNS, DENYLIST_SUBJECT_PATTERNS, NEGATIVE_SUBJECT_TERMS, SCOPES, SEARCH_KEYWORDS


class JobDigestError(Exception):
    """Raised for user-facing recoverable failures."""


@dataclass
class ThreadLatestMessage:
    thread_id: str
    message_id: str
    internal_date_ms: int
    from_header: str
    subject: str
    snippet: str


def build_service(credentials_path: Path, token_path: Path) -> Resource:
    """Build and return an authenticated Gmail API service client."""
    if not credentials_path.exists():
        raise JobDigestError(
            "Missing credentials.json next to the script. Please follow README setup steps: "
            "create a Google Cloud OAuth Desktop app, enable Gmail API, then place credentials.json in this folder."
        )

    creds: Optional[Credentials] = None

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError:
                creds = None

        if not creds or not creds.valid:
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
            creds = flow.run_local_server(port=0)

        token_path.write_text(creds.to_json(), encoding="utf-8")

    try:
        return build("gmail", "v1", credentials=creds, cache_discovery=False)
    except HttpError as exc:
        raise JobDigestError(f"Unable to initialize Gmail API client: {exc}") from exc


def build_search_query(days: int) -> str:
    """Build one Gmail query for ATS sender and keyword signals with negative subject filter."""
    start = date.today() - timedelta(days=days)
    date_filter = start.strftime("%Y/%m/%d")

    sender_clause = "(" + " OR ".join(f"from:{domain}" for domain in ATS_DOMAINS) + ")"

    keyword_tokens: List[str] = []
    for keyword in SEARCH_KEYWORDS:
        keyword_tokens.append(f'subject:"{keyword}"')
        keyword_tokens.append(f'"{keyword}"')
    keyword_clause = "(" + " OR ".join(keyword_tokens) + ")"

    negative_clause = " ".join(f'-subject:"{term}"' for term in NEGATIVE_SUBJECT_TERMS)

    return f"after:{date_filter} ({sender_clause} OR {keyword_clause}) {negative_clause}".strip()


def search_thread_ids(service: Resource, query: str) -> List[str]:
    """Search and paginate all matching Gmail thread IDs."""
    user_id = "me"
    next_page_token: Optional[str] = None
    found_ids: List[str] = []
    seen: set[str] = set()

    while True:
        response = (
            service.users()
            .threads()
            .list(userId=user_id, q=query, maxResults=100, pageToken=next_page_token)
            .execute()
        )

        for thread in response.get("threads", []):
            thread_id = thread.get("id")
            if thread_id and thread_id not in seen:
                seen.add(thread_id)
                found_ids.append(thread_id)

        next_page_token = response.get("nextPageToken")
        if not next_page_token:
            break

    return found_ids


def get_latest_message_metadata(service: Resource, thread_id: str) -> Optional[ThreadLatestMessage]:
    """Fetch only metadata for the latest message in a thread."""
    response = (
        service.users()
        .threads()
        .get(
            userId="me",
            id=thread_id,
            format="metadata",
            metadataHeaders=["From", "Subject"],
            fields="id,messages(id,internalDate,snippet,payload/headers)",
        )
        .execute()
    )

    messages = response.get("messages", [])
    if not messages:
        return None

    latest = max(messages, key=lambda msg: int(msg.get("internalDate", "0") or "0"))
    headers = _headers_to_dict(latest.get("payload", {}).get("headers", []))

    return ThreadLatestMessage(
        thread_id=thread_id,
        message_id=latest.get("id", ""),
        internal_date_ms=int(latest.get("internalDate", "0") or "0"),
        from_header=headers.get("from", ""),
        subject=headers.get("subject", "(No subject)"),
        snippet=latest.get("snippet", ""),
    )


def is_denylisted(from_header: str, subject: str) -> bool:
    """Post-filter likely non-employer noise sources using sender/subject patterns."""
    display_name, sender_addr = parseaddr(from_header or "")
    sender_domain = sender_addr.split("@", 1)[1].lower() if "@" in sender_addr else ""

    haystack = " ".join([display_name or "", sender_addr or "", sender_domain or "", subject or ""]).lower()

    for pattern in DENYLIST_SENDER_PATTERNS:
        if re.search(pattern, haystack, flags=re.IGNORECASE):
            return True

    for pattern in DENYLIST_SUBJECT_PATTERNS:
        if re.search(pattern, subject or "", flags=re.IGNORECASE):
            return True

    return False


def get_plaintext_body(service: Resource, message_id: str) -> str:
    """Fetch the full message and return a plaintext body approximation."""
    message = (
        service.users()
        .messages()
        .get(userId="me", id=message_id, format="full", fields="id,payload")
        .execute()
    )

    payload = message.get("payload", {})
    plain = _extract_mime_part(payload, "text/plain")
    if plain:
        return plain

    html_body = _extract_mime_part(payload, "text/html")
    if html_body:
        return _strip_html(html_body)

    return ""


def _headers_to_dict(headers: List[Dict[str, str]]) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for header in headers:
        name = (header.get("name") or "").lower()
        value = header.get("value") or ""
        if name:
            result[name] = value
    return result


def _extract_mime_part(payload: Dict[str, object], target_mime: str) -> str:
    mime_type = (payload.get("mimeType") or "").lower()

    if mime_type == target_mime:
        data = _extract_body_data(payload)
        if data:
            return data

    for part in payload.get("parts", []) or []:
        nested = _extract_mime_part(part, target_mime)
        if nested:
            return nested

    return ""


def _extract_body_data(payload: Dict[str, object]) -> str:
    body = payload.get("body", {}) or {}
    data = body.get("data")
    if not data:
        return ""

    try:
        decoded = base64.urlsafe_b64decode(data.encode("utf-8"))
        return decoded.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _strip_html(value: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", value)
    collapsed = re.sub(r"\s+", " ", html.unescape(no_tags)).strip()
    return collapsed
