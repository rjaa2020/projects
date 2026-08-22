"""HTML rendering for the job application digest."""

from __future__ import annotations

from datetime import date, datetime, timezone
from html import escape
from typing import Dict, List

from config import STATUS_COLORS, STATUS_LABELS


def format_portable_date(dt: datetime) -> str:
    """Render a day without platform-specific strftime modifiers."""
    months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ]
    return f"{months[dt.month - 1]} {dt.day}, {dt.year}"


def format_date_range(start: date, end: date) -> str:
    start_dt = datetime(start.year, start.month, start.day)
    end_dt = datetime(end.year, end.month, end.day)
    return f"{format_portable_date(start_dt)} to {format_portable_date(end_dt)}"


def render_digest_html(
    entries: List[Dict[str, object]],
    counts: Dict[str, int],
    range_start: date,
    range_end: date,
    generated_at: datetime,
) -> str:
    """Render a self-contained table-based HTML digest."""
    stats_html = "".join(
        [
            _render_stat_cell("Rejected", counts.get("rejected", 0), STATUS_COLORS["rejected"]),
            _render_stat_cell("Interview", counts.get("interview", 0), STATUS_COLORS["interview"]),
            _render_stat_cell("Action Needed", counts.get("action", 0), STATUS_COLORS["action"]),
            _render_stat_cell("Submitted", counts.get("submitted", 0), STATUS_COLORS["submitted"]),
        ]
    )

    if entries:
        rows_html = "".join(_render_entry_row(entry) for entry in entries)
    else:
        rows_html = (
            '<tr><td style="padding:20px;border:1px solid #E5E7EB;border-radius:10px;" '
            'bgcolor="#FFFFFF">No matching application activity found in this window.</td></tr>'
        )

    generated_label = format_portable_date(generated_at.astimezone(timezone.utc))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Job Application Digest</title>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F4F6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="700" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:700px;background-color:#FFFFFF;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:24px 24px 12px 24px;background:linear-gradient(135deg,#0F172A,#1D4ED8);color:#FFFFFF;">
              <h1 style="margin:0;font-size:26px;line-height:1.2;">Job Application Digest</h1>
              <p style="margin:10px 0 0 0;font-size:14px;opacity:0.95;">Coverage: {escape(format_date_range(range_start, range_end))}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 4px 24px;">
              <table role="presentation" width="100%" cellpadding="8" cellspacing="0" border="0">
                <tr>
                  {stats_html}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 12px;">
                {rows_html}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px 20px 24px;border-top:1px solid #E5E7EB;color:#4B5563;font-size:12px;line-height:1.5;">
              Generated on {escape(generated_label)} (UTC). Statuses are inferred from email text and may be imprecise.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _render_stat_cell(label: str, value: int, color: str) -> str:
    return (
        f'<td width="25%" align="center" style="border:1px solid #E5E7EB;border-radius:10px;" bgcolor="#FFFFFF">'
        f'<div style="font-size:13px;color:#6B7280;margin-top:4px;">{escape(label)}</div>'
        f'<div style="font-size:24px;font-weight:700;color:{escape(color)};margin:4px 0 8px 0;">{value}</div>'
        "</td>"
    )


def _render_entry_row(entry: Dict[str, object]) -> str:
    status = str(entry.get("status", "submitted"))
    badge_color = STATUS_COLORS.get(status, "#027A48")
    badge_label = STATUS_LABELS.get(status, "Submitted")

    company = escape(str(entry.get("company", "Unknown Company")))
    date_label = escape(str(entry.get("date_label", "")))
    subject = escape(str(entry.get("subject", "(No subject)")))
    excerpt = escape(str(entry.get("excerpt", "")))

    return f"""
<tr>
  <td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;background-color:#FFFFFF;">
      <tr>
        <td style="padding:14px 16px 10px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:18px;font-weight:700;color:#111827;">{company}</td>
              <td align="right" style="font-size:12px;color:#6B7280;">{date_label}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 8px 16px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:{badge_color};color:#FFFFFF;font-size:12px;font-weight:700;">{badge_label}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 8px 16px;font-size:14px;color:#111827;font-weight:600;line-height:1.4;">{subject}</td>
      </tr>
      <tr>
        <td style="padding:0 16px 16px 16px;font-size:13px;color:#4B5563;line-height:1.45;">{excerpt}</td>
      </tr>
    </table>
  </td>
</tr>
"""
