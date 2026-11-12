from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from pyproj import CRS

from .config import extra_study_area_files

WORLD_BOUNDS = {"min_lon": -180.0, "min_lat": -85.05112878, "max_lon": 180.0, "max_lat": 85.05112878}

# Central-Tehran analytical extent. This is a *recorded, versioned* provisional rectangle used for
# clipping and provenance, not an official administrative boundary. Task 1.1 in
# `openspec/changes/tehran-synthetic-demo/tasks.md` records the extract version, license, buffer
# and tile provider next to it; legal confirmation of the boundary remains an external decision.
TEHRAN_BOUNDARY_4326 = {"min_lon": 51.350, "min_lat": 35.660, "max_lon": 51.460, "max_lat": 35.770}
TEHRAN_BOUNDARY_BUFFER_M = 250.0


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
    boundary_buffer_m: float = 0.0
    network_source: str = "imported"
    network_generator: str | None = None
    demo: bool = False
    hidden: bool = False
    notes: str = ""
    # Recorded provenance for the analytical network (task 1.1): extract version, licensing,
    # attribution, snapshot date and the checksum of the pinned extract when one exists.
    extract_version: str = ""
    extract_license: str = ""
    extract_attribution: str = ""
    extract_snapshot_date: str = ""
    extract_checksum_sha256: str = ""
    # Basemap provider policy (task 2.2). An empty URL means "no provider configured", and the
    # client must fall back to the offline vector view with a visible warning.
    tile_provider_url: str = ""
    tile_provider_name: str = ""
    tile_provider_policy_url: str = ""
    disclaimer_en: str = ""
    disclaimer_fa: str = ""
    extras: dict[str, Any] = field(default_factory=dict)

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
            "hidden": self.hidden,
            "notes": self.notes,
            "bounded": self.boundary_4326 is not None,
            "has_generated_demo_network": self.network_generator is not None,
            "boundary_buffer_m": self.boundary_buffer_m,
            "provenance": {
                "extract_version": self.extract_version,
                "license": self.extract_license,
                "attribution": self.extract_attribution,
                "snapshot_date": self.extract_snapshot_date,
                "checksum_sha256": self.extract_checksum_sha256,
                "network_source": self.network_source,
                "incident_provenance": "synthetic" if self.demo else "unverified",
            },
            "basemap": {
                "tile_url": self.tile_provider_url,
                "name": self.tile_provider_name,
                "policy_url": self.tile_provider_policy_url,
                "optional": True,
            },
            "disclaimer_en": self.disclaimer_en,
            "disclaimer_fa": self.disclaimer_fa,
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
    basemap = raw.get("basemap") if isinstance(raw.get("basemap"), dict) else {}
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
        boundary_buffer_m=float(raw.get("boundary_buffer_m") or 0.0),
        network_source=str(raw.get("network_source") or "imported"),
        network_generator=raw.get("network_generator"),
        demo=bool(raw.get("demo", False)),
        hidden=bool(raw.get("hidden", False)),
        notes=str(raw.get("notes") or ""),
        extract_version=str(raw.get("extract_version") or ""),
        extract_license=str(raw.get("extract_license") or ""),
        extract_attribution=str(raw.get("extract_attribution") or ""),
        extract_snapshot_date=str(raw.get("extract_snapshot_date") or ""),
        extract_checksum_sha256=str(raw.get("extract_checksum_sha256") or ""),
        tile_provider_url=str(basemap.get("tile_url") or raw.get("tile_provider_url") or ""),
        tile_provider_name=str(basemap.get("name") or raw.get("tile_provider_name") or ""),
        tile_provider_policy_url=str(
            basemap.get("policy_url") or raw.get("tile_provider_policy_url") or ""
        ),
        disclaimer_en=str(raw.get("disclaimer_en") or ""),
        disclaimer_fa=str(raw.get("disclaimer_fa") or ""),
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
    """Built-in study areas.

    * ``tehran`` — the default **synthetic demonstration** network. Incident content is
      synthetic; the metric CRS is central-Tehran UTM 39N (EPSG:32639) as required by
      ``tehran-synthetic-demo``. The committed geometry is a labelled fictional realisation, not
      a surveyed street network; a real OSM extract is imported with
      ``POST /api/v1/ingest/network`` and is *not* the default.
    * ``frankfurt`` — a hidden, legacy-profile area kept only so pre-generalization EPSG:25832
      databases remain documented and reachable. It is never presented as the normal workflow.
    """
    return [
        StudyArea(
            key="tehran",
            name_en="Tehran",
            name_fa="تهران",
            country_code="IR",
            canonical_epsg=32639,
            center_4326=(51.3890, 35.6892),
            label_en="Tehran Metropolitan Area (synthetic demo)",
            label_fa="منطقهٔ کلان‌شهری تهران (نسخهٔ نمایشی مصنوعی)",
            boundary_4326=dict(TEHRAN_BOUNDARY_4326),
            boundary_buffer_m=TEHRAN_BOUNDARY_BUFFER_M,
            network_source="seeded_demo",
            network_generator="tehran_demo_v1",
            demo=True,
            notes=(
                "Demo study area: the road network is a labelled synthetic realisation used for "
                "research demonstration only. The analytical CRS is EPSG:32639 (UTM 39N). Real "
                "ingestion can target any coordinate."
            ),
            extract_version="tehran_demo_v1+seed42",
            extract_license="Synthetic geometry; no OSM data is redistributed",
            extract_attribution="RoadScope synthetic network (not OpenStreetMap)",
            extract_snapshot_date="2026-11-10",
            tile_provider_url="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            tile_provider_name="OpenStreetMap raster tiles (optional)",
            tile_provider_policy_url="https://operations.osmfoundation.org/policies/tiles/",
            disclaimer_en=(
                "Synthetic incidents on a fictional road network. Not real crash locations, "
                "not measured exposure, and not validated Tehran risk."
            ),
            disclaimer_fa=(
                "رخدادهای مصنوعی روی شبکه‌ای خیالی؛ نه محل واقعی تصادف، نه تردد اندازه‌گیری‌شده "
                "و نه ریسک اعتبارسنجی‌شدهٔ تهران."
            ),
        ),
        StudyArea(
            key="frankfurt",
            name_en="Frankfurt (legacy profile)",
            name_fa="فرانکفورت (پروفایل قدیمی)",
            country_code="DE",
            canonical_epsg=25832,
            center_4326=(8.6821, 50.1109),
            label_en="Legacy EPSG:25832 database (not the default)",
            label_fa="پایگاه‌دادهٔ قدیمی EPSG:25832 (نه پیش‌فرض)",
            boundary_4326={"min_lon": 8.40, "min_lat": 50.00, "max_lon": 8.90, "max_lat": 50.25},
            network_source="legacy_database",
            demo=False,
            hidden=True,
            notes=(
                "Preserved legacy EPSG:25832 data. Read it with its documented profile; it is "
                "never relabelled or reinterpreted as Tehran."
            ),
            tile_provider_url="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            tile_provider_name="OpenStreetMap raster tiles (optional)",
            tile_provider_policy_url="https://operations.osmfoundation.org/policies/tiles/",
            disclaimer_en="Legacy research dataset. Do not present as current or as Tehran.",
            disclaimer_fa="مجموعه‌دادهٔ پژوهشی قدیمی. آن را جاری یا تهران معرفی نکنید.",
        ),
    ]


