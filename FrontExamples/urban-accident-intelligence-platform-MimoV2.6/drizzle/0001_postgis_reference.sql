# ---------------------------------------------------------------------------
# Urban Accident Intelligence — PostGIS reference DDL
# ---------------------------------------------------------------------------
# This file documents the production spatial schema. The sandbox runtime used
# to build this application has no PostGIS extension available, so the live
# schema (src/db/schema.ts) stores WGS84 coordinates as doublePrecision columns
# plus a WKT mirror, and performs metric operations in a local equirectangular
# frame (src/lib/geo.ts).
#
# Applying this file on a PostgreSQL instance with PostGIS installed upgrades
# the same schema to true geometry columns with GiST indexes, and enables the
# spatial queries described in the README without touching application code
# beyond the data-access layer.
#
#   psql "$DATABASE_URL" -f drizzle/0001_postgis_reference.sql
# ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Geometry columns -------------------------------------------------------

ALTER TABLE road_segments
  ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);

UPDATE road_segments
   SET geom = ST_GeomFromText(geometry_wkt, 4326)
 WHERE geom IS NULL;

ALTER TABLE road_segments
  ALTER COLUMN geom SET NOT NULL;

ALTER TABLE accidents
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS reported_geom geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS snapped_geom geometry(Point, 25832);

UPDATE accidents
   SET geom         = ST_SetSRID(ST_MakePoint(lon, lat), 4326),
       reported_geom = ST_SetSRID(ST_MakePoint(reported_lon, reported_lat), 4326),
       snapped_geom  = ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 25832)
 WHERE geom IS NULL;

-- 2. GiST spatial indexes ---------------------------------------------------

CREATE INDEX IF NOT EXISTS road_segments_geom_gix
  ON road_segments USING GIST (geom);

CREATE INDEX IF NOT EXISTS accidents_geom_gix
  ON accidents USING GIST (geom);

CREATE INDEX IF NOT EXISTS accidents_snapped_geom_gix
  ON accidents USING GIST (snapped_geom);

CREATE INDEX IF NOT EXISTS accidents_occurred_at_idx
  ON accidents (occurred_at DESC);

CREATE INDEX IF NOT EXISTS accidents_occurred_severity_idx
  ON accidents (occurred_at, severity_code);

-- 3. Common spatial queries used by the analytical layer --------------------

-- Nearest road segment within 120 m (map matching).
CREATE OR REPLACE VIEW v_accidents_with_segment AS
SELECT a.id,
       a.public_id,
       a.severity_code,
       a.category_code,
       a.status,
       a.occurred_at,
       s.id            AS road_segment_id,
       s.segment_code,
       s.street_name,
       ST_Distance(a.geog, s.geog) AS snap_distance_m
  FROM accidents a
  LEFT JOIN LATERAL (
       SELECT rs.*,
              ST_Transform(rs.geom, 25832)::geography AS geog
         FROM road_segments rs
        ORDER BY ST_Transform(rs.geom, 25832) <-> ST_Transform(a.geom, 25832)
        LIMIT 1
  ) s ON ST_Distance(a.geog, s.geog) < 120;

-- Segment-level aggregation used by the road-segment layer and risk engine.
CREATE OR REPLACE VIEW v_segment_accident_stats AS
SELECT rs.id,
       rs.segment_code,
       rs.street_name,
       rs.road_class,
       ST_Length(ST_Transform(rs.geom, 25832))        AS length_m,
       count(a.id)                                     AS accident_count,
       sum(CASE a.severity_code
             WHEN 'fatal' THEN 10 WHEN 'serious' THEN 5
             WHEN 'slight' THEN 2 ELSE 1 END)          AS severity_weighted_index
  FROM road_segments rs
  LEFT JOIN accidents a ON a.road_segment_id = rs.id
 GROUP BY rs.id;

-- Kernel density is computed in application code on a regular lattice; the
-- equivalent SQL for a grid-based intensity surface is:
--
--   SELECT (ST_SnapToGrid(ST_Transform(geom, 25832), 160, 160)).*, count(*)
--     FROM accidents
--    GROUP BY 1;
--
-- DBSCAN clustering is available natively:
--
--   SELECT ST_ClusterDBSCAN(ST_Transform(geom, 25832), eps := 260, minpoints := 8)
--          OVER () AS cluster_id, id
--     FROM accidents;
