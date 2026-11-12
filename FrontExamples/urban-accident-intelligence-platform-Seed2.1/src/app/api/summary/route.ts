import { NextResponse } from "next/server";
import { db } from "@/db";
import { accidents, severityLevels, accidentCategories, roadSegments, roadLixels, datasetSources } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export async function GET() {
  // Total accident count (non-false-alarm)
  const totalQ = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE is_false_alarm = false OR is_false_alarm IS NULL) AS verified_count,
      COUNT(*) FILTER (WHERE status = 'raw_vgi') AS raw_vgi_count,
      COUNT(*) FILTER (WHERE is_false_alarm = true) AS false_alarm_count,
      COUNT(*) AS total_count
    FROM accidents
  `);
  const totals = totalQ.rows[0] as Record<string, string>;

  // By severity
  const bySev = await db.execute(sql`
    SELECT sl.code, sl.label, sl.color, COUNT(a.id) AS count
    FROM accidents a
    JOIN severity_levels sl ON a.severity_id = sl.id
    WHERE a.is_false_alarm = false OR a.is_false_alarm IS NULL
    GROUP BY sl.code, sl.label, sl.color
    ORDER BY count DESC
  `);

  // By hour of day (diurnal)
  const byHour = await db.execute(sql`
    SELECT EXTRACT(HOUR FROM incident_time)::int AS hour, COUNT(*) AS count
    FROM accidents
    WHERE is_false_alarm = false OR is_false_alarm IS NULL
    GROUP BY hour
    ORDER BY hour
  `);

  // By day of week
  const byDow = await db.execute(sql`
    SELECT EXTRACT(DOW FROM incident_time)::int AS dow, COUNT(*) AS count
    FROM accidents
    WHERE is_false_alarm = false OR is_false_alarm IS NULL
    GROUP BY dow
    ORDER BY dow
  `);

  // By weather
  const byWeather = await db.execute(sql`
    SELECT weather, COUNT(*) AS count
    FROM accidents
    WHERE weather IS NOT NULL AND (is_false_alarm = false OR is_false_alarm IS NULL)
    GROUP BY weather ORDER BY count DESC
  `);

  // By lighting
  const byLighting = await db.execute(sql`
    SELECT lighting_condition, COUNT(*) AS count
    FROM accidents
    WHERE lighting_condition IS NOT NULL AND (is_false_alarm = false OR is_false_alarm IS NULL)
    GROUP BY lighting_condition ORDER BY count DESC
  `);

  // By road class
  const byRoadClass = await db.execute(sql`
    SELECT rs.road_class, COUNT(a.id) AS count,
           SUM(rs.length_meters)/1000 AS total_km
    FROM accidents a
    JOIN road_segments rs ON a.snapped_segment_id = rs.id
    WHERE a.is_false_alarm = false OR a.is_false_alarm IS NULL
    GROUP BY rs.road_class ORDER BY count DESC
  `);

  // Reporting lag histogram
  const lagQ = await db.execute(sql`
    SELECT width_bucket(reporting_lag_minutes, 0, 120, 12) AS bucket,
           COUNT(*) AS count
    FROM accidents
    WHERE reporting_lag_minutes IS NOT NULL AND reporting_lag_minutes < 120
    GROUP BY bucket ORDER BY bucket
  `);

  // Snap distance distribution
  const snapQ = await db.execute(sql`
    SELECT width_bucket(snap_distance_m, 0, 100, 10) AS bucket,
           COUNT(*) AS count
    FROM accidents
    WHERE snap_distance_m IS NOT NULL AND is_false_alarm = false
    GROUP BY bucket ORDER BY bucket
  `);

  // Latest dataset info
  const ds = await db.select().from(datasetSources).orderBy(desc(datasetSources.id)).limit(1);

  return NextResponse.json({
    totals: {
      verified: Number(totals.verified_count ?? 0),
      rawVgi: Number(totals.raw_vgi_count ?? 0),
      falseAlarms: Number(totals.false_alarm_count ?? 0),
      total: Number(totals.total_count ?? 0),
    },
    bySeverity: bySev.rows.map(r => ({
      code: r.code, label: r.label, color: r.color, count: Number(r.count)
    })),
    byHour: byHour.rows.map(r => ({ hour: Number(r.hour), count: Number(r.count) })),
    byDow: byDow.rows.map(r => ({ dow: Number(r.dow), count: Number(r.count) })),
    byWeather: byWeather.rows.map(r => ({ label: r.weather, count: Number(r.count) })),
    byLighting: byLighting.rows.map(r => ({ label: r.lighting_condition, count: Number(r.count) })),
    byRoadClass: byRoadClass.rows.map(r => ({
      label: r.road_class, count: Number(r.count), totalKm: Number(r.total_km)
    })),
    lagHistogram: lagQ.rows.map(r => ({ bucket: Number(r.bucket), count: Number(r.count) })),
    snapHistogram: snapQ.rows.map(r => ({ bucket: Number(r.bucket), count: Number(r.count) })),
    dataset: ds[0] ?? null,
  });
}
