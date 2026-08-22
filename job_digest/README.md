# Job Application Digest Generator

Generate an HTML digest of recent job-application activity from Gmail and optionally email it.

## What it does

- Scans Gmail for job-application activity in a configurable lookback window.
- Classifies each application thread using the latest message only.
- Writes a self-contained `digest.html` file.
- Optionally emails the digest via Gmail API.

## Setup

1. Create or select a project at https://console.cloud.google.com/
2. Enable **Gmail API** in APIs & Services -> Library.
3. Configure OAuth consent screen:
   - User type: External
   - Add your own Gmail address as a test user
4. Create OAuth credentials:
   - APIs & Services -> Credentials -> Create credentials -> OAuth client ID
   - Application type: **Desktop app**
5. Download the JSON and save it as `credentials.json` in this folder.
6. Create a dedicated virtual environment in this folder:

```bash
python3 -m venv .venv
```

7. Activate it:

macOS/Linux:

```bash
source .venv/bin/activate
```

Windows (PowerShell):

```powershell
.venv\\Scripts\\Activate.ps1
```

8. Install dependencies:

```bash
pip install --upgrade -r requirements.txt
```

9. Run once to authorize:

```bash
python job_digest.py --days 30
```

The first run opens a browser for consent and creates `token.json` in this folder.

## Usage

```bash
python job_digest.py [--days N] [--no-send] [--to EMAIL]
```

- `--days N`: lookback window in days (default `30`)
- `--no-send`: only save `digest.html`; do not send email
- `--to EMAIL`: send to this recipient; default is authenticated account

You can also run commands without activating by calling the venv interpreter directly:

macOS/Linux:

```bash
./.venv/bin/python job_digest.py --days 30 --no-send
```

Windows:

```powershell
.venv\\Scripts\\python.exe job_digest.py --days 30 --no-send
```

## Run unit tests

```bash
python -m unittest discover -s tests -v
```

## Notes

- The tool reads Gmail data and sends one digest email; it does not modify labels or message read status.
- Classification is keyword-based and best-effort. The digest includes message excerpt context for quick review.
- If `credentials.json` is missing, the script exits with setup guidance.

## Output files

- `digest.html`: generated digest output
- `token.json`: cached OAuth token
