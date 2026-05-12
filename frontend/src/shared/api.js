const API_BASE = `http://${location.hostname}:8000/api`

export async function createRoom(name, destinationLat, destinationLng, destinationName) {
  const res = await fetch(`${API_BASE}/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      destination_lat: destinationLat,
      destination_lng: destinationLng,
      destination_name: destinationName,
    }),
  })
  if (!res.ok) throw new Error('Failed to create room')
  return res.json()
}

export async function joinRoom(roomId, memberName) {
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: memberName }),
  })
  if (!res.ok) throw new Error('Failed to join room')
  return res.json()
}

export async function getRoom(roomId) {
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}`)
  if (!res.ok) throw new Error('Room not found')
  return res.json()
}
