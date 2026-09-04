# Programming Projects Workspace

This repository is a personal workspace containing several experiments and project folders.

## Workspace Contents

- `Woodshed/` — active project: jazz seventh-chord trainer (Python engine + API + Node web GUI)
- `blackjack.ipynb` — blackjack strategy exploration notebook
- `Hexxed_Neuronav_Notebook.ipynb` — reinforcement learning / NeuroNav notebook
- `multiclass_obesity_prediction.ipynb` — multiclass ML notebook
- `carCosts/` — scripts for vehicle cost-to-own calculations
- `ChordProgressions/` — chord progression web prototype
- `MedleyVox RNN Singer Recognition Project/` — singer-recognition project assets and notebooks

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
