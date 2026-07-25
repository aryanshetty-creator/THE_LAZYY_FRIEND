"""
Room REST endpoints — create and join rooms.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from features.rooms.manager import create_room, get_room, add_member, room_to_dict

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


class CreateRoomRequest(BaseModel):
    name: str
    destination_lat: float
    destination_lng: float
    destination_name: str = "Destination"


class JoinRoomRequest(BaseModel):
    name: str


@router.post("/create")
def api_create_room(body: CreateRoomRequest):
    room = create_room(
        name=body.name,
        dest_lat=body.destination_lat,
        dest_lng=body.destination_lng,
        dest_name=body.destination_name,
    )
    return {"room_id": room.room_id, "room": room_to_dict(room)}


@router.post("/{room_id}/join")
def api_join_room(room_id: str, body: JoinRoomRequest):
    room = get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    member = add_member(room_id, body.name)
    return {"member_id": member.member_id, "room": room_to_dict(room)}


import time
import asyncio
from features.tracking.location import check_arrived


class LocationUpdateRequest(BaseModel):
    lat: float
    lng: float


@router.post("/{room_id}/members/{member_id}/location")
def api_update_location(room_id: str, member_id: str, body: LocationUpdateRequest):
    room = get_room(room_id)
    if not room or member_id not in room.members:
        raise HTTPException(status_code=404, detail="Room or member not found")

    member = room.members[member_id]
    member.lat = body.lat
    member.lng = body.lng
    member.last_update = time.time()

    pos = [body.lat, body.lng]
    if not member.history:
        member.history.append(pos)
    else:
        last = member.history[-1]
        if abs(last[0] - body.lat) > 0.000005 or abs(last[1] - body.lng) > 0.000005:
            member.history.append(pos)
            if len(member.history) > 1000:
                member.history.pop(0)

    member.reached = check_arrived(
        body.lat, body.lng,
        room.destination_lat, room.destination_lng,
    )

    from features.tracking.websocket import broadcast_room_state
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(broadcast_room_state(room_id))
    except Exception:
        pass

    return room_to_dict(room)


@router.get("/{room_id}")
def api_get_room(room_id: str):
    room = get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room_to_dict(room)
