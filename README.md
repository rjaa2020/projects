# Programming Projects Workspace

This repository is a personal workspace containing several experiments and project folders.

## Workspace Contents

- `Woodshed/` — active project: jazz seventh-chord trainer (Python engine + API + Node web GUI)
- `job_digest/` — job-application email digest and classification project
- `carCosts/` — Selenium, BeautifulSoup, and pandas scripts for collecting vehicle cost-to-own data from Edmunds
- `ChordProgressions/` — browser-based music prototype that displays note frequencies and plays tones with the Web Audio API
- `blackjack.ipynb` — blackjack strategy exploration and simulation notebook
- `Hexxed_Neuronav_Notebook.ipynb` — reinforcement-learning and NeuroNav experimentation notebook
- `multiclass_obesity_prediction.ipynb` — exploratory machine-learning notebook for multiclass obesity prediction
- `MedleyVox RNN Singer Recognition Project/` — RNN-based singer-recognition and singing-voice analysis project, including notebooks, reports, presentation materials, and figures

## Other Projects

### Job Digest

The `job_digest/` project turns job-application email into a structured digest. Its tested classification and extraction logic includes:

- Classifying messages as rejected, interview, action required, or submitted
- Extracting company names from application and ATS email formats
- Normalizing company-name variants and filtering noise senders
- Detecting proper-noun company phrases while rejecting encoded or URL-like text

The folder also contains the generated `digest.html`, Gmail authentication files, logs, and classification tests.

### Car Cost Calculator

The `carCosts/` scripts automate Edmunds True Cost to Own lookups for a list of vehicles loaded from Excel. They use Selenium to select the vehicle and ZIP code, BeautifulSoup and pandas to parse pricing and ownership-cost tables, and can write consolidated results back to Excel.

### Chord Progressions

The `ChordProgressions/` prototype demonstrates browser-based note playback. It calculates note frequencies from note names and octaves, displays note information, and plays generated sine-wave tones through the Web Audio API.

### Research Notebooks

- `blackjack.ipynb` explores blackjack strategy and game outcomes.
- `Hexxed_Neuronav_Notebook.ipynb` explores NeuroNav with reinforcement-learning experiments and visualizations.
- `multiclass_obesity_prediction.ipynb` explores data preparation, visualization, and multiclass obesity prediction.
- `MedleyVox RNN Singer Recognition Project/` contains two ENGR208 final-project notebooks comparing singing-voice approaches, including an RNN-only approach, along with the written report, presentation, dataset documentation, and model figures.

## Active Project: Woodshed

Woodshed is structured with a single Python source of truth for quiz logic:

- Python package engine: chord theory, quiz checking, adaptive weighted sampling
- Python API: serves prompt/check/options endpoints
- Node web app: GUI only, calls the Python API

### Key Features

- Seventh chord note-naming quiz
- Include filters for keys and chord qualities
- Enharmonic-aware answer scoring
- Adaptive sampling that emphasizes underexplored / lower-scoring material
- Stats page with key × chord-quality score table:
	- `0` = untested
	- `+1` per correct
	- `-1` per incorrect

### Woodshed Quick Start

From `Woodshed/`:

```bash
pip install -e .[web,test]
npm run web:install
python -m woodshed.api
```

In a second terminal (still in `Woodshed/`):

```bash
set WOODSHED_API_URL=http://127.0.0.1:8000
npm run web
```

Then open `http://localhost:3000`.

### One-Click Launch (Windows)

Double-click `Woodshed/Launch-Woodshed-Web.bat`.

It automatically:

- stops existing Woodshed API/web processes
- clears port conflicts
- starts API on `8010` and web on `3010`

## Testing

For Woodshed:

```bash
cd Woodshed
python -m pytest -q
```
