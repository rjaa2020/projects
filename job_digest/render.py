"""HTML rendering for the job application digest.

This implementation builds the page in discrete parts. The embedded JavaScript
is included as a plain Python string (not an f-string) so its braces do not
need escaping.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from html import escape
from typing import Dict, List, Tuple

from config import STATUS_COLORS, STATUS_LABELS


def format_portable_date(dt: datetime) -> str:
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
    runtime_info: Dict[str, object] | None = None,
) -> str:
    status_index = _collect_status_index(counts)
    tag_index = _collect_tag_index(entries)

    stats_html = "".join(
        [
            _render_stat_cell("Rejected", counts.get("rejected", 0), STATUS_COLORS["rejected"]),
            _render_stat_cell("Interview", counts.get("interview", 0), STATUS_COLORS["interview"]),
            _render_stat_cell("Action Needed", counts.get("action", 0), STATUS_COLORS["action"]),
            _render_stat_cell("Submitted", counts.get("submitted", 0), STATUS_COLORS["submitted"]),
        ]
    )

    if entries:
        cards_html = "".join(_render_company_section(company, company_entries) for company, company_entries in _group_entries(entries))
    else:
        cards_html = (
            '<tr><td style="padding:20px;border:1px solid #E5E7EB;border-radius:10px;' 
            '" bgcolor="#FFFFFF">No matching application activity found in this window.</td></tr>'
        )

    generated_label = format_portable_date(generated_at.astimezone(timezone.utc))
    # Top-line runtime/model summary
    gen_time_label = generated_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    top_model = "(none)"
    if runtime_info:
      top_model = runtime_info.get("selected_model") or "(none)"
    runtime_label = ""
    if runtime_info:
        model = runtime_info.get("selected_model") or "(none)"
        plat = runtime_info.get("platform", "")
        machine = runtime_info.get("machine", "")
        cpus = runtime_info.get("cpu_count")
        mem = runtime_info.get("total_mem_gb")
        gpu = runtime_info.get("has_gpu")
        parts = [f"Model: {model}"]
        if plat or machine:
            parts.append(f"Platform: {plat} {machine}".strip())
        if cpus:
            parts.append(f"CPUs: {cpus}")
        if mem:
            parts.append(f"Mem: {round(mem,1)} GB")
        parts.append(f"GPU: {'Yes' if gpu else 'No'}")
        runtime_label = " · " + " | ".join(parts)

    # Header and body up to the interactive script
    header = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Job Application Digest</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      background: linear-gradient(180deg, #EDEFF5 0%, #F8FAFC 100%);
      font-family: Helvetica, Arial, sans-serif;
      color: #111827;
    }}
    .app-shell {{
      width: 100%;
      padding: 24px 12px;
      box-sizing: border-box;
    }}
    .app-frame {{
      width: 100%;
      max-width: 960px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.12);
    }}
    .filter-bar {{
      padding: 16px 24px 4px 24px;
    }}
    .filter-group {{
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }}
    .filter-label {{
      font-size: 12px;
      font-weight: 700;
      color: #475467;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-right: 4px;
    }}
    .filter-chip,
    .tag-chip {{
      border: 1px solid #CBD5E1;
      background: #FFFFFF;
      color: #0F172A;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }}
    .filter-chip.active {{
      background: #0F172A;
      color: #FFFFFF;
      border-color: #0F172A;
    }}
    .filter-chip:hover,
    .tag-chip:hover {{
      border-color: #64748B;
    }}
    .tag-chip {{
      padding: 5px 10px;
      margin: 0 6px 6px 0;
      background: #F8FAFC;
    }}
    .company-card.is-hidden,
    .entry-row.is-hidden {{
      display: none !important;
    }}
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="app-frame">
      <div style="padding:24px 24px 14px 24px;background:linear-gradient(135deg,#0F172A,#1D4ED8);color:#FFFFFF;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;">Job Application Digest</h1>
        <p style="margin:8px 0 0 0;font-size:14px;opacity:0.95;">Coverage: {escape(format_date_range(range_start, range_end))}</p>
        <p style="margin:6px 0 0 0;font-size:12px;opacity:0.9;">Model: {escape(str(top_model))} · Generated: {escape(gen_time_label)}</p>
      </div>

      <div class="filter-bar" aria-label="Filters">
        <div class="filter-group" aria-label="Filter by status">
          <span class="filter-label">Status</span>
          <button class="filter-chip active" type="button" data-filter-group="status" data-filter-key="all">All</button>
          {''.join(_render_filter_chip(tag_key, tag_label, 'status') for tag_key, tag_label in status_index)}
        </div>
        <div class="filter-group" aria-label="Filter by tag">
          <span class="filter-label">Tags</span>
          <button class="filter-chip active" type="button" data-filter-group="tag" data-filter-key="all">All</button>
          {''.join(_render_filter_chip(tag_key, tag_label, 'tag') for tag_key, tag_label in tag_index)}
        </div>
      </div>

      <div style="padding:12px 24px 4px 24px;">
        <table role="presentation" width="100%" cellpadding="8" cellspacing="0" border="0">
          <tr>
            {stats_html}
          </tr>
        </table>
      </div>

      <div style="padding:8px 24px 20px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 12px;">
          {cards_html}
        </table>
      </div>

      <div style="padding:14px 24px 20px 24px;border-top:1px solid #E5E7EB;color:#4B5563;font-size:12px;line-height:1.5;">
        Generated on {escape(generated_label)} (UTC). Click a status or tag to filter the dashboard.{escape(runtime_label)}
      </div>
    </div>
  </div>
"""

    # Interactive JavaScript (plain raw string so backslashes are preserved)
    js = r"""
  <script>
    (function () {
      const filterButtons = Array.from(document.querySelectorAll('[data-filter-key]'));
      const companyCards = Array.from(document.querySelectorAll('[data-company-card]'));
      const activeFilters = { status: 'all', tag: 'all' };

      function parseTags(value) {
        return (value || '').split(/\s+/).filter(Boolean);
      }

      function tokenSetFromTagKey(tagKey) {
        return (tagKey || '').split(/[-_]+/).filter(Boolean).map(t => t.toLowerCase());
      }

      function jaccard(a, b) {
        const setA = new Set(a);
        const setB = new Set(b);
        const inter = Array.from(setA).filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union === 0 ? 0 : inter / union;
      }

      function setActiveFilter(group, filterKey) {
        activeFilters[group] = filterKey;

        filterButtons.forEach((button) => {
          if (button.dataset.filterGroup === group) {
            button.classList.toggle('active', button.dataset.filterKey === filterKey);
          }
        });

        companyCards.forEach((card) => {
          const entryRows = Array.from(card.querySelectorAll('[data-entry-row]'));
          let visibleRowCount = 0;

          entryRows.forEach((row) => {
            const tags = parseTags(row.dataset.tags);
            const statusMatches = activeFilters.status === 'all' || row.dataset.statusKey === activeFilters.status;
            let tagMatches = false;

            if (activeFilters.tag === 'all') {
              tagMatches = true;
            } else {
              const clickedTokens = tokenSetFromTagKey(activeFilters.tag);
              for (const t of tags) {
                if (!t) continue;
                if (t === activeFilters.tag) { tagMatches = true; break; }
                const tTokens = tokenSetFromTagKey(t);
                if (clickedTokens.length === 1 && tTokens.includes(clickedTokens[0])) { tagMatches = true; break; }
                if (tTokens.length === 1 && clickedTokens.some(ct => tTokens.includes(ct))) { tagMatches = true; break; }
                if (jaccard(clickedTokens, tTokens) >= 0.75) { tagMatches = true; break; }
              }
            }

            const matches = statusMatches && tagMatches;
            row.classList.toggle('is-hidden', !matches);
            if (matches) {
              visibleRowCount += 1;
            }
          });

          card.classList.toggle('is-hidden', visibleRowCount === 0);
        });
      }

      filterButtons.forEach((button) => {
        button.addEventListener('click', () => setActiveFilter(button.dataset.filterGroup || 'tag', button.dataset.filterKey || 'all'));
      });

      setActiveFilter('status', 'all');
      setActiveFilter('tag', 'all');
    })();
  </script>
</body>
</html>
"""

    return header + js


