import math

import numpy as np
import pytest

from app.services.benchmark_curves import pai_curve


def test_fractional_coverage_and_exact_area():
    result = pai_curve(np.array([2.0, 1.0]), np.array([100.0, 100.0]), np.array([10.0, 0.0]), np.array([0.0, 0.25, 0.5, 1.0]))
    assert result["status"] == "ok"
    assert result["points"][0]["pai"] is None
    assert result["points"][1]["capture"] == pytest.approx(0.5)
    assert result["points"][1]["pai"] == pytest.approx(2.0)
    assert result["points"][-1]["pai"] == pytest.approx(1.0)
    assert result["au_pai"] == pytest.approx(1 + math.log(2))


def test_unequal_lixels_fractional_boundary():
    result = pai_curve(np.array([2.0, 1.0]), np.array([80.0, 20.0]), np.array([8.0, 0.0]), np.array([0.0, 0.2, 1.0]))
    assert result["points"][1]["realized_coverage"] == 0.2
    assert result["points"][1]["capture"] == pytest.approx(0.25)
    assert result["points"][1]["pai"] == pytest.approx(1.25)


def test_ties_are_permutation_invariant_and_baseline_is_one():
    scores = np.array([1.0, 1.0, 1.0])
    lengths = np.array([10.0, 20.0, 70.0])
    mass = np.array([10.0, 0.0, 0.0])
    first = pai_curve(scores, lengths, mass)
    perm = [2, 0, 1]
    second = pai_curve(scores[perm], lengths[perm], mass[perm])
    assert first["au_pai"] == pytest.approx(1.0)
    assert first["points"] == second["points"]
    assert all(point["pai"] == pytest.approx(1.0) for point in first["points"][1:])


def test_zero_event_mass_is_undefined():
    result = pai_curve(np.array([1.0]), np.array([100.0]), np.array([0.0]))
    assert result["status"] == "undefined_no_event_mass"
    assert result["au_pai"] is None
    assert all(point["capture"] is None and point["pai"] is None for point in result["points"])


@pytest.mark.parametrize(
    "scores,lengths,mass,grid",
    [
        ([], [], [], None),
        ([1], [0], [1], None),
        ([1], [1], [-1], None),
        ([float("nan")], [1], [1], None),
        ([1], [1], [1], [0, 0.5, 0.5, 1]),
    ],
)
def test_invalid_inputs_are_rejected(scores, lengths, mass, grid):
    with pytest.raises(ValueError):
        pai_curve(np.array(scores), np.array(lengths), np.array(mass), None if grid is None else np.array(grid))
