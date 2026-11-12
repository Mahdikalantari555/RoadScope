#!/usr/bin/env python3
"""Render the presentation's interface figures from the *running* RoadScope data.

Why this script exists
----------------------
The presentation used to embed screenshots of an older Frankfurt (EPSG:25832) run. Those images
were accurate for that run and wrong for the current one: the shipped database is the synthetic
Tehran demo (EPSG:32639). Rather than edit a screenshot by hand — which would picture a UI that
never rendered — this script draws the panels the React interface renders from the *same recorded
API payloads*: ``/analytics/cmv``, ``/lab/nkde``, ``/research/tnkdE``, ``/research/bym2``,
``/research/hawkes`` and ``/research/maup-sensitivity``.

Consequences that must stay honest:

* Every number comes from the payload passed in; nothing is derived or invented here.
* Each figure's footer states it is a data-faithful re-render, not a browser capture.
* The synthetic banner is drawn on every figure, because the incidents are synthetic.
* Labels are Persian (Vazirmatn, SIL OFL, shipped in docs/presentation/fonts) with Latin technical
  terms kept in their own order, matching the app's RTL layout.

Usage
-----
    python scripts/render_presentation_figures.py \
        --payloads /tmp/tehran_api_out.json \
        --network /tmp/tehran_net.json \
        --out docs/presentation/screenshots

``docs/presentation/README_FA.md`` documents the recorded calls that produce the input files.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable, Sequence

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------------------------
# Design tokens (mirrors frontend/src/index.css and the slide palette)
# --------------------------------------------------------------------------------------------
BG = (2, 6, 23)
PANEL = (15, 23, 42)
PANEL_2 = (8, 17, 36)
BORDER = (51, 65, 85)
CYAN = (34, 211, 238)
EMERALD = (52, 211, 153)
AMBER = (251, 191, 36)
ROSE = (251, 113, 133)
PURPLE = (192, 132, 252)
TEXT = (248, 250, 252)
MUTED = (148, 163, 184)
DIM = (100, 116, 139)

SEVERITY_COLORS = {
    "PDO": (56, 189, 248),
    "MINOR_INJURY": (250, 204, 21),
    "SERIOUS_INJURY": (249, 115, 22),
    "FATAL": (239, 68, 68),
}
ROAD_COLORS = {
    "motorway_overpass": (56, 189, 248),
    "primary_arterial": (148, 163, 184),
    "secondary_corridor": (100, 116, 139),
    "collector": (71, 85, 105),
    "local_street": (51, 65, 85),
    "bridge_link": (34, 211, 238),
}

FONT_DIR = Path(__file__).resolve().parent.parent / "docs" / "presentation" / "fonts"
LATIN_DIR = Path("/usr/share/fonts/truetype/dejavu")
_FONT_CACHE: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in _FONT_CACHE:
        name = "Vazirmatn-Bold.ttf" if bold else "Vazirmatn-Regular.ttf"
        _FONT_CACHE[key] = ImageFont.truetype(str(FONT_DIR / name), size)
    return _FONT_CACHE[key]


def mono(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSansMono-Bold.ttf" if bold else "DejaVuSansMono.ttf"
    return ImageFont.truetype(str(LATIN_DIR / name), size)


# --------------------------------------------------------------------------------------------
# Persian shaping + bidi. PIL draws glyph-by-glyph, so without this Persian appears as
# disconnected letters in reverse order.
# --------------------------------------------------------------------------------------------
_LATIN_TOKEN = re.compile(r"[A-Za-z0-9_.,%/+:\-·×^=<>~()\[\]|\\@#$&*'\"]+")


def shape_rtl(text: str) -> str:
    """Shape Arabic/Persian letters contextually, then resolve visual (RTL) order."""
    if not any("\u0600" <= ch <= "\u06FF" for ch in text):
        return text
    protected: dict[str, str] = {}

    def stash(match: re.Match[str]) -> str:
        key = f"\uE000{len(protected)}\uE001"
        protected[key] = match.group(0)
        return key

    guarded = _LATIN_TOKEN.sub(stash, text)
    visual = get_display(arabic_reshaper.reshape(guarded), base_dir="R")
    for key, value in protected.items():
        visual = visual.replace(get_display(key, base_dir="R"), value).replace(key, value)
    return visual


def draw_rtl(draw: ImageDraw.ImageDraw, xy, text: str, *, size: int = 16,
             fill=TEXT, anchor_right: float | None = None, bold: bool = False) -> float:
    """Draw one RTL line, right-aligned at ``anchor_right`` (defaults to ``xy[0]``)."""
    right = anchor_right if anchor_right is not None else xy[0]
    visual = shape_rtl(text)
    draw.text((right, xy[1]), visual, font=font(size, bold), fill=fill, anchor="ra")
    return draw.textlength(visual, font=font(size, bold))


def draw_ltr(draw: ImageDraw.ImageDraw, xy, text: str, *, size: int = 12,
             fill=MUTED, anchor="la", bold: bool = False) -> float:
    draw.text(xy, text, font=mono(size, bold), fill=fill, anchor=anchor)
    return draw.textlength(text, font=mono(size, bold))


def fit(draw: ImageDraw.ImageDraw, text: str, max_width: float, *, size: int,
        bold: bool = False, rtl: bool = True) -> str:
    """Truncate with an ellipsis so a long name can never overlap a neighbouring element."""
    f = font(size, bold) if rtl else mono(size, bold)
    measure = (lambda value: draw.textlength(shape_rtl(value), font=f)) if rtl \
        else (lambda value: draw.textlength(value, font=f))
    if measure(text) <= max_width:
        return text
    cut = text
    while cut and measure(cut + "…") > max_width:
        cut = cut[:-1]
    return cut + "…"


def rtl_lines(text: str, size: int, max_width: float) -> list[str]:
    """Wrap Persian on the *shaped* width, reordering each line on its own.

    Reordering a paragraph once and then splitting the visual string breaks word order across
    the break, so every line is shaped and reordered independently here.
    """
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    f = font(size)
    lines: list[str] = []
    current: list[str] = []
    for word in text.split():
        candidate = " ".join(current + [word])
        if probe.textlength(shape_rtl(candidate), font=f) <= max_width or not current:
            current.append(word)
        else:
            lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def draw_rtl_paragraph(draw: ImageDraw.ImageDraw, x_right: float, y: float, text: str, *,
                       size: int = 10, fill=TEXT, line_height: int = 16,
                       max_width: float, bold: bool = False) -> float:
    """Right-aligned RTL paragraph. Returns the y below the last line."""
    for line in rtl_lines(text, size, max_width):
        draw_rtl(draw, (x_right, y), line, size=size, fill=fill, bold=bold, anchor_right=x_right)
        y += line_height
    return y


# --------------------------------------------------------------------------------------------
# Chrome
# --------------------------------------------------------------------------------------------
TABS_FA = [
    "تحلیل هماهنگ",
    "آزمایشگاه مکانی",
    "ریسک و بیز",
    "تولی‌گری",
    "شبیه‌ساز",
    "گزارش شهروندی",
    "گزارش محدود",
]
W, H = 1760, 1100
M = 24
LEFT_X0, LEFT_X1 = M, 760
RIGHT_X0, RIGHT_X1 = 776, W - M


def panel(draw, box, *, fill=PANEL, outline=BORDER, radius=10):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)


def card_title(draw, box, title_fa: str, note_latin: str = "", *, y=None, color=TEXT):
    """Card header: Persian title on the right, a Latin note on the left."""
    x1 = box[2] - 14
    top = box[1] + 10 if y is None else y
    draw_rtl(draw, (x1, top), title_fa, size=13, fill=color, bold=True, anchor_right=x1)
    if note_latin:
        draw_ltr(draw, (box[0] + 14, top + 2), note_latin, size=10, fill=DIM)
    return top + 26


def header(draw, *, dataset_name: str, crs: str, synthetics: bool, active_tab: int,
           subtitle: str) -> int:
    """Product mark, dataset banner, tabs and active filters. Returns the first content y."""
    draw.text((W - M, 12), "RoadScope", font=font(22, True), fill=TEXT, anchor="ra")
    draw_ltr(draw, (M, 14), "Network-Constrained Spatiotemporal GIScience", size=10, fill=DIM)
    draw_ltr(draw, (M, 28), f"CRS {crs} · WGS84 GeoJSON boundary", size=10, fill=CYAN)

    # Tabs: right to left, in HeaderBar order, underlined when active.
    y = 46
    x = W - M
    for index, label in enumerate(TABS_FA):
        f = font(12.5 if index == active_tab else 12, index == active_tab)
        visual = shape_rtl(label)
        w = draw.textlength(visual, font=f)
        x -= w
        draw.text((x, y), visual, font=f, fill=CYAN if index == active_tab else MUTED)
        if index == active_tab:
            draw.line([(x, y + 19), (x + w, y + 19)], fill=CYAN, width=2)
        x -= 18
    draw.line([(M, y + 28), (W - M, y + 28)], fill=BORDER, width=1)

    # Dataset identity: truncated so it can never reach the logo.
    y += 38
    name = fit(draw, dataset_name, W - 2 * M - 150, size=12, bold=True)
    draw_rtl(draw, (W - M, y), name, size=12, fill=MUTED, anchor_right=W - M)

    # The dataset banner is mandatory: profile + synthetic status + the reason this screenshot exists.
    y += 24
    badge = "دادهٔ مصنوعی" if synthetics else "دادهٔ واقعی"
    badge_font = font(11, True)
    badge_w = draw.textlength(shape_rtl(badge), font=badge_font) + 20
    panel(draw, (W - M - badge_w, y - 3, W - M, y + 19), fill=(69, 26, 3), outline=AMBER, radius=10)
    draw.text((W - M - 10, y), shape_rtl(badge), font=badge_font, fill=AMBER, anchor="ra")
    subtitle_text = fit(draw, subtitle, W - 2 * M - badge_w - 40, size=11)
    draw_rtl(draw, (W - M - badge_w - 12, y), subtitle_text, size=11, fill=MUTED,
             anchor_right=W - M - badge_w - 12)

    # Active filters, visible because a screenshot must carry the query it visualises.
    y += 26
    chips = ["verified_only", "Σ EPDO weighting", "2025-11-10 → 2026-11-06", "tehran · bbox"]
    x = M
    for chip in chips:
        w = draw.textlength(chip, font=mono(10)) + 18
        panel(draw, (x, y, x + w, y + 20), fill=PANEL_2, outline=BORDER, radius=10)
        draw_ltr(draw, (x + 9, y + 4), chip, size=10, fill=MUTED)
        x += w + 8
    return y + 30


def footer(draw, note_fa: str, source_latin: str, right_latin: str = ""):
    draw.line([(M, H - 74), (W - M, H - 74)], fill=BORDER, width=1)
    draw_rtl(draw, (W - M, H - 64), note_fa, size=11, fill=DIM, anchor_right=W - M)
    draw_ltr(draw, (M, H - 62), source_latin, size=10, fill=DIM)
    if right_latin:
        draw_ltr(draw, (W - M, H - 30), right_latin, size=9, fill=DIM, anchor="ra")
    draw_ltr(draw, (M, H - 42), "synthetic incidents · not real crash locations · research prototype",
             size=10, fill=AMBER)


def legend(draw, x_right: float, y: float, items: list[tuple[str, tuple[int, int, int]]]):
    x = x_right
    for label, color in items:
        w = draw.textlength(label, font=mono(10))
        draw.text((x, y), label, font=mono(10), fill=MUTED, anchor="ra")
        x -= w + 6
        draw.rounded_rectangle((x - 10, y + 2, x, y + 12), radius=2, fill=color)
        x -= 20


def kpi_card(draw, box, *, label_fa: str, value: str, unit: str = "", color=CYAN,
             note: str = "", note_fa: str = ""):
    """One metric card. The value is right-aligned and the unit sits to its left, so a long
    number can never be clipped by the unit."""
    panel(draw, box)
    x1 = box[2] - 14
    draw.text((x1, box[1] + 8), value, font=mono(22, True), fill=color, anchor="ra")
    label_y = box[1] + 38
    if unit:
        # The unit sits on the far left of the card, so it can never collide with the value of
        # the neighbouring card.
        draw.text((box[0] + 12, box[1] + 18), unit, font=mono(10), fill=MUTED, anchor="la")
    label = fit(draw, label_fa, box[2] - box[0] - 28, size=11)
    draw_rtl(draw, (x1, label_y), label, size=11, fill=MUTED, anchor_right=x1)
    detail = note_fa or note
    if detail:
        detail = fit(draw, detail, box[2] - box[0] - 28, size=10)
        draw_rtl(draw, (x1, label_y + 18), detail, size=10, fill=DIM, anchor_right=x1)


def hbar(draw, x0: float, x1: float, y: float, fraction: float, color,
         *, height: float = 9, track=True):
    if track:
        draw.rounded_rectangle((x0, y, x1, y + height), radius=height / 2, fill=(30, 41, 59))
    width = max(2.0, (x1 - x0) * max(0.0, min(1.0, fraction)))
    draw.rounded_rectangle((x1 - width, y, x1, y + height), radius=height / 2, fill=color)


# --------------------------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------------------------
def project_factory(bbox: dict[str, float], box: Sequence[float]):
    """Fit a lon/lat bbox into ``box`` keeping metres square.

    A degree of longitude at Tehran's latitude is ~0.81 of a degree of latitude, so the lon span is
    scaled by cos(lat): without it every map would be stretched ~23% horizontally.
    """
    x0, y0, x1, y1 = box
    mid_lat = math.radians((bbox["min_lat"] + bbox["max_lat"]) / 2)
    k = math.cos(mid_lat)
    span_x = max(1e-9, (bbox["max_lon"] - bbox["min_lon"]) * k)
    span_y = max(1e-9, bbox["max_lat"] - bbox["min_lat"])
    scale = min((x1 - x0) / span_x, (y1 - y0) / span_y)
    off_x = x0 + ((x1 - x0) - span_x * scale) / 2
    off_y = y0 + ((y1 - y0) - span_y * scale) / 2

    def project(lon: float, lat: float) -> tuple[float, float]:
        return (off_x + (lon - bbox["min_lon"]) * k * scale,
                off_y + (bbox["max_lat"] - lat) * scale)

    return project


def expand_to_aspect(bbox: dict[str, float], box: Sequence[float]) -> dict[str, float]:
    """Pad a bbox until its metric aspect ratio matches the canvas, so nothing is letterboxed."""
    mid_lat = math.radians((bbox["min_lat"] + bbox["max_lat"]) / 2)
    k = math.cos(mid_lat)
    span_x = (bbox["max_lon"] - bbox["min_lon"]) * k
    span_y = bbox["max_lat"] - bbox["min_lat"]
    target = (box[2] - box[0]) / max(1, (box[3] - box[1]))
    if span_x / span_y < target:
        span_x = span_y * target
    else:
        span_y = span_x / target
    cx = (bbox["min_lon"] + bbox["max_lon"]) / 2
    cy = (bbox["min_lat"] + bbox["max_lat"]) / 2
    half_lon = span_x / k / 2
    half_lat = span_y / 2
    return {"min_lon": cx - half_lon, "max_lon": cx + half_lon,
            "min_lat": cy - half_lat, "max_lat": cy + half_lat}


class MapCanvas:
    """A clipped drawing surface for a map panel.

    Everything the network draws is projected across the whole figure, so without a clip the long
    corridors run out of the panel and over the header. The panel content is painted on its own
    layer and pasted through a rounded mask, and the panel border is drawn afterwards on top.
    """

    def __init__(self, img: Image.Image, box: Sequence[float]):
        self.img = img
        self.box = tuple(int(v) for v in box)
        self.layer = Image.new("RGB", img.size, (4, 9, 22))
        self.draw = ImageDraw.Draw(self.layer)

    def commit(self) -> None:
        x0, y0, x1, y1 = self.box
        mask = Image.new("L", (x1 - x0, y1 - y0), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, x1 - x0 - 1, y1 - y0 - 1), radius=10, fill=255)
        self.img.paste(self.layer.crop(self.box), (x0, y0), mask)
        ImageDraw.Draw(self.img).rounded_rectangle(self.box, radius=10, outline=(30, 41, 59), width=1)


def network_bbox(features: list[dict[str, Any]]) -> dict[str, float]:
    lons, lats = [], []
    for feature in features:
        for lon, lat in feature["geometry"]["coordinates"]:
            lons.append(lon)
            lats.append(lat)
    return {"min_lon": min(lons), "min_lat": min(lats),
            "max_lon": max(lons), "max_lat": max(lats)}


ROAD_ORDER = {"local_street": 0, "collector": 1, "secondary_corridor": 2,
              "primary_arterial": 3, "bridge_link": 4, "motorway_overpass": 5}
ROAD_WEIGHT = {"motorway_overpass": 5.0, "bridge_link": 5.0, "primary_arterial": 4.2,
               "secondary_corridor": 3.2, "collector": 2.4, "local_street": 1.9}


def draw_network(draw, segments: Iterable[dict[str, Any]], project, *, width_scale: float = 1.0,
                 alpha_map: dict[str, tuple[int, int, int]] | None = None):
    for feature in sorted(segments, key=lambda f: ROAD_ORDER.get(f["properties"]["road_class"], 0)):
        props = feature["properties"]
        cls = props["road_class"]
        color = (alpha_map or ROAD_COLORS).get(cls, ROAD_COLORS["local_street"])
        coords = [project(lon, lat) for lon, lat in feature["geometry"]["coordinates"]]
        draw.line(coords, fill=color, width=max(1, round(ROAD_WEIGHT[cls] * width_scale)), joint="curve")


def heat_color(value: float, vmax: float) -> tuple[int, int, int]:
    """Sequential blue → cyan → amber → red ramp for density and posterior maps."""
    t = 0.0 if vmax <= 0 else max(0.0, min(1.0, value / vmax))
    stops = [(0.0, (10, 22, 40)), (0.22, (13, 92, 120)), (0.45, (34, 211, 238)),
             (0.7, (250, 204, 21)), (1.0, (239, 68, 68))]
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(round(c0[i] + (c1[i] - c0[i]) * k) for i in range(3))  # type: ignore[return-value]
    return stops[-1][1]


def ramp_legend(draw, x_right: float, y_top: float, height: float, vmax_label: str,
                title_fa: str, steps: int = 56):
    """Vertical colour ramp with its max/min labels and a caption that stays inside the panel."""
    for step in range(steps):
        t = 1 - step / (steps - 1)
        draw.rectangle((x_right - 10, y_top + step * (height / steps),
                        x_right, y_top + (step + 1) * (height / steps) + 0.5),
                       fill=heat_color(t, 1.0))
    draw_ltr(draw, (x_right - 13, y_top - 14), vmax_label, size=10, fill=MUTED, anchor="ra")
    draw_ltr(draw, (x_right - 13, y_top + height + 2), "0", size=10, fill=MUTED, anchor="ra")
    draw_rtl(draw, (x_right - 2, y_top + height + 20), title_fa, size=9, fill=DIM,
             anchor_right=x_right - 2)


def map_panel(draw, box, *, title_fa: str, subtitle_latin: str = ""):
    panel(draw, box, fill=(4, 9, 22), outline=(30, 41, 59))
    if title_fa:
        draw_rtl(draw, (box[2] - 14, box[1] + 10), title_fa, size=12, fill=MUTED, bold=True,
                 anchor_right=box[2] - 14)
    if subtitle_latin:
        draw_ltr(draw, (box[0] + 14, box[1] + 12), subtitle_latin, size=10, fill=DIM)


def graticule(draw, box, project, bbox, step: float = 0.01):
    lon = math.ceil(bbox["min_lon"] / step) * step
    while lon <= bbox["max_lon"]:
        x, _ = project(lon, bbox["min_lat"])
        draw.line([(x, box[1] + 4), (x, box[3] - 4)], fill=(17, 24, 39), width=1)
        draw.text((x + 3, box[3] - 17), f"{lon:.2f}E", font=mono(9), fill=(58, 74, 96))
        lon += step
    lat = math.ceil(bbox["min_lat"] / step) * step
    while lat <= bbox["max_lat"]:
        _, y = project(bbox["min_lon"], lat)
        draw.line([(box[0] + 4, y), (box[2] - 4, y)], fill=(17, 24, 39), width=1)
        draw.text((box[0] + 8, y + 1), f"{lat:.2f}N", font=mono(9), fill=(58, 74, 96))
        lat += step


def scale_bar(draw, box, bbox):
    lon_per_px = (bbox["max_lon"] - bbox["min_lon"]) / max(1, box[2] - box[0])
    metres_per_px = lon_per_px * 111_320 * math.cos(math.radians(35.70))
    bar_px = 1000 / metres_per_px
    bx, by = box[0] + 20, box[3] - 26
    draw.line([(bx, by), (bx + bar_px, by)], fill=MUTED, width=2)
    for edge in (bx, bx + bar_px):
        draw.line([(edge, by - 4), (edge, by + 4)], fill=MUTED, width=2)
    draw.text((bx + bar_px / 2, by + 6), "1 km", font=mono(10), fill=MUTED, anchor="ma")


def attribution(draw, box):
    draw_rtl(draw, (box[2] - 14, box[3] - 40),
             "شبکهٔ مصنوعی تهران · رخدادها شبیه‌سازی‌شده‌اند", size=10, fill=DIM,
             anchor_right=box[2] - 14)


def bbox_from_points(points: Iterable[Sequence[float]], pad: float = 0.0022) -> dict[str, float]:
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    return {"min_lon": min(lons) - pad, "max_lon": max(lons) + pad,
            "min_lat": min(lats) - pad, "max_lat": max(lats) + pad}


# --------------------------------------------------------------------------------------------
# Figures
# --------------------------------------------------------------------------------------------
DAY_FA = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"]  # ISO: 0 = Monday


def flow(*heights, start: float, gap: int = 12):
    """Yield (box, next_start) boxes from a top-down flow so a panel can never overlap its neighbour."""
    y = start
    for height in heights:
        yield (y, y + height)
        y += height + gap


def figure_cmv(payload, network, out: Path) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    cmv = payload["cmv"]
    features = network["segments_geojson"]["features"]
    meta = network.get("meta_presentation") or {}
    kpis = cmv["kpis"]

    y = header(
        draw,
        dataset_name=meta.get("dataset_name", ""),
        crs=meta.get("canonical_crs", "EPSG:32639"),
        synthetics=bool(meta.get("synthetic_incidents", True)),
        active_tab=0,
        subtitle="تحلیل هماهنگ چندنمایه · فیلترها هم‌زمان بر نقشه، نمودارها و فهرست معابر اثر می‌گذارند",
    )

    # ---- Map (right) ---------------------------------------------------------------------
    map_box = (RIGHT_X0, y, RIGHT_X1, H - 88)
    map_panel(draw, map_box, title_fa="", subtitle_latin="GET /network/layers · POST /analytics/cmv")
    inner = (map_box[0] + 14, map_box[1] + 40, map_box[2] - 14, map_box[3] - 64)
    bbox = expand_to_aspect(network_bbox(features), inner)
    canvas = MapCanvas(img, map_box)
    project = project_factory(bbox, inner)
    graticule(canvas.draw, inner, project, bbox)
    draw_network(canvas.draw, features, project, width_scale=1.3)
    for feature in cmv["incidents_geojson"]["features"]:
        props = feature["properties"]
        x, yy = project(*feature["geometry"]["coordinates"])
        color = SEVERITY_COLORS.get(props.get("severity_code", "PDO"), SEVERITY_COLORS["PDO"])
        r = 3.0 + (props.get("severity_rank", 1) - 1) * 1.1
        canvas.draw.ellipse((x - r, yy - r, x + r, yy + r), fill=color, outline=(2, 6, 23))
    top = cmv["top_segments"][0]
    for feature in features:
        if feature["properties"]["segment_id"] != top["segment_id"]:
            continue
        coords = [project(lo, la) for lo, la in feature["geometry"]["coordinates"]]
        mid = coords[len(coords) // 2]
        canvas.draw.text((mid[0] + 12, mid[1] - 26), f"#{top['segment_id']} selected", font=mono(10),
                         fill=CYAN)
        canvas.draw.line([(mid[0] + 6, mid[1] - 16), (mid[0], mid[1] - 4)], fill=CYAN, width=1)
    canvas.commit()
    legend(draw, map_box[2] - 14, map_box[1] + 46,
           [("FATAL", SEVERITY_COLORS["FATAL"]), ("SERIOUS", SEVERITY_COLORS["SERIOUS_INJURY"]),
            ("MINOR", SEVERITY_COLORS["MINOR_INJURY"]), ("PDO", SEVERITY_COLORS["PDO"])])
    scale_bar(draw, map_box, bbox)
    attribution(draw, map_box)
    draw_rtl(draw, (map_box[2] - 14, map_box[3] - 60),
             f"میانگین رانش نگاشت {kpis['mean_snap_drift_m']:.2f} متر · اعتبار میانگین {kpis['mean_credibility']:.2f}",
             size=10, fill=MUTED, anchor_right=map_box[2] - 14)

    # ---- KPI row (left) ------------------------------------------------------------------
    gap = 10
    card_w = (LEFT_X1 - LEFT_X0 - 2 * gap) / 3
    for index, spec in enumerate([
        dict(label_fa="رخدادهای فیلترشده", value=f"{kpis['filtered_incidents']:,}", color=CYAN,
             note_fa="verified_only"),
        dict(label_fa="مجموع وزن شدت", value=f"{kpis['total_epdo']:,.1f}", unit="EPDO", color=ROSE,
             note_fa="Σ وزن × شدت"),
        dict(label_fa="سهم فوتی و جرحی شدید", value=f"{kpis['ksi_share_pct']:.1f}", unit="%",
             color=AMBER, note_fa=f"KSI = {kpis['ksi_severe_fatal_count']}"),
    ]):
        x0 = LEFT_X0 + index * (card_w + gap)
        kpi_card(draw, (x0, y, x0 + card_w, y + 82), **spec)

    # ---- Severity composition ------------------------------------------------------------
    y2 = y + 94
    box = (LEFT_X0, y2, LEFT_X1, y2 + 168)
    panel(draw, box)
    card_title(draw, box, "ترکیب شدت", "count · EPDO sum")
    vmax = max(item["count"] for item in cmv["severity_breakdown"])
    row = y2 + 40
    for item in cmv["severity_breakdown"]:
        color = SEVERITY_COLORS.get(item["code"], CYAN)
        draw_rtl(draw, (LEFT_X1 - 14, row), item["label"], size=11, fill=TEXT, anchor_right=LEFT_X1 - 14)
        draw.text((LEFT_X1 - 158, row + 1), f"{item['count']:,}", font=mono(11), fill=color, anchor="ra")
        draw.text((LEFT_X0 + 16, row + 1), f"{item['epdo_sum']:,.1f}", font=mono(10), fill=DIM)
        hbar(draw, LEFT_X0 + 74, LEFT_X1 - 176, row + 16, item["count"] / vmax, color)
        row += 31

    # ---- Diurnal matrix ------------------------------------------------------------------
    y3 = y2 + 180
    box = (LEFT_X0, y3, LEFT_X1, y3 + 226)
    panel(draw, box)
    top_y = card_title(draw, box, "ماتریس روز × ساعت", "7 × 24 · UTC")
    matrix = cmv["diurnal_matrix"]
    cell = 20
    gx1 = LEFT_X1 - 90
    gx0 = gx1 - 24 * cell
    gy0 = top_y + 20
    peak = max(max(r) for r in matrix) or 1
    for di, day in enumerate(matrix):
        draw_rtl(draw, (LEFT_X1 - 12, gy0 + di * cell + 4), DAY_FA[di], size=9, fill=MUTED,
                 anchor_right=LEFT_X1 - 12)
        for hi, value in enumerate(day):
            x0 = gx1 - (hi + 1) * cell
            draw.rectangle((x0, gy0 + di * cell, x0 + cell - 2, gy0 + di * cell + cell - 2),
                           fill=heat_color(value / peak, 1.0) if value else (23, 32, 50))
    for hi in range(0, 24, 3):
        draw.text((gx1 - hi * cell - cell / 2, gy0 + 7 * cell + 6), f"{hi:02d}", font=mono(9),
                  fill=DIM, anchor="ma")
    draw.text((gx1 - 12 * cell, gy0 + 7 * cell + 22), "hour (UTC)", font=mono(9), fill=DIM, anchor="ma")
    ramp_legend(draw, LEFT_X0 + 36, gy0 + 2, 96, f"{peak}", "رخداد / خانه")

    # ---- Top corridors -------------------------------------------------------------------
    y5 = y3 + 238
    box = (LEFT_X0, y5, LEFT_X1, H - 88)
    panel(draw, box)
    top_y = card_title(draw, box, "پررخدادترین معابر", "sorted by EPDO / km")
    heads = [("EPDO/km", LEFT_X1 - 14), ("count", LEFT_X1 - 116), ("/km", LEFT_X1 - 176)]
    for label, cx in heads:
        draw.text((cx, top_y), label, font=mono(9), fill=CYAN, anchor="ra")
    draw_rtl(draw, (LEFT_X1 - 246, top_y - 1), "معبر", size=10, fill=CYAN, anchor_right=LEFT_X1 - 246)
    draw.line([(LEFT_X0 + 14, top_y + 15), (LEFT_X1 - 14, top_y + 15)], fill=BORDER, width=1)
    row = top_y + 22
    max_density = max(s["density_per_km"] for s in cmv["top_segments"])
    for seg in cmv["top_segments"][:6]:
        highlight = seg["segment_id"] == top["segment_id"]
        if highlight:
            draw.rounded_rectangle((LEFT_X0 + 8, row - 4, LEFT_X1 - 8, row + 20), radius=4,
                                   fill=(8, 47, 73))
        draw.text((LEFT_X1 - 14, row), f"{seg['epdo_per_km']:,.1f}", font=mono(11, True),
                  fill=AMBER, anchor="ra")
        draw.text((LEFT_X1 - 116, row + 1), str(seg["count"]), font=mono(10), fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 176, row + 1), f"{seg['count'] / (seg['length_m'] / 1000):.1f}",
                  font=mono(10), fill=MUTED, anchor="ra")
        name = fit(draw, seg["name"], LEFT_X1 - 246 - (LEFT_X0 + 150), size=11)
        draw_rtl(draw, (LEFT_X1 - 246, row), name, size=11, fill=TEXT if highlight else MUTED,
                 anchor_right=LEFT_X1 - 246)
        hbar(draw, LEFT_X0 + 18, LEFT_X0 + 118, row + 4, seg["density_per_km"] / max_density, PURPLE)
        row += 26

    footer(draw,
           "بازسازی داده‌محور از پنل «تحلیل هماهنگ»؛ اعداد همان پاسخ ثبت‌شدهٔ API است — نه عکس مرورگر",
           f"POST /analytics/cmv · GET /network/layers · synthetic Tehran demo · {meta.get('canonical_crs', 'EPSG:32639')}",
           right_latin="rendered by scripts/render_presentation_figures.py")
    img.save(out, optimize=True)
    print("wrote", out)


def figure_nkde(payload, network, out: Path) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    nkde = payload["nkde"]
    features = network["segments_geojson"]["features"]
    meta = network.get("meta_presentation") or {}
    params, metrics, gt = nkde["parameters"], nkde["summary_metrics"], nkde["ground_truth_eval"]

    y = header(
        draw,
        dataset_name=meta.get("dataset_name", ""),
        crs=meta.get("canonical_crs", "EPSG:32639"),
        synthetics=True,
        active_tab=1,
        subtitle="آزمایشگاه مکانی · تخمین چگالی هستهٔ شبکه‌ای (NKDE) در برابر KDE مسطح",
    )

    map_box = (RIGHT_X0, y, RIGHT_X1, H - 88)
    map_panel(draw, map_box, title_fa="", subtitle_latin=f"POST /lab/nkde · {params['kernel']} kernel")
    inner = (map_box[0] + 14, map_box[1] + 40, map_box[2] - 14, map_box[3] - 64)
    bbox = expand_to_aspect(network_bbox(features), inner)
    canvas = MapCanvas(img, map_box)
    project = project_factory(bbox, inner)
    graticule(canvas.draw, inner, project, bbox)
    lixels = nkde["layer_geojson"]["features"]
    vmax = max(f["properties"]["nkde_density"] for f in lixels)
    draw_network(canvas.draw, features, project, width_scale=0.9,
                 alpha_map={k: (17, 27, 48) for k in ROAD_COLORS})
    for feature in sorted(lixels, key=lambda f: f["properties"]["nkde_density"]):
        for chain in lixel_chains(feature):
            canvas.draw.line([project(lo, la) for lo, la in chain],
                             fill=heat_color(feature["properties"]["nkde_density"], vmax), width=7,
                             joint="curve")
    for feature in payload["cmv"]["incidents_geojson"]["features"]:
        x, yy = project(*feature["geometry"]["coordinates"])
        canvas.draw.ellipse((x - 1.6, yy - 1.6, x + 1.6, yy + 1.6), fill=(226, 232, 240))
    canvas.commit()
    ramp_legend(draw, map_box[2] - 14, map_box[1] + 56, 150, f"{vmax:.0f}", "چگالی NKDE بر کیلومتر×سال")
    scale_bar(draw, map_box, bbox)
    attribution(draw, map_box)
    draw_rtl(draw, (map_box[2] - 14, map_box[3] - 60),
             f"پهنای باند {params['bandwidth_m']:.0f} متر · تخصیص {params['allocation_mode']} ({params['weighting']})",
             size=10, fill=MUTED, anchor_right=map_box[2] - 14)

    # ---- Method comparison ---------------------------------------------------------------
    box = (LEFT_X0, y, LEFT_X1, y + 208)
    panel(draw, box)
    top_y = card_title(draw, box, "ارزیابی در برابر شدت مرجع مصنوعی", "NKDE vs planar KDE")
    heads = [("PAI", LEFT_X1 - 14), ("hit%", LEFT_X1 - 114), ("RRI", LEFT_X1 - 196),
             ("ρ", LEFT_X1 - 268), ("RMSE", LEFT_X1 - 342)]
    for label, cx in heads:
        draw.text((cx, top_y), label, font=mono(9), fill=CYAN, anchor="ra")
    draw_rtl(draw, (LEFT_X1 - 400, top_y - 1), "روش", size=10, fill=CYAN, anchor_right=LEFT_X1 - 400)
    row = top_y + 22
    for key, name_fa, color in [("nkde", "شبکه‌ای (NKDE)", EMERALD), ("planar_kde", "مسطح (KDE)", ROSE)]:
        data = gt[key]
        draw.text((LEFT_X1 - 14, row), f"{data['pai']:.3f}", font=mono(14, True), fill=color, anchor="ra")
        draw.text((LEFT_X1 - 114, row + 2), f"{data['hit_rate_pct']:.1f}", font=mono(11), fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 196, row + 2), f"{data['rri']:.3f}", font=mono(11), fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 268, row + 2), f"{data['spearman_rho']:.3f}", font=mono(11), fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 342, row + 2), f"{data['rmse_per_km_yr']:.2f}", font=mono(11), fill=MUTED, anchor="ra")
        draw_rtl(draw, (LEFT_X1 - 400, row), name_fa, size=12, fill=TEXT, anchor_right=LEFT_X1 - 400)
        row += 30
    draw.line([(LEFT_X0 + 14, row + 2), (LEFT_X1 - 14, row + 2)], fill=BORDER, width=1)
    verdict = f"مزیت PAI: {gt['pai_advantage_pct']:+.2f}٪ · کاهش RMSE: {gt['rmse_reduction_pct']:+.2f}٪"
    draw_rtl(draw, (LEFT_X1 - 14, row + 10), verdict, size=11, fill=AMBER, anchor_right=LEFT_X1 - 14)
    draw_rtl_paragraph(
        draw, LEFT_X1 - 14, row + 30,
        "RMSE مسطح کمی کمتر است — نتیجهٔ منفی کوچکی که هم‌زمان با مزیت PAI گزارش می‌شود. "
        "شدت مرجع خود از همین شبکه و همین دادهٔ مصنوعی ساخته شده است.",
        size=10, fill=MUTED, max_width=LEFT_X1 - LEFT_X0 - 40, line_height=15)

    # ---- Conservation KPIs ---------------------------------------------------------------
    y2 = y + 220
    gap = 10
    card_w = (LEFT_X1 - LEFT_X0 - 2 * gap) / 3
    for index, spec in enumerate([
        dict(label_fa="جرم وزنی ورودی", value=f"{metrics['total_weighted_mass']:,.1f}", color=CYAN,
             note_fa="EPDO-weighted"),
        dict(label_fa="جرم بازتولیدشده", value=f"{metrics['conserved_nkde_mass']:,.1f}", color=EMERALD,
             note_fa="بقای کامل جرم"),
        dict(label_fa="بیشینهٔ بیش‌برآورد مسطح", value=f"{metrics['max_planar_overestimation']:,.1f}",
             unit="/km·yr", color=ROSE, note_fa="per lixel"),
    ]):
        x0 = LEFT_X0 + index * (card_w + gap)
        kpi_card(draw, (x0, y2, x0 + card_w, y2 + 82), **spec)

    # ---- Planar distortion ---------------------------------------------------------------
    y3 = y2 + 94
    box = (LEFT_X0, y3, LEFT_X1, y3 + 224)
    panel(draw, box)
    top_y = card_title(draw, box, "برتری کمی NKDE شبکه‌ای بر KDE مسطح", "km·yr units")
    draw_rtl(draw, (LEFT_X1 - 14, top_y),
             "KDE مسطح جرم را به سطح بیرون از شبکه می‌ریزد؛ این فاصله اندازهٔ همان خطاست.",
             size=10, fill=MUTED, anchor_right=LEFT_X1 - 14)
    lix = {f["properties"]["lixel_id"]: f["properties"]["nkde_density"]
           for f in lixels}
    top_lixels = nkde["top_distortion_lixels"]
    rows = [
        ("بیشینهٔ سرریز یک لیکسل", metrics["max_planar_overestimation"], ROSE),
        ("میانگین |اختلاف|", metrics["mean_abs_planar_distortion"], AMBER),
        (f"چگالی NKDE لیکسل {top_lixels[0]['lixel_id']}", top_lixels[0]["nkde_density"], EMERALD),
        (f"چگالی NKDE لیکسل {top_lixels[1]['lixel_id']}", top_lixels[1]["nkde_density"], EMERALD),
    ]
    vmax2 = max(v for _, v, _ in rows)
    row = top_y + 26
    for label, value, color in rows:
        draw_rtl(draw, (LEFT_X1 - 14, row), label, size=11, fill=MUTED, anchor_right=LEFT_X1 - 14)
        draw.text((LEFT_X1 - 206, row + 1), f"{value:,.1f}", font=mono(11, True), fill=color, anchor="ra")
        hbar(draw, LEFT_X0 + 16, LEFT_X1 - 218, row + 16, value / vmax2, color)
        row += 42

    # ---- Honesty panel -------------------------------------------------------------------
    y4 = y3 + 236
    box = (LEFT_X0, y4, LEFT_X1, H - 88)
    panel(draw, box)
    top_y = card_title(draw, box, "صداقت روش و محدودیت‌ها", "what this figure does not claim")
    alloc = metrics["allocation_comparison"]
    lines = [
        f"لیکسل‌های شبکه {metrics['lixel_count']:,} · نمونهٔ رخداد {metrics['incident_sample_size']:,}",
        f"بیشینهٔ چگالی {metrics['max_nkde_per_km_yr']:,.1f} بر کیلومتر×سال",
        f"رخداد چندنامزدی {alloc['multi_candidate_incidents']} · تغییر جرم L1 {alloc['l1_mass_shift_pct']:.1f}٪",
        "عدم‌قطعیت فقط با استنباط بیز سلسله‌مراتبی (BYM2) گزارش می‌شود، نه از یک اجرای NKDE.",
        "این چگالی الگویی محاسبه‌شده برای دادهٔ مصنوعی است، نه اندازه‌گیری خطر واقعی.",
    ]
    row = top_y + 6
    for line in lines:
        draw.ellipse((LEFT_X1 - 21, row + 6, LEFT_X1 - 15, row + 12), fill=CYAN)
        text = fit(draw, line, LEFT_X1 - LEFT_X0 - 48, size=11)
        draw_rtl(draw, (LEFT_X1 - 27, row), text, size=11, fill=MUTED, anchor_right=LEFT_X1 - 27)
        row += 27

    footer(draw,
           "بازسازی داده‌محور از پنل «آزمایشگاه مکانی»؛ اعداد از پاسخ ثبت‌شدهٔ /lab/nkde",
           f"POST /lab/nkde · runtime {nkde['runtime_ms']:.0f} ms · synthetic Tehran demo · EPSG:{nkde['crs_epsg']}",
           right_latin="rendered by scripts/render_presentation_figures.py")
    img.save(out, optimize=True)
    print("wrote", out)


def lixel_chains(feature) -> list[list[tuple[float, float]]]:
    """Split a MultiLineString lixel into its constituent chains (a lixel may span branches)."""
    geom = feature["geometry"]
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    return geom["coordinates"]


def draw_lixel_partition(draw, box, *, lixel_features, incidents, title_fa, subtitle_latin,
                         value_key: str = "nkde_density"):
    """A zoomed map coloured per lixel: this shows the spatial unit the metric is defined on."""
    panel(draw, box, fill=(6, 12, 28), outline=(30, 41, 59), radius=8)
    draw_rtl(draw, (box[2] - 12, box[1] + 7), title_fa, size=11, fill=CYAN, bold=True,
             anchor_right=box[2] - 12)
    if subtitle_latin:
        draw_ltr(draw, (box[0] + 12, box[1] + 11), subtitle_latin, size=9, fill=DIM)
    canvas = (box[0] + 12, box[1] + 26, box[2] - 12, box[3] - 26)
    points = [pt for f in lixel_features for chain in lixel_chains(f) for pt in chain]
    if not points:
        return
    bbox = bbox_from_points(points, pad=0.0004)
    project = project_factory(bbox, canvas)
    values = [f["properties"].get(value_key, 0.0) for f in lixel_features]
    vmax = max(values) or 1.0
    for feature in sorted(lixel_features, key=lambda f: f["properties"].get(value_key, 0.0)):
        color = heat_color(feature["properties"].get(value_key, 0.0) / vmax, 1.0)
        for chain in lixel_chains(feature):
            draw.line([project(lo, la) for lo, la in chain], fill=color, width=11, joint="curve")
    for incident in incidents:
        x, yy = project(*incident)
        draw.ellipse((x - 3, yy - 3, x + 3, yy + 3), fill=(248, 250, 252), outline=(2, 6, 23))
    draw.text((box[0] + 12, box[3] - 20),
              f"{len(lixel_features):,} lixels · {len(incidents):,} incidents", font=mono(9), fill=DIM)


def figure_maup(payload, network, out: Path) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    result = payload["maup"]["result"]
    resolutions = result["resolutions"]
    nkde = payload["nkde"]
    lixels = nkde["layer_geojson"]["features"]
    incidents = [f["geometry"]["coordinates"] for f in payload["cmv"]["incidents_geojson"]["features"]]
    meta = network.get("meta_presentation") or {}

    y = header(
        draw,
        dataset_name=meta.get("dataset_name", ""),
        crs=meta.get("canonical_crs", "EPSG:32639"),
        synthetics=True,
        active_tab=1,
        subtitle="حساسیت به واحد فضایی (MAUP) · چند بذر × چند تفکیک لیکسل",
    )

    # ---- The spatial unit itself (right): lixels of one corridor, then the whole network ----
    map_box = (RIGHT_X0, y, RIGHT_X1, H - 88)
    map_panel(draw, map_box, title_fa="", subtitle_latin="POST /research/maup-sensitivity")
    # Top: a zoom around the densest lixels, so the partition is actually visible.
    # Bottom: the whole network, with the zoom window marked.
    hotspots = sorted(lixels, key=lambda f: f["properties"].get("nkde_density", 0.0),
                      reverse=True)[:12]
    hot_points = [pt for f in hotspots for chain in lixel_chains(f) for pt in chain]
    zoom = bbox_from_points(hot_points, pad=0.0022)
    mid = (map_box[1] + map_box[3]) / 2
    zoom_box = (map_box[0] + 12, map_box[1] + 40, map_box[2] - 12, mid - 10)
    zoom_lixels = [f for f in lixels
                   if any(zoom["min_lon"] <= lon <= zoom["max_lon"]
                          and zoom["min_lat"] <= lat <= zoom["max_lat"]
                          for chain in lixel_chains(f) for lon, lat in chain)]
    zoom_incidents = [c for c in incidents
                      if zoom["min_lon"] <= c[0] <= zoom["max_lon"]
                      and zoom["min_lat"] <= c[1] <= zoom["max_lat"]]
    draw_lixel_partition(draw, zoom_box, lixel_features=zoom_lixels, incidents=zoom_incidents,
                         title_fa="تفکیک ریز · بزرگ‌نمایی نقاط داغ",
                         subtitle_latin="zoomed partition")
    full_box = (map_box[0] + 12, mid + 24, map_box[2] - 12, map_box[3] - 56)
    draw_lixel_partition(draw, full_box, lixel_features=lixels, incidents=incidents,
                         title_fa="کل شبکه با واحد لیکسل", subtitle_latin="full lixel partition")
    # Mark the zoom window on the full-network panel.
    full_inner = (full_box[0] + 12, full_box[1] + 26, full_box[2] - 12, full_box[3] - 26)
    full_bbox = bbox_from_points([pt for f in lixels for chain in lixel_chains(f) for pt in chain],
                                 pad=0.0004)
    full_project = project_factory(full_bbox, full_inner)
    corners = [full_project(zoom["min_lon"], zoom["max_lat"]), full_project(zoom["max_lon"], zoom["max_lat"]),
               full_project(zoom["max_lon"], zoom["min_lat"]), full_project(zoom["min_lon"], zoom["min_lat"])]
    draw.line(corners + [corners[0]], fill=CYAN, width=2)
    draw.text((corners[0][0] + 4, corners[0][1] + 4), "zoom", font=mono(9), fill=CYAN)
    draw_rtl(draw, (map_box[2] - 14, map_box[3] - 40),
             f"{len(lixels):,} لیکسل · پهنای باند {result['bandwidth_m']:.0f} متر · بذرها {', '.join(str(s) for s in result['seeds'])}",
             size=10, fill=MUTED, anchor_right=map_box[2] - 14)

    # ---- Resolution table ----------------------------------------------------------------
    box = (LEFT_X0, y, LEFT_X1, y + 206)
    panel(draw, box)
    top_y = card_title(draw, box, "پایداری معیارها در تفکیک‌های مختلف", "mean across seeds")
    heads = [("RMSE", LEFT_X1 - 14), ("ρ", LEFT_X1 - 112), ("PAI@10%", LEFT_X1 - 196),
             ("lixels", LEFT_X1 - 324)]
    for label, cx in heads:
        draw.text((cx, top_y), label, font=mono(9), fill=CYAN, anchor="ra")
    draw_rtl(draw, (LEFT_X1 - 400, top_y - 1), "تفکیک شبکه", size=11, fill=CYAN,
             anchor_right=LEFT_X1 - 400)
    row = top_y + 20
    for res in resolutions:
        draw.text((LEFT_X1 - 14, row), f"{res['rmse_per_km_yr']['mean']:.2f}", font=mono(13, True),
                  fill=AMBER, anchor="ra")
        draw.text((LEFT_X1 - 118, row + 2), f"{res['spearman_rho']['mean']:.3f}", font=mono(11),
                  fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 196, row + 2), f"{res['pai_at_10pct']['mean']:.3f}", font=mono(11),
                  fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 324, row + 2), f"{res['lixel_count']:,}", font=mono(11), fill=MUTED,
                  anchor="ra")
        draw_rtl(draw, (LEFT_X1 - 400, row), f"{res['lixel_resolution_m']:.0f} متر", size=12,
                 fill=TEXT, anchor_right=LEFT_X1 - 400)
        row += 32
    draw.line([(LEFT_X0 + 14, row + 2), (LEFT_X1 - 14, row + 2)], fill=BORDER, width=1)
    draw_rtl_paragraph(draw, LEFT_X1 - 14, row + 10, result["zoning_sensitivity_note"], size=10,
                       fill=MUTED, max_width=LEFT_X1 - LEFT_X0 - 40, line_height=15)

    # ---- CI half-widths ------------------------------------------------------------------
    box = (LEFT_X0, y + 218, LEFT_X1, H - 88)
    panel(draw, box)
    top_y = card_title(draw, box, "نیم‌پهنای فاصلهٔ اطمینان ۹۵٪ در چند بذر", "lower is more stable")
    bar_x0 = LEFT_X0 + 150
    bar_span = LEFT_X1 - LEFT_X0 - 380
    row = top_y + 16
    for key, label, color in [("rmse_per_km_yr", "RMSE", AMBER), ("spearman_rho", "Spearman ρ", CYAN),
                              ("au_pai", "AU-PAI", PURPLE), ("mass_calibration_ratio", "mass ratio", EMERALD)]:
        draw_rtl(draw, (LEFT_X1 - 14, row), label, size=11, fill=TEXT, anchor_right=LEFT_X1 - 14)
        row += 20
        values = [res[key]["ci95_halfwidth"] for res in resolutions]
        vmax = max(values) or 1
        for res in resolutions:
            hbar(draw, bar_x0, bar_x0 + bar_span, row, res[key]["ci95_halfwidth"] / vmax, color,
                 height=8)
            draw.text((LEFT_X0 + 20, row), f"{res['lixel_resolution_m']:.0f} m", font=mono(10),
                      fill=MUTED)
            draw.text((bar_x0 + bar_span + 10, row - 2),
                      f"{res[key]['ci95_halfwidth']:.3f}", font=mono(9), fill=MUTED)
            row += 16
        row += 14

    note_y = draw_rtl_paragraph(
        draw, LEFT_X1 - 14, row + 10,
        "ریزکردن شبکه خطای تجمیع را کم می‌کند اما MAUP را حذف نمی‌کند؛ پهنای باند هم اثرگذار است.",
        size=11, fill=AMBER, max_width=LEFT_X1 - LEFT_X0 - 40, line_height=17)
    draw_rtl_paragraph(
        draw, LEFT_X1 - 14, note_y + 6,
        "تفاوت‌ها در حد نیم‌پهنای فاصلهٔ اطمینان‌اند؛ ترتیب معابر می‌تواند بین تفکیک‌ها جابه‌جا شود.",
        size=10, fill=DIM, max_width=LEFT_X1 - LEFT_X0 - 40, line_height=16)

    footer(draw,
           "بازسازی داده‌محور از پنل حساسیت MAUP؛ اعداد از پاسخ ثبت‌شدهٔ /research/maup-sensitivity",
           f"POST /research/maup-sensitivity · {len(resolutions)} resolutions × {len(result['seeds'])} seeds · bandwidth {result['bandwidth_m']:.0f} m",
           right_latin="rendered by scripts/render_presentation_figures.py")
    img.save(out, optimize=True)
    print("wrote", out)


def figure_risk(payload, network, out: Path) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    bym2 = payload["bym2"]["result"]["bym2"]
    mi = payload["bym2"]["result"]["vgi_multiple_imputation"]
    corridors = payload["bym2"]["result"]["top_corridors"]
    features = network["segments_geojson"]["features"]
    meta = network.get("meta_presentation") or {}

    y = header(
        draw,
        dataset_name=meta.get("dataset_name", ""),
        crs=meta.get("canonical_crs", "EPSG:32639"),
        synthetics=True,
        active_tab=2,
        subtitle="ریسک و استنباط بیزی · BYM2 با ESS-MCMC و درون‌یابی چندگانهٔ روبین",
    )

    # ---- Posterior map (right) -----------------------------------------------------------
    map_box = (RIGHT_X0, y, RIGHT_X1, H - 88)
    map_panel(draw, map_box, title_fa="", subtitle_latin="POST /research/bym2")
    inner = (map_box[0] + 14, map_box[1] + 40, map_box[2] - 14, map_box[3] - 64)
    bbox = expand_to_aspect(network_bbox(features), inner)
    canvas = MapCanvas(img, map_box)
    project = project_factory(bbox, inner)
    graticule(canvas.draw, inner, project, bbox)
    # posterior_mean is ordered by segment_id (1..N), not by GeoJSON feature order. Joining on
    # the id keeps a low-risk corridor from being painted with a high-risk neighbour's value.
    by_id = dict(zip([f["properties"]["segment_id"] for f in features], bym2["posterior_mean"]))
    pmax = max(bym2["posterior_mean"]) or 1
    draw_network(canvas.draw, features, project, width_scale=0.9,
                 alpha_map={k: (17, 27, 48) for k in ROAD_COLORS})
    for feature in features:
        value = by_id.get(feature["properties"]["segment_id"])
        if value is None:
            continue
        coords = [project(lo, la) for lo, la in feature["geometry"]["coordinates"]]
        canvas.draw.line(coords, fill=heat_color(value, pmax), width=7, joint="curve")
    canvas.commit()
    ramp_legend(draw, map_box[2] - 14, map_box[1] + 56, 150, f"{pmax:.2f}", "میانگین پسین ریسک نسبی")
    scale_bar(draw, map_box, bbox)
    attribution(draw, map_box)
    draw_rtl(draw, (map_box[2] - 14, map_box[3] - 60),
             f"max split-R̂ {bym2['diagnostics']['max_split_rhat']:.3f} · min bulk ESS {bym2['diagnostics']['min_bulk_ess']:.0f}",
             size=10, fill=MUTED, anchor_right=map_box[2] - 14)

    # ---- MCMC diagnostics ----------------------------------------------------------------
    box = (LEFT_X0, y, LEFT_X1, y + 250)
    panel(draw, box)
    top_y = card_title(draw, box, "همگرایی و پارامترهای BYM2",
                       f"{bym2['chains']} chains × {bym2['draws_per_chain']} draws")
    rows = [
        ("β₀ عرض از مبدأ", f"{bym2['beta_0_mean']:.3f} ± {bym2['beta_0_sd']:.3f}", CYAN),
        ("β₁ لگاریتم AADT", f"{bym2['beta_1_mean']:.3f} ± {bym2['beta_1_sd']:.3f}", CYAN),
        ("σ_total پراکندگی کل", f"{bym2['sigma_total']:.3f}", PURPLE),
        ("ρ آمیختگی فضایی", f"{bym2['rho_spatial_mixing']:.3f}", EMERALD),
        ("max split-R̂", f"{bym2['diagnostics']['max_split_rhat']:.4f}", EMERALD),
        ("min bulk ESS", f"{bym2['diagnostics']['min_bulk_ess']:.0f}", EMERALD),
        ("مؤلفه‌های PRPS · جزیره", f"{bym2['diagnostics']['component_count']} · {bym2['diagnostics']['isolate_count']}", MUTED),
    ]
    row = top_y + 4
    for label, value, color in rows:
        draw_rtl(draw, (LEFT_X1 - 14, row), label, size=11, fill=MUTED, anchor_right=LEFT_X1 - 14)
        draw.text((LEFT_X1 - 230, row + 1), value, font=mono(12, True), fill=color, anchor="ra")
        draw.line([(LEFT_X0 + 14, row + 24), (LEFT_X1 - 14, row + 24)], fill=(24, 33, 50), width=1)
        row += 27

    # ---- Credible intervals --------------------------------------------------------------
    y2 = y + 262
    box = (LEFT_X0, y2, LEFT_X1, y2 + 232)
    panel(draw, box)
    top_y = card_title(draw, box, "فاصلهٔ اطمینان ۹۵٪ پرریسک‌ترین معابر", "posterior mean ●")
    axis_x0, axis_x1 = LEFT_X0 + 30, LEFT_X1 - 280
    hi_max = max(c["bym2_ci95"][1] for c in corridors) if corridors else 1
    row = top_y + 10
    for corridor in corridors[:5]:
        low, high = corridor["bym2_ci95"]
        mean = corridor["bym2_mean"]

        def sx(v, _axis_x0=axis_x0, _axis_x1=axis_x1):
            return _axis_x1 - (_axis_x1 - _axis_x0) * min(1.0, v / hi_max)

        draw.line([(sx(low), row + 9), (sx(high), row + 9)], fill=PURPLE, width=3)
        for edge in (sx(low), sx(high)):
            draw.line([(edge, row + 4), (edge, row + 14)], fill=PURPLE, width=2)
        draw.ellipse((sx(mean) - 4, row + 5, sx(mean) + 4, row + 13), fill=CYAN)
        draw.text((LEFT_X1 - 14, row + 1), f"{mean:.2f}", font=mono(11, True), fill=CYAN, anchor="ra")
        name = fit(draw, corridor["name"], 240, size=11)
        draw_rtl(draw, (LEFT_X1 - 62, row), name, size=11, fill=TEXT, anchor_right=LEFT_X1 - 62)
        row += 30
    draw_rtl(draw, (LEFT_X1 - 14, row + 4),
             "هم‌پوشانی بازه‌ها یعنی رتبه‌بندی این معابر قطعی نیست.", size=10, fill=AMBER,
             anchor_right=LEFT_X1 - 14)

    # ---- Rubin multiple imputation -------------------------------------------------------
    y3 = y2 + 244
    box = (LEFT_X0, y3, LEFT_X1, H - 88)
    panel(draw, box)
    top_y = card_title(draw, box, "درون‌یابی چندگانهٔ روبین برای ابهام نگاشت",
                       f"M = {mi['imputations_m']}")
    draw_rtl(draw, (LEFT_X1 - 14, top_y),
             f"رخداد چندقطعه‌ای {mi['multi_segment_ambiguous_incidents']} از {mi['total_incidents_sampled']}",
             size=11, fill=MUTED, anchor_right=LEFT_X1 - 14)
    stats = [("واریانس درون‌تکرار", mi["mean_within_variance"], CYAN),
             ("واریانس بین‌تکرار", mi["mean_between_variance"], CYAN),
             ("واریانس کل", mi["mean_total_variance"], PURPLE),
             ("میانگین FMI (٪)", mi["mean_fmi"] * 100, AMBER),
             ("بیشینهٔ FMI (٪)", mi["max_fmi"] * 100, ROSE)]
    vmax2 = max(v for _, v, _ in stats)
    row = top_y + 28
    for label, value, color in stats:
        draw_rtl(draw, (LEFT_X1 - 14, row), label, size=11, fill=MUTED, anchor_right=LEFT_X1 - 14)
        draw.text((LEFT_X1 - 200, row + 1), f"{value:,.3f}", font=mono(11, True), fill=color,
                  anchor="ra")
        hbar(draw, LEFT_X0 + 16, LEFT_X1 - 212, row + 16, value / vmax2, color, height=7)
        row += 38
    draw_rtl(draw, (LEFT_X1 - 14, row + 2),
             "FMI پایین یعنی ابهام نگاشت اثر کمی دارد — نه اینکه خطا صفر است.", size=10, fill=DIM,
             anchor_right=LEFT_X1 - 14)

    footer(draw,
           "بازسازی داده‌محور از پنل «ریسک و بیز»؛ اعداد از پاسخ ثبت‌شدهٔ /research/bym2",
           f"POST /research/bym2 · runtime {bym2['diagnostics']['runtime_ms']:.0f} ms · {bym2['total_posterior_draws']} draws · {bym2['inference_method']}",
           right_latin="rendered by scripts/render_presentation_figures.py")
    img.save(out, optimize=True)
    print("wrote", out)


def figure_hawkes(payload, network, out: Path) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    result = payload["hawkes"]["result"]
    sim, dec = result["simulation"], result["declustering"]
    features = network["segments_geojson"]["features"]
    meta = network.get("meta_presentation") or {}

    y = header(
        draw,
        dataset_name=meta.get("dataset_name", ""),
        crs=meta.get("canonical_crs", "EPSG:32639"),
        synthetics=True,
        active_tab=4,
        subtitle="شبیه‌ساز · فرآیند هاکس خودتحریک‌شونده در بالادست جریان + خوشه‌زدایی با الگوریتم EM",
    )

    map_box = (RIGHT_X0, y, RIGHT_X1, H - 88)
    map_panel(draw, map_box, title_fa="", subtitle_latin="POST /research/hawkes")
    inner = (map_box[0] + 14, map_box[1] + 40, map_box[2] - 14, map_box[3] - 64)
    # The simulator samples one reachable corridor, so the panel zooms to the simulated events
    # rather than showing the whole network with 17 points stacked on its edge.
    event_lixels = {f["properties"]["lixel_id"]: f
                    for f in payload["nkde"]["layer_geojson"]["features"]}
    anchor_points: list[Sequence[float]] = []
    for event in sim["events"]:
        feature = event_lixels.get(event["state"][0])
        if feature:
            anchor_points.extend(pt for chain in lixel_chains(feature) for pt in chain)
    bbox = expand_to_aspect(
        bbox_from_points(anchor_points, pad=0.0012) if anchor_points else network_bbox(features),
        inner)
    canvas = MapCanvas(img, map_box)
    project = project_factory(bbox, inner)
    graticule(canvas.draw, inner, project, bbox)
    draw_network(canvas.draw, features, project, width_scale=1.1,
                 alpha_map={k: (30, 45, 72) for k in ROAD_COLORS})

    # The simulation reports each event's state as [lixel_id, segment_id, elevation_level]; the
    # lixel ids belong to /lab/nkde's 25 m layer (the simulation samples that network), so the
    # events are placed on the matching lixel geometry instead of being pushed onto a segment.
    lixels = {f["properties"]["lixel_id"]: f for f in payload["nkde"]["layer_geojson"]["features"]}
    coords_of: dict[Any, tuple[float, float]] = {}
    for event in sim["events"]:
        feature = lixels.get(event["state"][0])
        if not feature:
            continue
        chain = max(lixel_chains(feature), key=len)
        coords_of[event["id"]] = project(*chain[len(chain) // 2])
    for event in sim["events"]:
        xy = coords_of.get(event["id"])
        parent = event.get("parent_id")
        if xy and parent is not None and parent in coords_of:
            canvas.draw.line([coords_of[parent], xy], fill=(180, 60, 80), width=2)
    for event in sim["events"]:
        xy = coords_of.get(event["id"])
        if not xy:
            continue
        color, radius = (ROSE, 6) if event.get("is_secondary_truth") else (CYAN, 4.5)
        canvas.draw.ellipse((xy[0] - radius, xy[1] - radius, xy[0] + radius, xy[1] + radius),
                            fill=color, outline=(2, 6, 23))
    canvas.commit()
    legend(draw, map_box[2] - 14, map_box[1] + 46, [("offspring", ROSE), ("background", CYAN)])
    draw_rtl(draw, (map_box[2] - 14, map_box[1] + 66),
             "فرزند فقط در خلاف جهت جریان ترافیک از والد منتشر می‌شود.", size=10, fill=AMBER,
             anchor_right=map_box[2] - 14)
    scale_bar(draw, map_box, bbox)
    attribution(draw, map_box)
    draw_rtl(draw, (map_box[2] - 14, map_box[3] - 60),
             f"پنجرهٔ {sim['window_hr']:.0f} ساعت · η = {sim['branching_ratio']:.2f} · {sim['temporal_decay_min']:.0f} دقیقه",
             size=10, fill=MUTED, anchor_right=map_box[2] - 14)

    # ---- Timeline ------------------------------------------------------------------------
    box = (LEFT_X0, y, LEFT_X1, y + 214)
    panel(draw, box)
    top_y = card_title(draw, box, "گاه‌نگاری رخدادها و تبار والد–فرزند", f"seed {sim['seed']}")
    tl_x0, tl_x1 = LEFT_X0 + 30, LEFT_X1 - 30
    tl_y = top_y + 86
    draw.line([(tl_x0, tl_y), (tl_x1, tl_y)], fill=BORDER, width=1)
    for hour in range(0, int(sim["window_hr"]) + 1, 2):
        x = tl_x0 + (tl_x1 - tl_x0) * (hour / sim["window_hr"])
        draw.line([(x, tl_y - 4), (x, tl_y + 4)], fill=BORDER, width=1)
        draw.text((x, tl_y + 12), f"{hour}h", font=mono(9), fill=DIM, anchor="ma")
    span = max(1.0, sim["window_hr"] * 3600)
    for event in sim["events"]:
        x = tl_x0 + (tl_x1 - tl_x0) * min(1.0, event["time_s"] / span)
        secondary = bool(event.get("is_secondary_truth"))
        color = ROSE if secondary else CYAN
        yy = tl_y - 26 if secondary else tl_y - 12
        draw.line([(x, tl_y - 2), (x, yy + 3)], fill=color, width=1)
        draw.ellipse((x - 4, yy - 4, x + 4, yy + 4), fill=color)
    draw_rtl(draw, (LEFT_X1 - 14, tl_y + 30),
             f"{sim['secondary_events_truth']} رخداد ثانویه از {sim['total_events']} رخداد (حقیقت مصنوعی)",
             size=11, fill=MUTED, anchor_right=LEFT_X1 - 14)
    draw_rtl(draw, (LEFT_X1 - 14, tl_y + 50),
             "بدون سابقهٔ پیش از پنجره · سانسور راست پس از پایان پنجره", size=10, fill=DIM,
             anchor_right=LEFT_X1 - 14)

    # ---- Declustering KPIs ---------------------------------------------------------------
    y2 = y + 226
    gap = 10
    card_w = (LEFT_X1 - LEFT_X0 - 2 * gap) / 3
    for index, spec in enumerate([
        dict(label_fa="نسبت انشعاب برآوردی", value=f"{dec['estimated_branching_ratio']:.3f}",
             color=EMERALD, note_fa="subcritical < 1"),
        dict(label_fa="نرخ زمینهٔ برآوردی", value=f"{dec['estimated_background_rate_per_hr']:.3f}",
             unit="/hr", color=CYAN, note_fa="background intensity"),
        dict(label_fa="تکرار EM", value=f"{dec['iterations']}", color=PURPLE,
             note_fa=f"logL {dec['log_likelihood']:.1f}"),
    ]):
        x0 = LEFT_X0 + index * (card_w + gap)
        kpi_card(draw, (x0, y2, x0 + card_w, y2 + 82), **spec)

    # ---- Recovery + honesty --------------------------------------------------------------
    y3 = y2 + 94
    box = (LEFT_X0, y3, LEFT_X1, H - 88)
    panel(draw, box)
    top_y = card_title(draw, box, "بازسازی زمینٔ حقیقت مصنوعی و مرزهای ادعا", "synthetic calibration")
    calib = dec.get("synthetic_calibration", {})
    rows = [
        ("نرخ بازیابی والد", f"{calib.get('parent_recovery_rate', 0) * 100:.0f}٪"),
        ("امتیاز Brier (ثانویه)", f"{calib.get('brier_score', 0):.4f}"),
        ("ثانویهٔ انتظاری برآوردشده", f"{calib.get('estimated_expected_secondary', 0):.2f}"),
        ("ثانویهٔ واقعی", f"{calib.get('secondary_truth_count', 0)}"),
        ("پس‌زمینهٔ انتظاری", f"{dec['expected_background_count']:.2f}"),
        ("یکنوایی درست‌نمایی", "بله" if dec.get("monotonic_likelihood") else "خیر"),
    ]
    row = top_y + 4
    for label, value in rows:
        draw_rtl(draw, (LEFT_X1 - 14, row), label, size=11, fill=MUTED, anchor_right=LEFT_X1 - 14)
        draw.text((LEFT_X1 - 230, row + 1), value, font=mono(12, True), fill=CYAN, anchor="ra")
        draw.line([(LEFT_X0 + 14, row + 24), (LEFT_X1 - 14, row + 24)], fill=(24, 33, 50), width=1)
        row += 27
    draw_rtl_paragraph(draw, LEFT_X1 - 14, row + 8,
                       "این یک شبیه‌سازی است: رخدادهای واقعی تهران را بازتولید نمی‌کند و نرخ واقعی نیست.",
                       size=10, fill=AMBER, max_width=LEFT_X1 - LEFT_X0 - 40, line_height=16)

    footer(draw,
           "بازسازی داده‌محور از پنل «شبیه‌ساز»؛ اعداد از پاسخ ثبت‌شدهٔ /research/hawkes",
           f"POST /research/hawkes · {sim['model']} · synthetic Tehran demo · {meta.get('canonical_crs', 'EPSG:32639')}",
           right_latin="rendered by scripts/render_presentation_figures.py")
    img.save(out, optimize=True)
    print("wrote", out)



def figure_vgi(payload, network, out: Path) -> None:
    """VGI stewardship: how far raw citizen reports move when they are snapped to the network."""
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    incidents = payload["cmv"]["incidents_geojson"]["features"]
    mi = payload["bym2"]["result"]["vgi_multiple_imputation"]
    kpis = payload["cmv"]["kpis"]
    features = network["segments_geojson"]["features"]
    meta = network.get("meta_presentation") or {}

    y = header(
        draw,
        dataset_name=meta.get("dataset_name", ""),
        crs=meta.get("canonical_crs", "EPSG:32639"),
        synthetics=True,
        active_tab=5,
        subtitle="تولی‌گری VGI · نگاشت گزارش خام شهروندی بر شبکه و سنجش جابه‌جایی نگاشت",
    )

    # ---- Map: raw report → snapped position (right) --------------------------------------
    map_box = (RIGHT_X0, y, RIGHT_X1, H - 88)
    map_panel(draw, map_box, title_fa="", subtitle_latin="POST /analytics/cmv · raw vs snapped")
    inner = (map_box[0] + 14, map_box[1] + 40, map_box[2] - 14, map_box[3] - 76)
    bbox = expand_to_aspect(network_bbox(features), inner)
    canvas = MapCanvas(img, map_box)
    project = project_factory(bbox, inner)
    graticule(canvas.draw, inner, project, bbox)
    draw_network(canvas.draw, features, project, width_scale=1.1,
                 alpha_map={k: (30, 45, 72) for k in ROAD_COLORS})
    drift_max = max(f["properties"]["orthogonal_snap_dist_m"] for f in incidents) or 1
    for feature in incidents:
        props = feature["properties"]
        sx, sy = project(*feature["geometry"]["coordinates"])
        rx, ry = project(props["raw_lon"], props["raw_lat"])
        color = heat_color(props["orthogonal_snap_dist_m"] / drift_max, 1.0)
        canvas.draw.line([(rx, ry), (sx, sy)], fill=color, width=1)
        canvas.draw.ellipse((rx - 2, ry - 2, rx + 2, ry + 2), outline=color)
        canvas.draw.ellipse((sx - 2.4, sy - 2.4, sx + 2.4, sy + 2.4), fill=color)
    canvas.commit()
    legend(draw, map_box[2] - 14, map_box[1] + 46,
           [("snapped", (248, 250, 252)), ("raw report", (148, 163, 184))])
    scale_bar(draw, map_box, bbox)
    draw_rtl(draw, (map_box[2] - 14, map_box[3] - 60),
             f"{len(incidents)} گزارش · میانگین جابه‌جایی {kpis['mean_snap_drift_m']:.2f} متر · "
             f"بیشینه {drift_max:.1f} متر",
             size=10, fill=MUTED, anchor_right=map_box[2] - 14)
    attribution(draw, map_box)

    # ---- KPI row -------------------------------------------------------------------------
    gap = 10
    card_w = (LEFT_X1 - LEFT_X0 - 2 * gap) / 3
    drift_share = 100 * sum(1 for f in incidents
                            if f["properties"]["orthogonal_snap_dist_m"] > 5) / len(incidents)
    for index, spec in enumerate([
        dict(label_fa="گزارش تأییدشده", value=f"{kpis['filtered_incidents']:,}", color=CYAN,
             note_fa="verified_canonical"),
        dict(label_fa="میانگین اعتبار منبع", value=f"{kpis['mean_credibility']:.2f}", color=EMERALD,
             note_fa="vgi_credibility_score"),
        dict(label_fa="جابه‌جایی بیش از ۵ متر", value=f"{drift_share:.1f}", unit="%", color=AMBER,
             note_fa="orthogonal snap"),
    ]):
        x0 = LEFT_X0 + index * (card_w + gap)
        kpi_card(draw, (x0, y, x0 + card_w, y + 82), **spec)

    # ---- Reporting lag ---------------------------------------------------------------
    # The synthetic generator draws every credibility score from a narrow band (~0.96), so a
    # credibility histogram is a single bar and says nothing. Reporting lag varies and is what a
    # steward actually triages on, so that is what is plotted.
    y2 = y + 94
    box = (LEFT_X0, y2, LEFT_X1, y2 + 196)
    panel(draw, box)
    top_y = card_title(draw, box, "تاخیر گزارش‌دهی شهروندی", "reported_at − occurred_at (min)")
    edges = [0, 5, 10, 15, 20, 30, 45, 60, 1e9]
    labels = ["0–5", "5–10", "10–15", "15–20", "20–30", "30–45", "45–60", ">60"]
    counts = [0] * (len(edges) - 1)
    for feature in incidents:
        lag = feature["properties"]["reporting_lag_min"]
        for index in range(len(edges) - 1):
            if edges[index] <= lag < edges[index + 1]:
                counts[index] += 1
                break
    vmax = max(counts) or 1
    slot = (LEFT_X1 - LEFT_X0 - 50) / len(counts)
    bar_top, bar_bottom = top_y + 16, box[3] - 34
    for index, count in enumerate(counts):
        x0 = LEFT_X0 + 25 + index * slot
        x1 = x0 + slot - 10
        height = (bar_bottom - bar_top) * count / vmax
        color = heat_color(count / vmax, 1.0)
        draw.rounded_rectangle((x0, bar_bottom - height, x1, bar_bottom), radius=3, fill=color)
        draw.text(((x0 + x1) / 2, bar_bottom - height - 15), f"{count}", font=mono(9), fill=MUTED,
                  anchor="ma")
        draw.text(((x0 + x1) / 2, bar_bottom + 5), labels[index], font=mono(9), fill=DIM,
                  anchor="ma")
    # The generator draws every credibility score from a narrow band, so this caveat is stated
    # rather than plotted as a meaningless single-bar histogram.
    draw_ltr(draw, (LEFT_X0 + 16, box[3] - 14),
             f"credibility = {kpis['mean_credibility']:.2f} for all {len(incidents)} reports",
             size=8.5, fill=DIM)

    # ---- Snap displacement histogram -----------------------------------------------------
    y3 = y2 + 208
    box = (LEFT_X0, y3, LEFT_X1, y3 + 200)
    panel(draw, box)
    top_y = card_title(draw, box, "فاصلهٔ نگاشت خام تا موقعیت نهایی", "metres, per report")
    edges = [0, 1, 2, 3, 5, 7, 10, 1e9]
    labels = ["0–1", "1–2", "2–3", "3–5", "5–7", "7–10", ">10"]
    counts = [0] * (len(edges) - 1)
    for feature in incidents:
        drift = feature["properties"]["orthogonal_snap_dist_m"]
        for index in range(len(edges) - 1):
            if edges[index] <= drift < edges[index + 1]:
                counts[index] += 1
                break
    vmax = max(counts) or 1
    row = top_y + 14
    for index, count in enumerate(counts):
        draw.text((LEFT_X1 - 14, row), labels[index], font=mono(10), fill=MUTED, anchor="ra")
        draw.text((LEFT_X1 - 176, row), f"{count}", font=mono(10), fill=CYAN, anchor="ra")
        hbar(draw, LEFT_X0 + 20, LEFT_X1 - 190, row + 2, count / vmax,
             heat_color(count / vmax, 1.0), height=8)
        row += 24

    # ---- Rubin multiple imputation -------------------------------------------------------
    y4 = y3 + 212
    box = (LEFT_X0, y4, LEFT_X1, H - 88)
    panel(draw, box)
    top_y = card_title(draw, box, "ابهام نگاشت و درون‌یابی چندگانهٔ روبین",
                       f"M = {mi['imputations_m']} imputations")
    lines = [
        f"رخداد چندقطعه‌ای {mi['multi_segment_ambiguous_incidents']} از "
        f"{mi['total_incidents_sampled']} · FMI میانگین {mi['mean_fmi']:.3f} · بیشینه {mi['max_fmi']:.3f}",
        f"واریانس درون‌تکرار {mi['mean_within_variance']:.3f} · بین‌تکرار "
        f"{mi['mean_between_variance']:.3f} · کل {mi['mean_total_variance']:.3f}",
        "جابه‌جایی نگاشت کم است اما صفر نیست؛ جرم رخداد بین نامزدها کسری نشده، بلکه نمونه‌گیری گسسته شده است.",
        "این ارقام از دادهٔ مصنوعی تهران می‌آیند و دربارهٔ کیفیت گزارش واقعی شهروندان چیزی نمی‌گویند.",
    ]
    row = top_y + 8
    for index, line in enumerate(lines):
        color = CYAN if index < 2 else (AMBER if index == 3 else MUTED)
        draw.ellipse((LEFT_X1 - 21, row + 6, LEFT_X1 - 15, row + 12), fill=color)
        row = draw_rtl_paragraph(draw, LEFT_X1 - 27, row, line, size=10, fill=color,
                                 max_width=LEFT_X1 - LEFT_X0 - 48, line_height=15) + 6

    footer(draw,
           "بازسازی داده‌محور از پنل «تولی‌گری»؛ اعداد از پاسخ ثبت‌شدهٔ /analytics/cmv و /research/bym2",
           f"POST /analytics/cmv · POST /research/bym2 (rubin MI, M={mi['imputations_m']}) · synthetic Tehran demo",
           right_latin="rendered by scripts/render_presentation_figures.py")
    img.save(out, optimize=True)
    print("wrote", out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payloads", required=True, help="JSON file with recorded API responses")
    parser.add_argument("--network", required=True, help="JSON file with /network/layers + /meta")
    parser.add_argument("--out", required=True, help="Directory for the PNG figures")
    args = parser.parse_args()

    payloads = json.loads(Path(args.payloads).read_text(encoding="utf-8"))
    network_file = json.loads(Path(args.network).read_text(encoding="utf-8"))
    network = {
        **(network_file.get("network") or network_file),
        "meta_presentation": network_file.get("meta_presentation") or network_file.get("presentation") or {},
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    figure_cmv(payloads, network, out / "01_analytics_cmv_fa.png")
    figure_nkde(payloads, network, out / "02_spatial_lab_nkde_fa.png")
    figure_maup(payloads, network, out / "03_spatial_lab_maup_fa.png")
    figure_risk(payloads, network, out / "04_risk_eb_bym2_surrogate_fa.png")
    figure_vgi(payloads, network, out / "05_stewardship_vgi_fa.png")
    figure_hawkes(payloads, network, out / "06_simulator_hawkes_fa.png")
    print("done")


if __name__ == "__main__":
    main()
