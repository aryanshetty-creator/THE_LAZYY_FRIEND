"""
Location helpers — distance calculation, arrival detection.
"""
import math

# Radius of Earth in km
EARTH_RADIUS_KM = 6371.0

# If member is within this many meters of destination → "reached"
ARRIVAL_THRESHOLD_METERS = 100


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Returns straight-line distance between two points in meters."""
    lat1, lng1, lat2, lng2 = map(math.radians, [lat1, lng1, lat2, lng2])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_KM * c * 1000  # convert to meters


def check_arrived(lat: float, lng: float, dest_lat: float, dest_lng: float) -> bool:
    return haversine_distance(lat, lng, dest_lat, dest_lng) <= ARRIVAL_THRESHOLD_METERS


def format_distance(meters: float) -> str:
    if meters < 1000:
        return f"{int(meters)} m"
    return f"{meters / 1000:.1f} km"
