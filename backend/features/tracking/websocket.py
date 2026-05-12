"""
WebSocket endpoint for live location tracking.

Protocol (JSON messages):
  Client → Server:
    { "type": "location_update", "lat": 12.34, "lng": 56.78 }

  Server → Client (broadcast to room):
    { "type": "room_state", "members": [...], "destination": {...} }
"""
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from features.rooms.manager import get_room, room_to_dict
from features.tracking.location import check_arrived, haversine_distance, format_distance

router = APIRouter()

# Active WebSocket connections: room_id -> { member_id: WebSocket }
connections: dict[str, dict[str, WebSocket]] = {}


async def broadcast_room_state(room_id: str):
    """Send current room state to every connected member."""
    room = get_room(room_id)
    if not room:
        return

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
            "reached": m.reached,
            "distance_meters": dist,
            "distance_text": dist_text,
        })

    message = json.dumps({
        "type": "room_state",
        "destination": {
            "lat": room.destination_lat,
            "lng": room.destination_lng,
            "name": room.destination_name,
        },
        "members": members_data,
    })

    room_conns = connections.get(room_id, {})
    dead = []
    for mid, ws in room_conns.items():
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(mid)
    for mid in dead:
        room_conns.pop(mid, None)


@router.websocket("/ws/{room_id}/{member_id}")
async def websocket_tracking(websocket: WebSocket, room_id: str, member_id: str):
    room = get_room(room_id)
    if not room or member_id not in room.members:
        await websocket.close(code=4004, reason="Invalid room or member")
        return

    await websocket.accept()

    # Register connection
    if room_id not in connections:
        connections[room_id] = {}
    connections[room_id][member_id] = websocket

    # Send initial state
    await broadcast_room_state(room_id)

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            if data.get("type") == "location_update":
                lat = float(data["lat"])
                lng = float(data["lng"])

                member = room.members.get(member_id)
                if member:
                    member.lat = lat
                    member.lng = lng
                    member.last_update = time.time()
                    member.reached = check_arrived(
                        lat, lng,
                        room.destination_lat, room.destination_lng,
                    )

                await broadcast_room_state(room_id)

    except WebSocketDisconnect:
        connections.get(room_id, {}).pop(member_id, None)
        await broadcast_room_state(room_id)
    except Exception:
        connections.get(room_id, {}).pop(member_id, None)
