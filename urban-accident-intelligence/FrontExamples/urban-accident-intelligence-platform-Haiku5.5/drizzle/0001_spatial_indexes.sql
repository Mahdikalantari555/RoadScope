-- Spatial infrastructure for Urban Accident Intelligence.
-- The PostgreSQL contrib modules `cube` and `earthdistance` provide GiST-indexed great-circle
-- queries (ll_to_earth / earth_box / earth_distance) without requiring the PostGIS extension.
-- Expression indexes below must match the expressions used in queries (see src/server/accidents.ts).
CREATE EXTENSION IF NOT EXISTS cube;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS earthdistance;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accidents_earth_gist ON accidents USING gist (ll_to_earth(lat, lon));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accidents_reported_earth_gist ON accidents USING gist (ll_to_earth(reported_lat, reported_lon));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS road_intersections_earth_gist ON road_intersections USING gist (ll_to_earth(lat, lon));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS road_segments_mid_earth_gist ON road_segments USING gist (ll_to_earth(mid_lat, mid_lon));
