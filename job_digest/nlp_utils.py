"""Utilities to detect local resources and select/load an NLP model accordingly.

This module prefers local, offline models and will gracefully fall back when
dependencies (psutil, spacy, torch) are not available.
"""
from __future__ import annotations

import os
import platform
from typing import Dict, Optional


def detect_resources() -> Dict[str, object]:
    """Return a dict with detected resources: total_mem_gb, cpu_count, has_gpu, platform, machine."""
    total_mem_gb: Optional[float] = None
    cpu_count: int = os.cpu_count() or 1
    has_gpu: bool = False

    try:
        import psutil

        total_mem_gb = psutil.virtual_memory().total / (1024 ** 3)
        cpu_count = psutil.cpu_count(logical=False) or cpu_count
    except Exception:
        total_mem_gb = None

    try:
        import torch
        # prefer CUDA, but also detect Apple's MPS if available
        has_gpu = (
            bool(getattr(torch, "cuda", None) and torch.cuda.is_available())
            or (getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available())
        )
    except Exception:
        has_gpu = False

    # Fallback: if torch isn't installed, try to detect an NVIDIA GPU via `nvidia-smi`.
    if not has_gpu:
        try:
            import shutil, subprocess

            ns = shutil.which("nvidia-smi")
            if ns:
                out = subprocess.check_output([ns, "-L"], stderr=subprocess.STDOUT, text=True)
                if out and "GPU" in out:
                    has_gpu = True
        except Exception:
            pass

    return {
        "total_mem_gb": total_mem_gb,
        "cpu_count": cpu_count,
        "has_gpu": has_gpu,
        "platform": platform.system(),
        "machine": platform.machine(),
    }


def select_nlp_model() -> Optional[str]:
    """Choose a spaCy model name based on local resources.

    Returns model name (e.g. 'en_core_web_trf' or 'en_core_web_sm') or None to
    indicate the lightweight, no-model fallback.
    """
    res = detect_resources()
    total = res.get("total_mem_gb")
    cpus = res.get("cpu_count") or 1
    gpu = bool(res.get("has_gpu"))

    # Conservative policy: only use transformer if GPU is available (fast inference).
    if gpu:
        return "en_core_web_trf"

    # Prefer the small spaCy model when there is modest memory (quick to load).
    # Avoid heavy models when CPU-only to keep digest generation fast.
    if total and total >= 4 and cpus >= 2:
        return "en_core_web_sm"

    # Constrained environment: no model to keep runtime minimal.
    return None


def runtime_info() -> Dict[str, object]:
    """Return runtime summary including selected nlp model and detected resources."""
    res = detect_resources()
    model = select_nlp_model()
    res["selected_model"] = model
    return res


def load_spacy_model(model_name: str):
    """Attempt to load a spaCy model by name. Returns the nlp object or None."""
    try:
        import spacy

        return spacy.load(model_name)
    except Exception:
        return None