def _render_stat_cell(label: str, value: int, color: str) -> str:
    return (
        f'<td width="25%" align="center" style="border:1px solid #E5E7EB;border-radius:10px;" bgcolor="#FFFFFF">'
        f'<div style="font-size:13px;color:#6B7280;margin-top:4px;">{escape(label)}</div>'
        f'<div style="font-size:24px;font-weight:700;color:{escape(color)};margin:4px 0 8px 0;">{value}</div>'
        "</td>"
    )


def _collect_status_index(counts: Dict[str, int]) -> List[Tuple[str, str]]:
    return [
        ("rejected", f"Rejected ({counts.get('rejected', 0)})"),
        ("interview", f"Interview ({counts.get('interview', 0)})"),
        ("action", f"Action Needed ({counts.get('action', 0)})"),
        ("submitted", f"Submitted ({counts.get('submitted', 0)})"),
    ]


def _entry_tag_pairs(entry: Dict[str, object]) -> List[Tuple[str, str]]:
    keys, labels = _entry_tag_lists(entry)
    return list(zip(keys, labels))


def _collect_tag_index(entries: List[Dict[str, object]]) -> List[Tuple[str, str]]:
    tag_map: Dict[str, str] = {}

    for entry in entries:
        for key, label in _entry_tag_pairs(entry):
            if key and label and str(label).strip() and key not in tag_map:
                tag_map[key] = label

    return sorted(tag_map.items(), key=lambda item: item[1].lower())