class StudyAreaRegistry:
    """Runtime registry of study areas (built-ins + JSON/user defined + in-memory).

    Built-in and file-defined areas carry CRS, boundary, extract provenance, tile policy and
    disclaimers. Only user-registered areas are round-tripped through the ``study_areas`` table.
    """

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
        return sorted(values, key=lambda a: (a.hidden, not a.demo, a.key))

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

    def register(self, raw: dict[str, Any], *, enforce_guard: bool = True) -> StudyArea:
        """Register a *user-supplied* study area.

        Persisted rows are a strictly smaller record than the in-code definition (they cannot
        carry the extract provenance, tile policy or disclaimer). A user update therefore only
        overrides an **existing user registration**; a built-in or file-defined area is protected
        so accidentally re-persisting a database row can never erase its recorded provenance.
        """
        area = _from_dict(raw)
        if enforce_guard and area.key in BUILTIN_AREA_KEYS:
            raise ValueError(
                f"Study area '{area.key}' is built in and cannot be re-registered through the API. "
                "Add an override JSON file in ROADSCOPE_STUDY_AREA_PATHS instead."
            )
        self._areas[area.key] = StudyArea(**{**area.__dict__, "extras": dict(area.extras)})
        return area

    def remove(self, key: str) -> bool:
        if key not in BUILTIN_AREA_KEYS:
            return self._areas.pop(key, None) is not None
        return False

    def payload(self, *, include_hidden: bool = False) -> list[dict[str, Any]]:
        return [a.to_json() for a in self.all(include_hidden=include_hidden)]


BUILTIN_AREA_KEYS = frozenset({"tehran", "frankfurt"})

REGISTRY = StudyAreaRegistry()


def get_study_area(key: str | None = None) -> StudyArea:
    return REGISTRY.get(key)


def list_study_areas(*, include_hidden: bool = False) -> list[StudyArea]:
    return REGISTRY.all(include_hidden=include_hidden)


def register_study_area(raw: dict[str, Any], *, enforce_guard: bool = True) -> StudyArea:
    return REGISTRY.register(raw, enforce_guard=enforce_guard)


def global_bounds() -> dict[str, float]:
    """Ingestion bounds used when a study area has no explicit boundary."""
    return dict(WORLD_BOUNDS)


def area_bounds(area: StudyArea | None) -> dict[str, float]:
    return dict(area.boundary_4326) if area and area.boundary_4326 else global_bounds()
