"""Lazy backfill and versioning. Legacy hard-assignment analyses remain unchanged."""
import hashlib
import json
from .research import allocations


def incident_distribution(conn, accident_id):
    row = conn.execute('SELECT * FROM accidents WHERE id=?', (accident_id,)).fetchone()
    if not row:
        raise ValueError('Incident not found.')
    if row['verification_status'] in {'merged_duplicate', 'rejected_false_alarm'}:
        return {'status': 'excluded', 'reason': row['verification_status'], 'allocations': []}
    state = {key: row[key] for key in ('snapped_lixel_id', 'snap_candidates_json', 'verification_status', 'canonical_parent_id')}
    fingerprint = hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()
    current = conn.execute('SELECT version FROM allocation_versions WHERE accident_id=? AND valid=1 AND source_fingerprint=? ORDER BY version DESC LIMIT 1', (accident_id, fingerprint)).fetchone()
    if current:
        version = current['version']
    else:
        # Manual chosen lixel can differ from stale candidate JSON. Never reuse it as probabilistic support.
        candidates = json.loads(row['snap_candidates_json'] or '[]')
        candidates = [c for c in candidates if c.get('lixel_id') is not None]
        selected = row['snapped_lixel_id']
        if row['verification_status'] == 'verified_canonical' and selected is not None:
            candidates = [{'lixel_id': selected, 'snap_probability': 1.}]
            provenance = 'verified-hard-assignment'
        else:
            provenance = 'normalized-snap-candidates'
        eligible = {r[0] for r in conn.execute('SELECT id FROM road_lixels WHERE dataset_id=?', (row['dataset_id'],))}
        candidates = [c for c in candidates if c['lixel_id'] in eligible]
        if not candidates:
            return {'status': 'unavailable', 'reason': 'No candidate support; no implicit fallback.', 'allocations': []}
        weights = allocations([{'lixel_id': c['lixel_id'], 'probability': c.get('snap_probability', 0)} for c in candidates])
        version = conn.execute('SELECT COALESCE(MAX(version),0)+1 FROM allocation_versions WHERE accident_id=?', (accident_id,)).fetchone()[0]
        conn.execute('UPDATE allocation_versions SET valid=0 WHERE accident_id=?', (accident_id,))
        conn.execute('INSERT INTO allocation_versions(accident_id,version,source_fingerprint) VALUES(?,?,?)', (accident_id, version, fingerprint))
        conn.executemany('INSERT INTO incident_allocations(accident_id,version,lixel_id,probability,provenance) VALUES(?,?,?,?,?)', [(accident_id, version, lid, prob, provenance) for lid, prob in weights.items()])
    values = [dict(r) for r in conn.execute('SELECT lixel_id,probability,provenance FROM incident_allocations WHERE accident_id=? AND version=? ORDER BY lixel_id', (accident_id, version))]
    return {'status': 'available', 'incident_id': accident_id, 'version': version, 'allocations': values, 'mass': sum(v['probability'] for v in values), 'legacy_lab_policy': 'hard_assignment_unchanged'}
