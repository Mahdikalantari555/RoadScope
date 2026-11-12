#!/usr/bin/env python3
"""End-to-end smoke test for a running instance (default http://127.0.0.1:3000).

Exercises every analytical job type, authentication, citizen reporting with validation,
tracking, administrative review and editing, dataset listing, and error envelopes.

    python3 scripts/smoke-api.py [base_url] [admin_email] [admin_password]
"""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000").rstrip("/") + "/api"
ADMIN_EMAIL = sys.argv[2] if len(sys.argv) > 2 else "admin@uai.local"
ADMIN_PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "ChangeMe-Admin-2026"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
failures = []


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"content-type": "application/json"} if body is not None else {}
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with opener.open(req, timeout=180) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, text


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {label} {detail}")
    if not condition:
        failures.append(label)


JOBS = [
    ("kde", {"bandwidthM": 300, "cellSizeM": 100, "kernel": "quartic"}),
    ("gistar", {"neighborhoodM": 250, "cellSizeM": 100, "alpha": "0.05"}),
    ("dbscan", {"epsM": 120, "minPts": 8}),
    ("segment_aggregation", {"moranPermutations": "99"}),
    ("spatial_comparison", {"wetThresholdMm": 0.2}),
    ("risk", {"wCount": 0.15, "wDensity": 0.2, "wSeverity": 0.25, "wExposure": 0.2, "wDarkness": 0.1, "wSpeed": 0.1, "normalization": "percentile"}),
]

last_job = None
for analysis, params in JOBS:
    started = time.time()
    status, job = call("POST", "/analysis/jobs", {"type": analysis, "params": params, "filters": {"statuses": ["verified"]}})
    check(f"{analysis}: job accepted", status in (200, 202), f"http={status}")
    while job and job.get("status") in ("queued", "running"):
        time.sleep(0.4)
        status, job = call("GET", f"/analysis/jobs/{job['id']}")
    result = (job or {}).get("result") or {}
    features = len((result.get("featureCollection") or {}).get("features", []))
    check(f"{analysis}: completed", (job or {}).get("status") == "completed", f"{time.time() - started:.1f}s features={features}")
    if (job or {}).get("status") == "failed":
        print("      error:", job.get("errorMessage"))
    last_job = job
    if analysis == "gistar" and result:
        print("      Gi* assumptions:", [(a["id"], a["passed"]) for a in result.get("methodology", {}).get("assumptions", [])])

# Caching: an identical request must be served from cache.
status, cached = call("POST", "/analysis/jobs", {"type": "dbscan", "params": {"epsM": 120, "minPts": 8}, "filters": {"statuses": ["verified"]}})
check("identical analysis served from cache", status == 200 and cached.get("cached") is True, f"http={status}")

if last_job:
    s, _ = call("GET", f"/analysis/jobs/{last_job['id']}")
    check("job reload", s == 200)

status, me = call("GET", "/auth/me")
check("anonymous session", status == 200 and me.get("user") is None)
status, bad = call("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": "wrong-password"})
check("wrong password rejected", status == 401, f"http={status}")
status, login = call("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
check("admin login", status == 200 and login.get("user", {}).get("role") == "admin", f"http={status}")
status, quality = call("GET", "/quality")
check("admin quality indicators", status == 200 and "flags" in quality, f"http={status}")

payload = {
    "lon": 13.4,
    "lat": 52.5,
    "occurredLocal": "2024-06-01T08:00",
    "categoryCode": "cyclist",
    "severityId": 2,
    "vehiclesInvolved": 1,
    "emergencyServices": False,
    "description": "Cyclist was clipped by a van turning left at the junction.",
    "privacyConsent": True,
}
status, report = call("POST", "/accidents", payload)
check("citizen report accepted", status == 201 and report.get("trackingCode", "").startswith("UAI-"), f"http={status}")
status, err = call("POST", "/accidents", {**payload, "lon": 14.9})
check("out-of-area report rejected", status == 422, f"http={status}")
status, err = call("POST", "/accidents", {**payload, "description": "short"})
check("short description rejected", status == 422, f"http={status}")
status, err = call("POST", "/accidents", {**payload, "privacyConsent": False})
check("missing consent rejected", status == 422, f"http={status}")

if status == 201:
    pass
status, report = call("POST", "/accidents", payload)
if status == 201:
    code = report["trackingCode"]
    status, track = call("GET", f"/accidents/track?code={code}")
    check("tracking lookup", status == 200 and track.get("status") == "reported", f"status={track.get('status') if track else None}")
    rid = report["id"]
    status, verified = call("POST", f"/accidents/{rid}/review", {"action": "verify", "note": "Confirmed by smoke test"})
    check("administrator verifies", status == 200 and verified.get("status") == "verified", f"http={status}")
    status, conflict = call("POST", f"/accidents/{rid}/review", {"action": "verify"})
    check("invalid transition returns 409", status == 409, f"http={status}")
    status, detail = call("GET", f"/accidents/{rid}")
    check("review history recorded", status == 200 and len(detail.get("verifications") or []) >= 1)
    status, patched = call("PATCH", f"/accidents/{rid}", {"severityId": 3, "note": "severity corrected"})
    check("administrator edit", status == 200 and patched.get("severityId") == 3, f"http={status}")

status, dup = call("POST", "/accidents/check-duplicates", {"lon": 13.405, "lat": 52.52, "occurredLocal": "2024-06-01T08:05", "categoryCode": "rear_end"})
check("duplicate probe responds", status == 200 and "candidates" in dup, f"http={status}")
status, datasets = call("GET", "/datasets")
check("datasets listed", status == 200 and len(datasets.get("items", [])) >= 2, f"count={len(datasets.get('items', [])) if datasets else 0}")
status, audit = call("GET", "/audit?limit=5")
check("audit trail readable by admin", status == 200 and len(audit.get("items", [])) > 0)
status, segment = call("GET", "/segments/5")
check("segment detail", status == 200 and "stats" in segment, f"http={status}")
status, bbox = call("GET", "/dashboard?bbox=13.39,52.50,13.43,52.54")
check("map-extent summary", status == 200 and "scope" in bbox, f"http={status}")
status, bad = call("GET", "/accidents?hours=9-7")
check("invalid filter returns 422", status == 422 and bad["error"]["code"] == "invalid_filter", f"http={status}")
status, missing = call("GET", "/nope")
check("unknown endpoint returns 404 envelope", status == 404 and missing["error"]["code"] == "not_found")
status, openapi = call("GET", "/openapi.json")
check("OpenAPI document served", status == 200 and openapi.get("openapi", "").startswith("3."))

print()
print("FAILURES:" if failures else "ALL CHECKS PASSED", ", ".join(failures) if failures else "")
sys.exit(1 if failures else 0)
