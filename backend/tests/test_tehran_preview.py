import json
import pytest
from fastapi import HTTPException
from app.api.tehran_preview import tehran_preview


def sample():
    return {'manifest': {'generator': 'roadscope-graphml-sample-v1', 'incident_provenance': 'synthetic, not real crash data'}, 'streets': {'type': 'FeatureCollection', 'features': []}, 'incidents': {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'synthetic': True}}]}}


def test_missing_and_valid_preview(tmp_path, monkeypatch):
    monkeypatch.delenv('ROADSCOPE_TEHRAN_PREVIEW_FILE', raising=False)
    with pytest.raises(HTTPException) as exc:
        tehran_preview()
    assert exc.value.status_code == 404
    file = tmp_path / 'preview.json'
    file.write_text(json.dumps(sample()))
    monkeypatch.setenv('ROADSCOPE_TEHRAN_PREVIEW_FILE', str(file))
    assert tehran_preview() == sample()


def test_rejects_non_synthetic_data(tmp_path, monkeypatch):
    data = sample()
    data['incidents']['features'][0]['properties']['synthetic'] = False
    file = tmp_path / 'preview.json'
    file.write_text(json.dumps(data))
    monkeypatch.setenv('ROADSCOPE_TEHRAN_PREVIEW_FILE', str(file))
    with pytest.raises(HTTPException) as exc:
        tehran_preview()
    assert exc.value.status_code == 503
