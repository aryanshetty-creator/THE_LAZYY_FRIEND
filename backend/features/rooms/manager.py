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


from features.tracking.location import haversine_distance, format_distance


def room_to_dict(room: Room) -> dict:
    members_data = []
    for m in room.members.values():
        dist = None
        dist_text = None
        if m.lat is not None and m.lng is not None:
            dist = haversine_distance(m.lat, m.lng, room.destination_lat, room.destination_lng)
            dist_text = format_distance(dist)
        members_data.append({
            "member_id": m.member_id,
            "name": m.name,
            "lat": m.lat,
            "lng": m.lng,
            "history": m.history,
            "reached": m.reached,
            "distance_meters": dist,
            "distance_text": dist_text,
        })

    return {
        "room_id": room.room_id,
        "name": room.name,
        "destination": {
            "lat": room.destination_lat,
            "lng": room.destination_lng,
            "name": room.destination_name,
        },
        "members": members_data,
    }