def _render_filter_chip(tag_key: str, tag_label: str, group: str) -> str:
    return (
        f'<button class="filter-chip" type="button" data-filter-group="{escape(group)}" '
        f'data-filter-key="{escape(tag_key)}">{escape(tag_label)}</button>'
    )


def _group_entries(entries: List[Dict[str, object]]) -> List[Tuple[str, List[Dict[str, object]]]]:
    grouped: List[Tuple[str, List[Dict[str, object]]]] = []
    current_key = None
    current_entries: List[Dict[str, object]] = []

    for entry in entries:
        company_key = str(entry.get("company_key", ""))
        if current_key is None or company_key != current_key:
            if current_entries:
                grouped.append((str(current_entries[0].get("company", "Unknown Company")), current_entries))
            current_key = company_key
            current_entries = [entry]
        else:
            current_entries.append(entry)

    if current_entries:
        grouped.append((str(current_entries[0].get("company", "Unknown Company")), current_entries))

    return grouped


def _render_company_section(company: str, entries: List[Dict[str, object]]) -> str:
    first_date = entries[0].get("date_label", "")
    last_date = entries[-1].get("date_label", "")
    section_rows = "".join(_render_entry_row(entry) for entry in entries)
    section_tags = _collect_section_tags(entries)
    tag_chips = "".join(_render_tag_chip(tag_key, tag_label) for tag_key, tag_label in section_tags)
    data_tags = " ".join(tag_key for tag_key, _ in section_tags)

    return f"""
<tr class="company-card" data-company-card data-tags="{escape(data_tags)}">
  <td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #D1D5DB;border-radius:12px;overflow:hidden;background-color:#FFFFFF;">
      <tr>
        <td style="padding:14px 16px 12px 16px;background-color:#F9FAFB;border-bottom:1px solid #E5E7EB;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:18px;font-weight:700;color:#111827;">{escape(company)}</td>
              <td align="right" style="font-size:12px;color:#6B7280;">{escape(str(len(entries)))} updates{_render_company_dates(first_date, last_date)}</td>
            </tr>
          </table>
          <div style="margin-top:10px;">{tag_chips}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 12px 4px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 10px;">
            {section_rows}
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
"""


def _collect_section_tags(entries: List[Dict[str, object]]) -> List[Tuple[str, str]]:
    section_map: Dict[str, str] = {}

    for entry in entries:
        for key, label in _entry_tag_pairs(entry):
            if key and label and str(label).strip():
                section_map.setdefault(key, label)

    return sorted(section_map.items(), key=lambda item: item[1].lower())


def _render_tag_chip(tag_key: str, tag_label: str) -> str:
    return f'<button class="tag-chip" type="button" data-filter-group="tag" data-filter-key="{escape(tag_key)}">{escape(tag_label)}</button>'


def _render_company_dates(first_date: object, last_date: object) -> str:
    if first_date == last_date:
        return f" &middot; {escape(str(first_date))}"
    return f" &middot; {escape(str(first_date))} – {escape(str(last_date))}"


def _render_entry_row(entry: Dict[str, object]) -> str:
    date_label = escape(str(entry.get("date_label", "")))
    status = escape(str(entry.get("status", "submitted")))
    subject = escape(str(entry.get("subject", "")))
    excerpt = escape(str(entry.get("excerpt", "")))
    tags = " ".join(entry.get("tag_keys", []))
    return (
        f'<tr class="entry-row" data-entry-row data-status-key="{escape(status)}" data-tags="{escape(tags)}">'
        f'<td style="padding:12px 12px;background:#FFFFFF;">'
        f'<div style="font-size:13px;color:#6B7280;">{date_label} &middot; {STATUS_LABELS.get(status, status)}</div>'
        f'<div style="font-size:15px;font-weight:700;color:#111827;margin-top:6px;">{subject}</div>'
        f'<div style="font-size:13px;color:#374151;margin-top:6px;">{excerpt}</div>'
        "</td></tr>"
    )


def _entry_tag_lists(entry: Dict[str, object]) -> Tuple[List[str], List[str]]:
    keys = list(entry.get("tag_keys", [])) if entry.get("tag_keys") else []
    labels = list(entry.get("tag_labels", [])) if entry.get("tag_labels") else []
    return keys, labels
