# Woodshed Note Trainer

Woodshed uses one Python engine for all chord logic.

- `woodshed` package: music theory + quiz engine (single source of truth)
- Python API: exposes engine via HTTP
- Node web app: GUI only, calls the Python API

## Install (local)

```bash
pip install -e .
```

## Run

```bash
woodshed --rounds 10 --types maj7 7 min7 m7b5 dim7
```

You can also run:

```bash
python main.py --rounds 10
```

## Run Python API

```bash
pip install -e .[web]
python -m woodshed.api
```

API base URL: `http://127.0.0.1:8000`

## Test

```bash
pip install -e .[test]
pytest
```

## Build for PyPI

```bash
python -m build
```

This creates distributable files in `dist/`.

## Web GUI (Node.js)

The Node.js web server only renders UI and calls the Python API.

```bash
cd web
npm install
npm start
```

Then open http://localhost:3000 in your browser.

Or from the `Woodshed` root:

```bash
npm run web:install
npm run web
```

If your API runs elsewhere, set a custom API URL:

```bash
set WOODSHED_API_URL=http://127.0.0.1:8000
npm run web
```

Optionally set a session secret for web state:

```bash
set WOODSHED_SESSION_SECRET=your_secret_here
npm run web
```

## One-click launch (Windows)

Double-click [Launch-Woodshed-Web.bat](Launch-Woodshed-Web.bat) from the Woodshed folder.

It starts:
- Python API on `http://127.0.0.1:8010`
- Web GUI on `http://127.0.0.1:3010`
