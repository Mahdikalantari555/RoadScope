"""Optional, strictly illustrative street/sample bundle; not an analytical dataset."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix='/api/v1')


@router.get('/tehran-preview')
def tehran_preview() -> dict[str, Any]:
    configured = os.environ.get('ROADSCOPE_TEHRAN_PREVIEW_FILE')
    if not configured:
        raise HTTPException(status_code=404, detail='Tehran preview is not configured')
    path = Path(configured)
    try:
        if path.stat().st_size > 10_000_000:
            raise ValueError('Preview file exceeds 10 MB')
        bundle = json.loads(path.read_text(encoding='utf-8'))
        manifest = bundle['manifest']
        streets = bundle['streets']
        incidents = bundle['incidents']
        if (manifest.get('generator') != 'roadscope-graphml-sample-v1'
            or not manifest.get('incident_provenance', '').startswith('synthetic')
            or streets.get('type') != 'FeatureCollection'
            or incidents.get('type') != 'FeatureCollection'
            or any(f.get('properties', {}).get('synthetic') is not True for f in incidents['features'])):
            raise ValueError('Invalid synthetic preview')
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail='Tehran preview file is unavailable or invalid') from exc
    return {'manifest': manifest, 'streets': streets, 'incidents': incidents}
