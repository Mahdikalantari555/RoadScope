-- Urban Accident Intelligence — PostGIS upgrade path
-- The reference deployment stores coordinates in two explicit CRSs (EPSG:4326 lon/lat and EPSG:32633 x/y)
-- so it runs on vanilla PostgreSQL. On a PostGIS-enabled server, run this script after `drizzle-kit push`
-- to add native geometry columns, GiST indexes and keep them synchronised via generated columns.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Accidents: validated geometry (metric) + original reported geometry (geographic), preserved separately.
ALTER TABLE accidents
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 32633)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x, y), 32633)) STORED,
  ADD COLUMN IF NOT EXISTS geom_reported geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(reported_lon, reported_lat), 4326)) STORED;
CREATE INDEX IF NOT EXISTS accidents_geom_gist ON accidents USING gist (geom);
CREATE INDEX IF NOT EXISTS accidents_geom_reported_gist ON accidents USING gist (geom_reported);

-- Road network
ALTER TABLE road_nodes
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 32633)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x, y), 32633)) STORED;
CREATE INDEX IF NOT EXISTS road_nodes_geom_gist ON road_nodes USING gist (geom);

ALTER TABLE road_segments ADD COLUMN IF NOT EXISTS geom_line geometry(LineString, 32633);
UPDATE road_segments
   SET geom_line = ST_SetSRID(ST_GeomFromGeoJSON(json_build_object('type','LineString','coordinates', geom_proj)::text), 32633)
 WHERE geom_line IS NULL;
CREATE INDEX IF NOT EXISTS road_segments_geom_gist ON road_segments USING gist (geom_line);

-- Example: nearest-segment assignment in SQL (equivalent to LineGrid.nearest in src/lib/geo/geometry.ts)
-- SELECT a.id, s.id AS segment_id, ST_Distance(a.geom, s.geom_line) AS d
--   FROM accidents a
--   CROSS JOIN LATERAL (
--     SELECT id, geom_line FROM road_segments
--      WHERE ST_DWithin(a.geom, geom_line, 60)
--      ORDER BY a.geom <-> geom_line LIMIT 1) s;

-- Example: proximity query (incidents within 100 m of a point given in WGS84)
-- SELECT id FROM accidents
--  WHERE ST_DWithin(geom, ST_Transform(ST_SetSRID(ST_MakePoint(15.0, 45.14), 4326), 32633), 100);
