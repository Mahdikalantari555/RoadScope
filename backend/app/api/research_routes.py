"""Explicit versioned research contracts; no planned model masquerades as a fit."""
import json
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..db import db_session
from ..services import research as r

router = APIRouter(prefix='/api/v1/research', tags=['research'])

GATES = {
    'bym2': ('Validated posterior inference, component scaling and convergence diagnostics are not implemented.', 'استنباط پسین و تشخیص همگرایی معتبر هنوز پیاده‌سازی نشده است.'),
    'surrogate_joint': ('Paired coverage-reviewed data and validated joint posterior inference are required.', 'داده‌های جفت‌شده با پوشش معتبر و استنباط پسین لازم است.'),
    'st_gnn': ('Exposure-aware longitudinal data and a validated multi-seed holdout protocol are required.', 'داده‌های طولی مواجهه و ارزیابی چندبذری لازم است.'),
    'text_gnn': ('Consented narratives, license verification and privacy review are required; no text is sent externally.', 'رضایت، بررسی مجوز و حریم خصوصی لازم است؛ متن به بیرون ارسال نمی‌شود.'),
    'joint_link_node': ('Node observations and validated joint inference are required.', 'مشاهدات گره و استنباط مشترک معتبر لازم است.'),
    'hawkes_declustering': ('Validated parameter estimation and identifiability diagnostics are not implemented.', 'تخمین معتبر پارامتر و تشخیص شناسایی‌پذیری هنوز پیاده‌سازی نشده است.'),
    'adaptive_tnkde': ('Pilot adaptation and event-level LOO selection are not yet validated.', 'تطبیق پهنای باند و انتخاب حذف یک رخداد هنوز اعتبارسنجی نشده است.'),
    'inhomogeneous_second_order': ('Intensity-weighted null simulation and boundary correction require validation.', 'شبیه‌سازی فرض صفر و تصحیح مرز نیازمند اعتبارسنجی است.'),
}

@router.get('/capabilities')
def capabilities():
    from ..security import demo_enabled
    return {'contract': r.CONTRACT, 'research_only': True, 'synthetic_demo': demo_enabled(),
            'available': ['directed_diffusion', 'symmetric_heat', 'pai_curve', 'length_eb', 'evpi'],
            'primitives_only': ['fixed_tnkde', 'stabilized_ipw', 'trajectory_hmm', 'network_voronoi', 'hawkes_simulation'],
            'unavailable': {key: {'reason': {'en': value[0], 'fa': value[1]}} for key, value in GATES.items()}}

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Initial(Strict):
    lixel_id: int
    direction: Literal[-1, 1] = 1
    mass: float = Field(ge=0)

class Diffusion(Strict):
    dataset_id: int
    method: Literal['directed_diffusion', 'symmetric_heat'] = 'directed_diffusion'
    initial: list[Initial] = Field(max_length=1000)
    duration_s: float = Field(default=1, ge=0, le=10000)
    rate_per_s: float = Field(default=1, ge=0, le=100)

@router.post('/diffusion')
def diffusion(req: Diffusion):
    try:
        with db_session() as conn:
            if not conn.execute('SELECT 1 FROM dataset_sources WHERE id=?', (req.dataset_id,)).fetchone():
                raise HTTPException(404, 'Dataset not found.')
            graph, topology = r.directed_lixel_graph(conn, req.dataset_id)
            initial = {}
            for item in req.initial:
                key = (item.lixel_id, item.direction)
                initial[key] = initial.get(key, 0) + item.mass
            mass, diagnostics = r.diffuse(graph, initial, req.duration_s, req.rate_per_s, req.method == 'symmetric_heat')
            result = {'states': [{'lixel_id': k[0], 'direction': k[1], 'mass': v} for k, v in mass.items()], 'diagnostics': diagnostics}
            provenance = r.manifest(req.method, req.model_dump(), {'topology': topology, 'initial': req.model_dump()['initial']})
            provenance['topology_sha256'] = topology
            provenance['limitations'] = 'Finite-state mass operator; not a continuous metric-graph PDE. Legacy NKDE is unchanged.'
            cursor = conn.execute('INSERT INTO research_runs(contract_version,method,dataset_id,manifest_json,result_json) VALUES(?,?,?,?,?)',
                                 (r.CONTRACT, req.method, req.dataset_id, json.dumps(provenance), json.dumps(result)))
            return {'run_id': cursor.lastrowid, 'manifest': provenance, 'result': result}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@router.get('/runs/{run_id}')
def run_export(run_id: int):
    with db_session() as conn:
        row = conn.execute('SELECT * FROM research_runs WHERE id=?', (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Research run not found.')
        return {'run_id': run_id, 'manifest': json.loads(row['manifest_json']), 'result': json.loads(row['result_json'])}

class Pai(Strict):
    scores: list[float] = Field(max_length=20000)
    lengths_m: list[float] = Field(max_length=20000)
    counts: list[float] = Field(max_length=20000)
    fractions: list[float] | None = Field(default=None, max_length=1000)

@router.post('/pai')
def pai(req: Pai):
    try:
        return r.pai_curve(req.scores, req.lengths_m, req.counts, req.fractions)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

class Eb(Strict):
    counts: list[float] = Field(max_length=20000)
    predicted: list[float] = Field(max_length=20000)
    length_km: list[float] = Field(max_length=20000)
    alpha_1: float = Field(gt=0)
    exposure_source: str = Field(min_length=1, max_length=500)

@router.post('/length-eb')
def eb(req: Eb):
    try:
        return {**r.length_eb(req.counts, req.predicted, req.length_km, req.alpha_1), 'exposure_source': req.exposure_source}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

class Decision(Strict):
    losses: list[list[float]] = Field(min_length=2, max_length=10000)
    actions: list[str] = Field(min_length=2, max_length=20)
    loss_unit: str = Field(min_length=1, max_length=100)
    horizon_years: float = Field(gt=0)

@router.post('/evpi')
def decision(req: Decision):
    try:
        if any(len(row) != len(req.actions) for row in req.losses):
            raise ValueError('Every draw must specify loss for every action, including costs.')
        return {**r.evpi(req.losses), 'actions': req.actions, 'loss_unit': req.loss_unit, 'horizon_years': req.horizon_years,
                'assumption': 'User-supplied posterior losses; not inferred from MCDA scores.'}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@router.post('/incidents/{accident_id}/allocations')
def incident_allocations(accident_id: int):
    from ..services.allocations import incident_distribution
    try:
        with db_session() as conn:
            return incident_distribution(conn, accident_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
