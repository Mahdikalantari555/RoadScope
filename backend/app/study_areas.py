from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable

from pyproj import CRS

from .config import extra_study_area_files

WORLD_BOUNDS = {"min_lon": -180.0, "min_lat": -85.05112878, "max_lon": 180.0, "max_lat": 85.05112878}


@dataclass(frozen=True)
class StudyArea:
    """A place the platform can ingest data for.

    Nothing in the ingestion path is bound to a specific city: a study area only describes
    *which* metric CRS is used for storage/computation, an optional (never mandatory)
    geographic boundary, the map centre, and the provenance of its demo road network.
    """

    key: str
    name_en: str
    name_fa: str
    country_code: str
    canonical_epsg: int
    center_4326: tuple[float, float]
    label_en: str = ""
    label_fa: str = ""
    boundary_4326: dict[str, float] | None = None
    network_source: str = "imported"
    network_generator: str | None = None
    demo: bool = False
    hidden: bool = False
    notes: str = ""

    def to_json(self, *, include_boundary: bool = True) -> dict[str, Any]:
        payload = {
            "key": self.key,
            "name_en": self.name_en,
            "name_fa": self.name_fa,
            "country_code": self.country_code,
            "canonical_epsg": self.canonical_epsg,
            "canonical_crs_name": crs_name(self.canonical_epsg),
            "center_4326": list(self.center_4326),
            "label_en": self.label_en or self.name_en,
            "label_fa": self.label_fa or self.name_en,
            "network_source": self.network_source,
            "network_generator": self.network_generator,
            "demo": self.demo,
            "notes": self.notes,
            "bounded": self.boundary_4326 is not None,
            "has_generated_demo_network": self.network_generator is not None,
        }
        if include_boundary:
            payload["boundary_4326"] = self.boundary_4326
        return payload


def crs_name(epsg: int) -> str:
    try:
        return CRS.from_epsg(int(epsg)).name
    except Exception:  # pragma: no cover - pyproj data issue only
        return f"EPSG:{epsg}"


def _parse_boundary(raw: Any) -> dict[str, float] | None:
    if not raw:
        return None
    if isinstance(raw, dict) and {"min_lon", "min_lat", "max_lon", "max_lat"} <= set(raw):
        box = {k: float(raw[k]) for k in ("min_lon", "min_lat", "max_lon", "max_lat")}
    elif isinstance(raw, (list, tuple)) and len(raw) == 4:
        box = {
            "min_lon": float(raw[0]),
            "min_lat": float(raw[1]),
            "max_lon": float(raw[2]),
            "max_lat": float(raw[3]),
        }
    else:
        raise ValueError("boundary_4326 must be a bbox [min_lon, min_lat, max_lon, max_lat]")
    if not (WORLD_BOUNDS["min_lon"] <= box["min_lon"] < box["max_lon"] <= WORLD_BOUNDS["max_lon"]):
        raise ValueError("boundary_4326 longitudes must satisfy -180 <= min < max <= 180")
    if not (WORLD_BOUNDS["min_lat"] <= box["min_lat"] < box["max_lat"] <= WORLD_BOUNDS["max_lat"]):
        raise ValueError("boundary_4326 latitudes must satisfy -85.05 <= min < max <= 85.05")
    return box


def _from_dict(raw: dict[str, Any]) -> StudyArea:
    key = str(raw["key"]).strip()
    if not key or not all(ch.isalnum() or ch in "-_" for ch in key):
        raise ValueError(f"Invalid study area key {key!r}: use letters, digits, '-' or '_'")
    epsg = int(raw.get("canonical_epsg", 3857))
    try:
        crs = CRS.from_epsg(epsg)
    except Exception as exc:  # pragma: no cover - invalid user input
        raise ValueError(f"Unknown canonical_epsg {epsg}: {exc}") from exc
    if not crs.is_projected:
        raise ValueError(f"canonical_epsg {epsg} must be a projected metric CRS, not geographic")
    center = raw.get("center_4326") or [0.0, 0.0]
    if len(center) != 2:
        raise ValueError("center_4326 must be [lon, lat]")
    return StudyArea(
        key=key,
        name_en=str(raw.get("name_en") or key),
        name_fa=str(raw.get("name_fa") or raw.get("name_en") or key),
        country_code=str(raw.get("country_code") or ""),
        canonical_epsg=epsg,
        center_4326=(float(center[0]), float(center[1])),
        label_en=str(raw.get("label_en") or ""),
        label_fa=str(raw.get("label_fa") or ""),
        boundary_4326=_parse_boundary(raw.get("boundary_4326")),
        network_source=str(raw.get("network_source") or "imported"),
        network_generator=raw.get("network_generator"),
        demo=bool(raw.get("demo", False)),
        hidden=bool(raw.get("hidden", False)),
        notes=str(raw.get("notes") or ""),
    )


