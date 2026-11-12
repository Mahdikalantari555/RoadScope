import numpy as np
import pytest

from app.services.cure_diagnostics import cure_by_aadt


def test_cure_groups_ties_and_uses_nb_variance():
    result = cure_by_aadt(np.array([200, 100, 100]), np.array([1, 4, 0]),
                          np.array([2, 2, 1]), np.array([.5, .5, .5]), np.array([0, 1, 0]))
    assert result['status'] == 'ok'
    assert result['imputed_aadt_count'] == 1
    first, last = result['points']
    assert first['aadt'] == 100 and first['segment_count'] == 2
    assert first['cumulative_residual'] == pytest.approx(1)
    assert first['upper'] == pytest.approx(2 * np.sqrt(5.5))
    assert last['cumulative_residual'] == pytest.approx(0)
    assert last['upper'] == pytest.approx(2 * np.sqrt(9.5))
    assert 'not a simultaneous' in result['assumptions'].lower()


def test_tied_order_is_invariant():
    arrays = [np.array(a) for a in ([10, 10, 20], [0, 3, 0], [2, 1, 1], [.2, .3, .4], [0, 1, 0])]
    perm = [1, 0, 2]
    assert cure_by_aadt(*arrays)['points'] == cure_by_aadt(*(a[perm] for a in arrays))['points']


def test_insufficient_variation():
    result = cure_by_aadt(np.array([10, 10]), np.array([0, 0]), np.array([1, 1]), np.array([.2, .2]), np.array([0, 0]))
    assert result['status'] == 'insufficient_aadt_variation'
    assert result['points'] == []


@pytest.mark.parametrize('arrays', [
    ([1], [1, 2], [1], [1], [0]),
    ([0], [0], [1], [1], [0]),
    ([1], [0], [float('nan')], [1], [0]),
    ([1], [-1], [1], [1], [0]),
])
def test_bad_inputs(arrays):
    with pytest.raises(ValueError):
        cure_by_aadt(*(np.array(a) for a in arrays))
