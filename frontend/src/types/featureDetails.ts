/**
 * Authorised field allow-lists for the feature-detail panels.
 *
 * The detail panels render **only** the keys in these lists. That is a rendering decision, not a
 * security boundary — the server already decides which fields it sends and hides restricted ones
 * (exact pilot coordinates, narratives, credentials). But an allow-list keeps the boundary
 * explicit on the client too: a field accidentally added to a GeoJSON payload can never appear in
 * a detail card, a screenshot or a log because nobody added it here on purpose.
 */

export const SEGMENT_DETAIL_FIELDS = [
  'segment_id',
  'edge_code',
  'name',
  'road_class',
  'speed_limit_kmh',
  'lanes',
  'length_m',
  'sinuosity',
  'slope_pct',
  'elevation_level',
  'oneway_direction',
  'direction_source',
  'direction_source_detail',
  'aadt',
  'aadt_is_imputed',
  'coverage_confidence',
  'source_feature_id',
  'source_version',
  'grade_source',
  'topology_ambiguous',
] as const;

/**
 * Incident fields the *analysis* workspaces may display. Deliberately absent: reporter
 * identity, credential material, raw pilot coordinates and free text.
 */
export const INCIDENT_DETAIL_FIELDS = [
  // `/analytics/cmv` publishes `id`; older and legacy payloads used `accident_id`. Both are
  // allowed so neither shape silently renders "Not reported".
  'id',
  'accident_id',
  'occurred_at_utc',
  'reported_at_utc',
  'reporting_lag_min',
  'category_code',
  'severity_code',
  'verification_status',
  'source_type',
  'segment_id',
  'segment_name',
  'linear_offset_m',
  // Same reasoning: `orthogonal_snap_dist_m` is the CMV field, `network_distance_m` the legacy
  // alias used by the matching/alias endpoints.
  'orthogonal_snap_dist_m',
  'network_distance_m',
  'snap_probability',
  'observational_radius_m',
  'epdo_weight',
  'witness_count',
  'vgi_credibility_score',
  'weather_condition',
  'road_surface',
  'lighting_condition',
  'involved_vehicles',
  'involved_pedestrians',
  'involved_cyclists',
  'emergency_response_present',
] as const;

export type SegmentDetailField = (typeof SEGMENT_DETAIL_FIELDS)[number];
export type IncidentDetailField = (typeof INCIDENT_DETAIL_FIELDS)[number];

export function pickAllowed<T extends readonly string[]>(
  properties: Record<string, unknown> | null | undefined,
  allowed: T
): Partial<Record<T[number], unknown>> {
  const out: Record<string, unknown> = {};
  if (!properties) return out as Partial<Record<T[number], unknown>>;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      out[key] = properties[key];
    }
  }
  return out as Partial<Record<T[number], unknown>>;
}

/** A value is "missing" when it was not reported — which is different from zero. */
export function isMissingValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}
