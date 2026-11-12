-- Direction is relative to the road segment's u_node -> v_node orientation.
-- Legacy data without explicit direction use 0 as a documented assumption.
CREATE TABLE road_segment_directions (
    segment_id INTEGER PRIMARY KEY REFERENCES road_segments(id) ON DELETE CASCADE,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    direction INTEGER NOT NULL DEFAULT 0 CHECK (direction IN (-1, 0, 1)),
    source TEXT NOT NULL DEFAULT 'assumed_bidirectional' CHECK (source IN ('assumed_bidirectional', 'observed', 'imported', 'legacy_is_directed')),
    CHECK (source != 'assumed_bidirectional' OR direction = 0)
);
CREATE INDEX idx_segment_directions_dataset ON road_segment_directions(dataset_id);
CREATE TABLE network_topology_versions (
    dataset_id INTEGER PRIMARY KEY REFERENCES dataset_sources(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE TABLE turn_restrictions (
    id INTEGER PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    via_node_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
    from_segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    to_segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'imported' CHECK (source IN ('observed', 'imported', 'synthetic', 'manual')),
    UNIQUE(dataset_id, via_node_id, from_segment_id, to_segment_id)
);
INSERT INTO network_topology_versions(dataset_id) SELECT id FROM dataset_sources;
INSERT INTO road_segment_directions(segment_id, dataset_id, direction, source)
SELECT id, dataset_id,
       CASE WHEN is_directed = 1 THEN 1 ELSE 0 END,
       CASE WHEN is_directed = 1 THEN 'legacy_is_directed' ELSE 'assumed_bidirectional' END
FROM road_segments;
CREATE TRIGGER direction_valid_insert BEFORE INSERT ON road_segment_directions BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM road_segments s WHERE s.id = NEW.segment_id AND s.dataset_id = NEW.dataset_id)
      THEN RAISE(ABORT, 'direction segment must belong to dataset') END;
END;
CREATE TRIGGER direction_valid_update BEFORE UPDATE ON road_segment_directions BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM road_segments s WHERE s.id = NEW.segment_id AND s.dataset_id = NEW.dataset_id)
      THEN RAISE(ABORT, 'direction segment must belong to dataset') END;
END;
CREATE TRIGGER restriction_valid_insert BEFORE INSERT ON turn_restrictions BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM road_nodes n JOIN road_segments f ON f.id=NEW.from_segment_id
      JOIN road_segments t ON t.id=NEW.to_segment_id
      WHERE n.id=NEW.via_node_id AND n.dataset_id=NEW.dataset_id
        AND f.dataset_id=NEW.dataset_id AND t.dataset_id=NEW.dataset_id
        AND n.id IN (f.u_node_id, f.v_node_id) AND n.id IN (t.u_node_id, t.v_node_id)
    ) THEN RAISE(ABORT, 'restriction requires connected segments in dataset') END;
END;
CREATE TRIGGER restriction_valid_update BEFORE UPDATE ON turn_restrictions BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM road_nodes n JOIN road_segments f ON f.id=NEW.from_segment_id
      JOIN road_segments t ON t.id=NEW.to_segment_id
      WHERE n.id=NEW.via_node_id AND n.dataset_id=NEW.dataset_id
        AND f.dataset_id=NEW.dataset_id AND t.dataset_id=NEW.dataset_id
        AND n.id IN (f.u_node_id, f.v_node_id) AND n.id IN (t.u_node_id, t.v_node_id)
    ) THEN RAISE(ABORT, 'restriction requires connected segments in dataset') END;
END;
CREATE TRIGGER topology_dataset_insert AFTER INSERT ON dataset_sources BEGIN
    INSERT INTO network_topology_versions(dataset_id) VALUES (NEW.id);
END;
CREATE TRIGGER topology_segment_insert AFTER INSERT ON road_segments BEGIN
    INSERT INTO road_segment_directions(segment_id, dataset_id, direction, source)
    VALUES (NEW.id, NEW.dataset_id,
            CASE WHEN NEW.is_directed = 1 THEN 1 ELSE 0 END,
            CASE WHEN NEW.is_directed = 1 THEN 'legacy_is_directed' ELSE 'assumed_bidirectional' END);
END;
CREATE TRIGGER topology_direction_insert AFTER INSERT ON road_segment_directions BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id;
END;
CREATE TRIGGER topology_direction_update AFTER UPDATE ON road_segment_directions BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id AND NEW.dataset_id != OLD.dataset_id;
END;
CREATE TRIGGER topology_direction_delete AFTER DELETE ON road_segment_directions BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
END;
CREATE TRIGGER topology_turn_insert AFTER INSERT ON turn_restrictions BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id;
END;
CREATE TRIGGER topology_turn_update AFTER UPDATE ON turn_restrictions BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id AND NEW.dataset_id != OLD.dataset_id;
END;
CREATE TRIGGER topology_turn_delete AFTER DELETE ON turn_restrictions BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
END;
CREATE TRIGGER topology_segment_update AFTER UPDATE OF u_node_id, v_node_id, length_m ON road_segments BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id;
END;
CREATE TRIGGER topology_lixel_insert AFTER INSERT ON road_lixels BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id;
END;
CREATE TRIGGER topology_lixel_update AFTER UPDATE OF dataset_id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m ON road_lixels BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id AND NEW.dataset_id != OLD.dataset_id;
END;
CREATE TRIGGER topology_lixel_delete AFTER DELETE ON road_lixels BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
END;
CREATE TRIGGER topology_segment_reassign BEFORE UPDATE OF dataset_id ON road_segments WHEN OLD.dataset_id != NEW.dataset_id BEGIN
    SELECT RAISE(ABORT, 'moving segments between datasets is not supported');
END;
CREATE TRIGGER topology_segment_endpoints BEFORE UPDATE OF u_node_id, v_node_id ON road_segments
WHEN EXISTS (SELECT 1 FROM turn_restrictions WHERE from_segment_id=OLD.id OR to_segment_id=OLD.id) BEGIN
    SELECT RAISE(ABORT, 'remove turn restrictions before changing segment endpoints');
END;
