"""Length-based hotspot evaluation; all quantities are independent of model fitting.

Tie groups are selected fractionally in proportion to their network length. Within
one lixel (or a tied group), event mass is assumed uniform along its length.
The exact area under PAI(a), for 0 < a <= 1, has a random-selection baseline of 1.
"""
from __future__ import annotations

from typing import Any
import math

import numpy as np


def pai_curve(
    scores: np.ndarray,
    lengths_m: np.ndarray,
    event_mass: np.ndarray,
    coverage_grid: np.ndarray | None = None,
) -> dict[str, Any]:
    """Compute capture, PAI and AU-PAI for scores ranked from high to low.

    ``event_mass`` can be held-out event counts or synthetic expected counts,
    but callers must identify its source. The zero-coverage PAI is undefined;
    AU-PAI uses the right-hand limit at zero and an analytic integral.
    """
    scores = np.asarray(scores, dtype=float)
    lengths = np.asarray(lengths_m, dtype=float)
    mass = np.asarray(event_mass, dtype=float)
    if scores.ndim != 1 or lengths.ndim != 1 or mass.ndim != 1 or not (scores.size == lengths.size == mass.size) or not scores.size:
        raise ValueError("scores, lengths and event mass must be non-empty equal-length vectors")
    if not np.all(np.isfinite(scores)) or not np.all(np.isfinite(lengths)) or not np.all(np.isfinite(mass)):
        raise ValueError("scores, lengths and event mass must be finite")
    if np.any(lengths <= 0) or np.any(mass < 0):
        raise ValueError("lengths must be positive and event mass non-negative")
    grid = np.linspace(0.0, 1.0, 21) if coverage_grid is None else np.asarray(coverage_grid, dtype=float)
    if grid.ndim != 1 or grid.size < 2 or not np.all(np.isfinite(grid)) or grid[0] != 0 or grid[-1] != 1 or np.any(np.diff(grid) <= 0):
        raise ValueError("coverage grid must increase strictly from 0 to 1")

    total_length = float(np.sum(lengths))
    total_mass = float(np.sum(mass))
    metadata = {
        "coverage_basis": "network_length",
        "tie_policy": "fractional proportional-to-length across equal-score lixels",
        "within_lixel_assumption": "uniform event mass per unit length",
        "area_definition": "integral of PAI(a) over 0<a<=1; random ranking baseline=1",
        "area_method": "analytic piecewise integration; right-hand limit at zero",
        "total_network_length_m": total_length,
        "total_event_mass": total_mass,
    }
    if total_mass == 0:
        return {**metadata, "status": "undefined_no_event_mass", "au_pai": None,
                "points": [{"coverage": float(a), "realized_coverage": float(a), "capture": None, "pai": None} for a in grid]}

    # Sorting is deterministic, but scores with exactly equal values are grouped,
    # so results do not depend on order within a tie.
    order = np.argsort(-scores, kind="stable")
    sorted_scores, sorted_lengths, sorted_mass = scores[order], lengths[order], mass[order]
    starts = np.r_[0, np.flatnonzero(sorted_scores[1:] != sorted_scores[:-1]) + 1]
    group_lengths = np.add.reduceat(sorted_lengths, starts) / total_length
    group_mass = np.add.reduceat(sorted_mass, starts) / total_mass
    edges = np.r_[0.0, np.cumsum(group_lengths)]
    captures = np.r_[0.0, np.cumsum(group_mass)]
    edges[-1] = captures[-1] = 1.0

    def capture_at(a: float) -> float:
        if a <= 0:
            return 0.0
        if a >= 1:
            return 1.0
        idx = int(np.searchsorted(edges, a, side="right") - 1)
        return float(captures[idx] + group_mass[idx] * (a - edges[idx]) / group_lengths[idx])

    points = []
    for a in grid:
        a = float(a)
        capture = capture_at(a)
        points.append({"coverage": a, "realized_coverage": a, "capture": capture,
                       "pai": capture / a if a > 0 else None})

    # On each group C(a) = slope*a + intercept; integrate C(a)/a.
    area = 0.0
    for i, width in enumerate(group_lengths):
        left, right = float(edges[i]), float(edges[i + 1])
        slope = float(group_mass[i] / width)
        intercept = float(captures[i] - slope * left)
        area += slope * (right - left)
        if left > 0:
            area += intercept * math.log(right / left)
    return {**metadata, "status": "ok", "au_pai": float(area), "points": points}