def _load_json_files(paths: Iterable[Path]) -> list[StudyArea]:
    areas: list[StudyArea] = []
    for path in paths:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        entries = raw if isinstance(raw, list) else [raw]
        for entry in entries:
            try:
                areas.append(_from_dict(entry))
            except (ValueError, KeyError) as exc:
                raise ValueError(f"Invalid study area in {path}: {exc}") from exc
    return areas


def _builtin_areas() -> list[StudyArea]:
    return [
        StudyArea(
            key="tehran",
            name_en="Tehran",
            name_fa="تهران",
            country_code="IR",
            canonical_epsg=3857,
            center_4326=(51.3890, 35.6892),
            label_en="Tehran Metropolitan Area (demo)",
            label_fa="منطقهٔ کلان‌شهری تهران (نسخهٔ نمایشی)",
            boundary_4326={"min_lon": 51.05, "min_lat": 35.52, "max_lon": 51.62, "max_lat": 35.86},
            network_source="seeded_demo",
            network_generator="tehran_demo_v1",
            demo=True,
            notes=(
                "Demo study area: the road network is a labelled synthetic realisation used for "
                "research demonstration only. Real ingestion can target any coordinate."
            ),
        )
    ]


class StudyAreaRegistry:
    """Runtime registry of study areas (built-ins + JSON/user defined + in-memory)."""

    def __init__(self) -> None:
        self._areas: dict[str, StudyArea] = {}
        self.reload()

    def reload(self) -> None:
        areas = {a.key: a for a in _builtin_areas()}
        for area in _load_json_files(extra_study_area_files()):
            areas[area.key] = area
        self._areas = areas

    def all(self, *, include_hidden: bool = False) -> list[StudyArea]:
        values = [a for a in self._areas.values() if include_hidden or not a.hidden]
        return sorted(values, key=lambda a: (not a.demo, a.key))

    def get(self, key: str | None) -> StudyArea:
        if key:
            area = self._areas.get(key)
            if area is None:
                raise KeyError(key)
            return area
        return self.default()

    def default(self) -> StudyArea:
        forced = os.getenv("ROADSCOPE_DEFAULT_STUDY_AREA", os.getenv("UAI_DEFAULT_STUDY_AREA", "tehran"))
        if forced in self._areas:
            return self._areas[forced]
        visible = self.all()
        return visible[0] if visible else _builtin_areas()[0]

    def register(self, raw: dict[str, Any]) -> StudyArea:
        area = _from_dict(raw)
        self._areas[area.key] = area
        return area

    def remove(self, key: str) -> bool:
        if key not in {a.key for a in _builtin_areas()}:
            return self._areas.pop(key, None) is not None
        return False

    def payload(self) -> list[dict[str, Any]]:
        return [a.to_json() for a in self.all()]


REGISTRY = StudyAreaRegistry()


def get_study_area(key: str | None = None) -> StudyArea:
    return REGISTRY.get(key)


def list_study_areas() -> list[StudyArea]:
    return REGISTRY.all()


def register_study_area(raw: dict[str, Any]) -> StudyArea:
    return REGISTRY.register(raw)


def global_bounds() -> dict[str, float]:
    """Ingestion bounds used when a study area has no explicit boundary."""
    return dict(WORLD_BOUNDS)


def area_bounds(area: StudyArea | None) -> dict[str, float]:
    return dict(area.boundary_4326) if area and area.boundary_4326 else global_bounds()
