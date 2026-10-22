"""Generate the dbt seeds corridors.csv and corridor_points.csv.

Points are hand-picked towns / interchanges along the real highway, roughly 25-35 miles apart.
ETA is cumulative great-circle distance x ROAD_FACTOR at 60 mph (see seeds/README note).

Run: python scripts/gen_corridors.py  (from the pipeline/ directory)
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

ROAD_FACTOR = 1.12  # road distance is longer than the straight line between towns
SPEED_MPH = 60.0

# corridor_id, name, origin, destination, highway, [(label, lat, lng), ...]
CORRIDORS = [
    ("sf_la_i5", "San Francisco → Los Angeles (I-5)", "San Francisco", "Los Angeles", "I-580/I-5", [
        ("San Francisco", 37.77, -122.42), ("Livermore", 37.68, -121.77),
        ("Tracy", 37.74, -121.43), ("Patterson", 37.47, -121.13),
        ("Santa Nella", 37.10, -120.87), ("Mendota", 36.75, -120.38),
        ("Harris Ranch", 36.25, -120.25), ("Kettleman City", 35.99, -119.96),
        ("Buttonwillow", 35.40, -119.49), ("Grapevine", 34.93, -118.95),
        ("Castaic", 34.49, -118.61), ("Los Angeles", 34.05, -118.24),
    ]),
    ("sea_pdx_i5", "Seattle → Portland (I-5)", "Seattle", "Portland", "I-5", [
        ("Seattle", 47.61, -122.33), ("Tacoma", 47.25, -122.44), ("Olympia", 47.04, -122.90),
        ("Centralia", 46.72, -122.95), ("Castle Rock", 46.28, -122.91),
        ("Woodland", 45.90, -122.75), ("Vancouver WA", 45.64, -122.66),
        ("Portland", 45.52, -122.68),
    ]),
    ("den_vail_i70", "Denver → Vail (I-70)", "Denver", "Vail", "I-70", [
        ("Denver", 39.74, -104.99), ("Idaho Springs", 39.74, -105.51),
        ("Eisenhower Tunnel", 39.68, -105.91), ("Copper Mountain", 39.50, -106.15),
        ("Vail", 39.64, -106.37),
    ]),
    ("chi_det_i94", "Chicago → Detroit (I-94)", "Chicago", "Detroit", "I-94", [
        ("Chicago", 41.88, -87.63), ("Gary", 41.59, -87.35), ("Michigan City", 41.71, -86.90),
        ("Benton Harbor", 42.11, -86.45), ("Paw Paw", 42.22, -85.89),
        ("Kalamazoo", 42.29, -85.59), ("Marshall", 42.27, -84.96), ("Jackson", 42.25, -84.40),
        ("Chelsea", 42.32, -84.02), ("Ann Arbor", 42.28, -83.74), ("Detroit", 42.33, -83.05),
    ]),
    ("bos_nyc_i95", "Boston → New York (I-95)", "Boston", "New York", "I-95", [
        ("Boston", 42.36, -71.06), ("Foxborough", 42.07, -71.25), ("Providence", 41.82, -71.41),
        ("Wickford", 41.57, -71.49), ("Westerly", 41.38, -71.83), ("New London", 41.36, -72.10),
        ("Old Saybrook", 41.30, -72.38), ("New Haven", 41.31, -72.92),
        ("Bridgeport", 41.18, -73.19), ("Stamford", 41.05, -73.54),
        ("New Rochelle", 40.91, -73.78), ("New York", 40.71, -74.01),
    ]),
    ("atl_nash_i75", "Atlanta → Nashville (I-75/I-24)", "Atlanta", "Nashville", "I-75/I-24", [
        ("Atlanta", 33.75, -84.39), ("Marietta", 33.95, -84.55), ("Cartersville", 34.17, -84.80),
        ("Calhoun", 34.50, -84.95), ("Dalton", 34.77, -84.97), ("Chattanooga", 35.05, -85.31),
        ("Monteagle", 35.24, -85.84), ("Manchester", 35.48, -86.09),
        ("Murfreesboro", 35.85, -86.39), ("Nashville", 36.16, -86.78),
    ]),
    ("dal_hou_i45", "Dallas → Houston (I-45)", "Dallas", "Houston", "I-45", [
        ("Dallas", 32.78, -96.80), ("Ennis", 32.33, -96.63), ("Corsicana", 32.10, -96.47),
        ("Fairfield", 31.72, -96.16), ("Buffalo", 31.46, -96.06),
        ("Madisonville", 30.95, -95.91), ("Huntsville", 30.72, -95.55),
        ("Conroe", 30.31, -95.46), ("Houston", 29.76, -95.37),
    ]),
    ("phx_flg_i17", "Phoenix → Flagstaff (I-17)", "Phoenix", "Flagstaff", "I-17", [
        ("Phoenix", 33.45, -112.07), ("Anthem", 33.86, -112.13),
        ("Black Canyon City", 34.07, -112.15), ("Cordes Junction", 34.30, -112.17),
        ("Camp Verde", 34.56, -111.85), ("Munds Park", 34.90, -111.63),
        ("Flagstaff", 35.20, -111.65),
    ]),
    ("slc_boi_i84", "Salt Lake City → Boise (I-15/I-84)", "Salt Lake City", "Boise", "I-15/I-84", [
        ("Salt Lake City", 40.76, -111.89), ("Ogden", 41.22, -111.97),
        ("Brigham City", 41.51, -112.02), ("Tremonton", 41.71, -112.17),
        ("Snowville", 41.97, -112.72), ("Raft River", 42.15, -113.05),
        ("Malta", 42.30, -113.37), ("Burley", 42.54, -113.79), ("Twin Falls", 42.56, -114.46),
        ("Bliss", 42.93, -114.95), ("Glenns Ferry", 42.95, -115.30),
        ("Mountain Home", 43.13, -115.69), ("Boise", 43.62, -116.20),
    ]),
    ("mia_orl_turnpike", "Miami → Orlando (Florida's Turnpike)", "Miami", "Orlando",
     "Florida's Turnpike", [
        ("Miami", 25.76, -80.19), ("Pompano Beach", 26.23, -80.12),
        ("Boynton Beach", 26.53, -80.09), ("West Palm Beach", 26.71, -80.05),
        ("Port St. Lucie", 27.30, -80.35), ("Fort Pierce", 27.45, -80.33),
        ("Yeehaw Junction", 27.70, -80.90), ("Kissimmee", 28.29, -81.41),
        ("Orlando", 28.54, -81.38),
    ]),
    ("msp_dul_i35", "Minneapolis → Duluth (I-35)", "Minneapolis", "Duluth", "I-35", [
        ("Minneapolis", 44.98, -93.27), ("Forest Lake", 45.28, -92.99),
        ("North Branch", 45.51, -92.99), ("Hinckley", 46.01, -92.94),
        ("Sandstone", 46.13, -92.87), ("Moose Lake", 46.45, -92.76),
        ("Carlton", 46.66, -92.43), ("Duluth", 46.79, -92.10),
    ]),
    ("reno_sac_i80", "Reno → Sacramento via Truckee (I-80)", "Reno", "Sacramento", "I-80", [
        ("Reno", 39.53, -119.81), ("Verdi", 39.52, -119.99), ("Truckee", 39.33, -120.18),
        ("Donner Summit", 39.31, -120.33), ("Kingvale", 39.31, -120.43),
        ("Colfax", 39.10, -120.95), ("Auburn", 38.90, -121.08), ("Roseville", 38.75, -121.29),
        ("Sacramento", 38.58, -121.49),
    ]),
]


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def build() -> tuple[list[dict], list[dict]]:
    corridors, points = [], []
    for cid, name, origin, dest, highway, pts in CORRIDORS:
        miles = 0.0
        for seq, (label, lat, lng) in enumerate(pts):
            if seq:
                miles += haversine_miles(pts[seq - 1][1], pts[seq - 1][2], lat, lng) * ROAD_FACTOR
            points.append({
                "corridor_id": cid, "seq": seq, "label": label, "lat": lat, "lng": lng,
                "eta_hours": round(miles / SPEED_MPH, 3),
            })
        corridors.append({
            "corridor_id": cid, "name": name, "origin": origin, "destination": dest,
            "highway": highway, "total_miles": round(miles, 1),
        })
    return corridors, points


def write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "dbt" / "seeds"
    out.mkdir(parents=True, exist_ok=True)
    corridors, points = build()
    write(out / "corridors.csv", corridors)
    write(out / "corridor_points.csv", points)
    print(f"{len(corridors)} corridors, {len(points)} points")
