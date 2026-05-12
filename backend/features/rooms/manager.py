"""
Room manager — create rooms, add/remove members, lookup.
"""
import uuid
from shared.models import rooms, Room, Member


def create_room(name: str, dest_lat: float, dest_lng: float, dest_name: str = "Destination") -> Room:
    room_id = str(uuid.uuid4())[:8]
    room = Room(
        room_id=room_id,
        name=name,
        destination_lat=dest_lat,
        destination_lng=dest_lng,
        destination_name=dest_name,
    )
    rooms[room_id] = room
    return room


def get_room(room_id: str) -> Room | None:
    return rooms.get(room_id)


def add_member(room_id: str, name: str) -> Member | None:
    room = get_room(room_id)
    if not room:
        return None
    member = Member(name=name)
    room.members[member.member_id] = member
    return member


def remove_member(room_id: str, member_id: str) -> bool:
    room = get_room(room_id)
    if room and member_id in room.members:
        del room.members[member_id]
        return True
    return False


def room_to_dict(room: Room) -> dict:
    return {
        "room_id": room.room_id,
        "name": room.name,
        "destination": {
            "lat": room.destination_lat,
            "lng": room.destination_lng,
            "name": room.destination_name,
        },
        "members": [
            {
                "member_id": m.member_id,
                "name": m.name,
                "lat": m.lat,
                "lng": m.lng,
                "reached": m.reached,
            }
            for m in room.members.values()
        ],
    }
