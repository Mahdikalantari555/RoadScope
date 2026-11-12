"""Descriptive cumulative residuals for an existing SPF, ordered by AADT."""
from __future__ import annotations

from typing import Any

import numpy as np


def cure_by_aadt(
    aadt: np.ndarray,
    observed: np.ndarray,
    expected: np.ndarray,
    alpha: np.ndarray,
    imputed: np.ndarray,
    *,
    model_label: str = "legacy road-class SPF, not length-scaled or spatial BYM2",
) -> dict[str, Any]:
    """Return cumulative N - mu and a pointwise working-model envelope."""
    aadt, observed, expected, alpha = (np.asarray(x, dtype=float) for x in (aadt, observed, expected, alpha))
    imputed = np.asarray(imputed, dtype=bool)
    arrays = (aadt, observed, expected, alpha, imputed)
    if any(x.ndim != 1 for x in arrays) or len({len(x) for x in arrays}) != 1:
        raise ValueError("CURE inputs must be equal-length vectors")
    if any(not np.all(np.isfinite(x)) for x in (aadt, observed, expected, alpha)):
        raise ValueError("CURE inputs must be finite")
    if np.any(aadt <= 0) or any(np.any(x < 0) for x in (observed, expected, alpha)):
        raise ValueError("AADT must be positive; counts, expectations and dispersion must be non-negative")
    metadata = {
        "method": "cumulative observed minus SPF expected, ordered by effective AADT",
        "envelope": "pointwise ±2 sqrt(cumulative sum of μ + α μ²)",
        "assumptions": "Independent NB observations; fitted SPF parameters treated as fixed. Not a simultaneous confidence band or formal goodness-of-fit test.",
        "model": model_label,
        "sample_size": int(len(aadt)),
        "imputed_aadt_count": int(np.sum(imputed)),
        "unit": "cumulative crash count over study period",
    }
    if len(aadt) < 2 or np.unique(aadt).size < 2:
        return {**metadata, "status": "insufficient_aadt_variation", "points": []}

    order = np.argsort(aadt, kind="stable")
    sorted_aadt = aadt[order]
    starts = np.r_[0, np.flatnonzero(sorted_aadt[1:] != sorted_aadt[:-1]) + 1]
    residual = np.add.reduceat((observed - expected)[order], starts)
    variances = np.add.reduceat((expected + alpha * expected**2)[order], starts)
    counts = np.diff(np.r_[starts, len(aadt)])
    cum_resid = np.cumsum(residual)
    cum_variance = np.cumsum(variances)
    cumulative_n = np.cumsum(counts)
    points = [
        {
            "aadt": float(sorted_aadt[start]),
            "segment_count": int(cumulative_n[i]),
            "cumulative_residual": float(cum_resid[i]),
            "lower": float(-2 * np.sqrt(cum_variance[i])),
            "upper": float(2 * np.sqrt(cum_variance[i])),
        }
        for i, start in enumerate(starts)
    ]
    return {**metadata, "status": "ok", "points": points}
