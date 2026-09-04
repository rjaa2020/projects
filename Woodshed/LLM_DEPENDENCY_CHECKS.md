# Woodshed LLM Dependency-Check Maintenance Instructions

This file is for future LLM/code-assistant updates to Woodshed.

## Required Policy

When architecture, startup flow, scripts, dependencies, ports, or runtime assumptions change, you **must** update dependency checks and bootstrapping logic in `Launch-Woodshed-Web.bat` in the same change.

Do not ship architecture changes without validating launcher compatibility.

## Files that must stay aligned

- `Launch-Woodshed-Web.bat`
- `package.json` (root scripts)
- `web/package.json` (web runtime/dependencies)
- `pyproject.toml` (Python dependencies/extras and entry points)
- `woodshed/api.py` (health endpoint + startup assumptions)
- `README.md` (run instructions and troubleshooting)

## Dependency checklist to maintain

Ensure the launcher verifies and/or bootstraps, at minimum:

1. **Python runtime** is discoverable (prefer local `.venv`, then fallback bootstrapping command).
2. **Local virtual environment** exists (auto-create if missing).
3. **Python packages** needed for web/API are installed (currently `-e .[web]`).
4. **Node.js + npm** commands are available.
5. **Web dependencies** are installed (`npm run web:install`).
6. **API health** is confirmed before launching/opening the web app.
7. **Port assumptions** in launcher match API/web server defaults.
8. **System package-manager fallbacks** are still correct for Windows.

## Package-manager policy

Keep auto-install logic current:

- Windows launcher: prefer `winget`, fallback to `choco`/`scoop`.

If package IDs or install commands change upstream, update launcher commands and docs together.

## If architecture changes

Update launcher logic when any of the following change:

- API module path, app import path, or ASGI server command.
- Health endpoint path/contract (`/health`, response shape).
- Required Python extras or dependency groups.
- Root/web npm scripts used for startup.
- Port/environment variable names (`API_PORT`, `WEB_PORT`, `WOODSHED_API_URL`, etc.).

## Validation steps after updates

After any related change, validate end-to-end:

1. Delete or rename local `.venv` and run launcher (it should self-heal).
2. Run launcher with clean web `node_modules` state (it should reinstall).
3. Confirm API becomes healthy before web starts.
4. Confirm browser opens and quiz initializes without `fetch failed`.

## Documentation requirement

When changing launcher dependency checks, also update `README.md` one-click launch notes and troubleshooting text in the same pull request/change set.
