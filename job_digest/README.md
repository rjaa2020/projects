# Job Application Digest Generator

Generate an HTML digest of recent job-application activity from Gmail.

## What it does

- Scans Gmail for job-application activity in a configurable lookback window.
- Classifies each application thread using the latest message only.
- Writes a self-contained `digest.html` file.
- Reads Gmail only; it does not send mail.

## Setup

1. Create or select a project at https://console.cloud.google.com/.
2. Enable **Gmail API** in APIs & Services -> Library.
3. Configure OAuth consent screen as **External** and add your Gmail address as a test user.
4. Create OAuth credentials with application type **Desktop app**.
5. Download the JSON and save it as `credentials.json` in this folder.
6. Create a virtual environment in this folder:

```powershell
python -m venv .venv
```

7. Activate it:

Windows (PowerShell):

```powershell
.venv\Scripts\Activate.ps1
```

8. Install dependencies:

```powershell
pip install --upgrade -r requirements.txt
```

9. Run once to authorize:

```powershell
python job_digest.py --days 30
```

The first run opens a browser for consent and creates `token.json` in this folder.

## Usage

```powershell
python job_digest.py [--days N]
```

- `--days N`: lookback window in days (default `30`)

You can also run it without activating by calling the venv interpreter directly:

```powershell
.venv\Scripts\python.exe job_digest.py --days 30
```

## Run unit tests

```powershell
python -m unittest discover -s tests -v
```

## Notes

- Classification is keyword-based and best-effort. The digest includes message excerpt context for quick review.
- Runtime logs are written to `job_digest.log` and trimmed to the last 3 MB.
- If `credentials.json` is missing, the script exits with setup guidance.

## Output files

- `digest.html`: generated digest output
- `job_digest.log`: runtime log file, capped at the last 3 MB
- `token.json`: cached OAuth token
