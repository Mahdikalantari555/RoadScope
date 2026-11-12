from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    scenario_key: Literal[
        "MULTI_COVARIATE_URBAN",
        "INTERSECTION_CLUSTERED",
        "DIURNAL_RUSH_HOUR_SHOCK",
        "UNIFORM_BASELINE",
    ] = "MULTI_COVARIATE_URBAN"
    lixel_resolution_m: float = Field(default=25.0, ge=10.0, le=100.0)
    random_seed: int = Field(default=42, ge=1, le=999999)
    base_intensity_scale: float = Field(default=1.0, ge=0.2, le=4.0)
    vgi_positional_sigma_m: float = Field(default=14.0, ge=2.0, le=60.0)
    vgi_duplicate_rate: float = Field(default=0.35, ge=0.0, le=1.0)
    vgi_false_alarm_count: int = Field(default=12, ge=0, le=100)
    study_period_years: float = Field(default=1.0, ge=0.25, le=5.0)
    actor_role: str = "simulation_scientist"


class DirectedTransportRequest(BaseModel):
    dataset_id: int | None = None
    segment_id: int = Field(gt=0)
    lixel_id: int = Field(gt=0)
    direction: Literal[-1, 1]
    mass: float = Field(default=1.0, ge=0.0, le=100000.0, allow_inf_nan=False)
    speed_m_s: float = Field(default=5.0, gt=0.0, le=70.0, allow_inf_nan=False)
    duration_s: float = Field(default=60.0, gt=0.0, le=3600.0, allow_inf_nan=False)
    steps: int = Field(default=8, ge=1, le=64)


class SnapConflatePreviewRequest(BaseModel):
    dataset_id: int | None = None
    lon: float | None = None
    lat: float | None = None
    x_m: float | None = None
    y_m: float | None = None
    observational_radius_m: float = Field(default=18.0, ge=2.0, le=250.0)
    occurred_at_utc: str
    category_code: str = "REAR_END"
    max_net_dist_m: float = Field(default=150.0, ge=20.0, le=500.0)
    max_time_diff_min: float = Field(default=75.0, ge=5.0, le=360.0)


class CitizenReportSubmitRequest(BaseModel):
    dataset_id: int | None = None
    lon: float | None = None
    lat: float | None = None
    x_m: float | None = None
    y_m: float | None = None
    observational_radius_m: float = Field(default=18.0, ge=2.0, le=250.0)
    occurred_at_utc: str
    reported_at_utc: str | None = None
    category_code: str = "REAR_END"
    severity_code: str = "PDO"
    involved_vehicles: int = Field(default=2, ge=0, le=20)
    involved_pedestrians: int = Field(default=0, ge=0, le=20)
    involved_cyclists: int = Field(default=0, ge=0, le=20)
    emergency_response_present: bool = False
    weather_condition: Literal["clear", "rain", "heavy_rain", "fog", "snow_ice"] = "clear"
    road_surface: Literal["dry", "wet", "standing_water", "icy"] = "dry"
    lighting_condition: Literal["daylight", "twilight", "night_lit", "night_unlit"] = "daylight"
    narrative: str = ""
    attachment_filenames: list[str] = Field(default_factory=list)
    selected_segment_id: int | None = None
    actor_role: str = "citizen_reporter"


class CorroborateRequest(BaseModel):
    witness_notes: str = ""
    observational_radius_m: float = Field(default=15.0, ge=2.0, le=200.0)
    actor_role: str = "citizen_reporter"


class StewardReviewRequest(BaseModel):
    accident_id: int
    new_status: Literal[
        "verified_canonical",
        "rejected_false_alarm",
        "flagged_review",
        "unverified_raw_vgi",
        "corroborated_pending",
    ]
    override_segment_id: int | None = None
    override_offset_m: float | None = None
    override_severity_code: str | None = None
    review_notes: str = ""
    actor_role: str = "data_steward"


class MergeDuplicateClusterRequest(BaseModel):
    canonical_id: int
    duplicate_ids: list[int]
    verify_canonical: bool = True
    review_notes: str = ""
    actor_role: str = "data_steward"


class NkdeRequest(BaseModel):
    dataset_id: int | None = None
    kernel: Literal["quartic", "epanechnikov", "gaussian"] = "quartic"
    bandwidth_m: float = Field(default=180.0, ge=15.0, le=1500.0)
    weighting: Literal["uniform", "epdo_severity", "credibility_weighted"] = "uniform"
    equal_split_mass_conserving: bool = True
    include_unverified_vgi: bool = False
    allocation_mode: Literal["hard", "fractional"] = "hard"
    top_hotspot_pct: float = Field(default=0.15, ge=0.05, le=0.40)
    actor_role: str = "gis_researcher"


class NetworkAutocorrelationRequest(BaseModel):
    dataset_id: int | None = None
    weight_scheme: Literal[
        "inverse_network_distance", "fixed_network_band", "k_order_contiguity"
    ] = "inverse_network_distance"
    distance_threshold_m: float = Field(default=200.0, ge=25.0, le=1000.0)
    contiguity_order_k: int = Field(default=3, ge=1, le=12)
    permutations: int = Field(default=499, ge=99, le=999)
    attribute_mode: Literal["crash_density", "epdo_rate", "raw_count"] = "crash_density"
    include_unverified_vgi: bool = False
    random_seed: int = 42
    actor_role: str = "gis_researcher"


class NetworkDbscanRequest(BaseModel):
    dataset_id: int | None = None
    eps_net_m: float = Field(default=85.0, ge=10.0, le=1000.0)
    min_samples: int = Field(default=4, ge=2, le=30)
    include_unverified_vgi: bool = False
    actor_role: str = "gis_researcher"


class RiskEbEvaluationRequest(BaseModel):
    dataset_id: int | None = None
    w_eb_risk: float = Field(default=0.40, ge=0.0, le=1.0)
    w_epdo_severity: float = Field(default=0.30, ge=0.0, le=1.0)
    w_geometric_hazard: float = Field(default=0.15, ge=0.0, le=1.0)
    w_environmental_cov: float = Field(default=0.15, ge=0.0, le=1.0)


class CmvQueryRequest(BaseModel):
    dataset_id: int | None = None
    verification_mode: Literal["verified_only", "all_active", "vgi_queue"] = "verified_only"
    start_utc: str | None = None
    end_utc: str | None = None
    severity_codes: list[str] | None = None
    category_codes: list[str] | None = None
    dow_filter: int | None = Field(default=None, ge=0, le=6)
    hour_filter: int | None = Field(default=None, ge=0, le=23)
    segment_id: int | None = None
    bbox_4326: list[float] | None = None
    polygon_4326: list[list[float]] | None = None


class CoordinateProjectRequest(BaseModel):
    lon: float | None = None
    lat: float | None = None
    x_m: float | None = None
    y_m: float | None = None
