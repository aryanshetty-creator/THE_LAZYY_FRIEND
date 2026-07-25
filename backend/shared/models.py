"""
Shared data models — in-memory for now, PostgreSQL later.
"""
from dataclasses import dataclass, field
from typing import Optional
import time
import uuid


@dataclass
class Member:
    name: str
    member_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    lat: Optional[float] = None
    lng: Optional[float] = None
    last_update: Optional[float] = None
    reached: bool = False
    history: list = field(default_factory=list)  # list of [lat, lng] coordinates


@dataclass
class Room:
    room_id: str
    name: str
    destination_lat: float
    destination_lng: float
    destination_name: str = "Destination"
    created_at: float = field(default_factory=time.time)
    members: dict[str, Member] = field(default_factory=dict)  # member_id -> Member


# ---- In-memory store (swap with DB later) ----
rooms: dict[str, Room] = {}  # room_id -> Room
