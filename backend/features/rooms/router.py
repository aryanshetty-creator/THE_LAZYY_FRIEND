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


@router.get("/{room_id}")
def api_get_room(room_id: str):
    room = get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room_to_dict(room)
