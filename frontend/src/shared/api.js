export function getBackendBase() {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE
  }
  const { protocol, hostname } = window.location
  const isLocal = hostname === 'localhost' || 
                  hostname === '127.0.0.1' || 
                  /^192\.168\.\d+\.\d+$/.test(hostname) || 
                  /^10\.\d+\.\d+\.\d+$/.test(hostname) || 
                  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/.test(hostname)

  if (isLocal) {
    return `${protocol}//${hostname}:8000/api`
  }
  return "https://the-lazyy-friend.onrender.com/api"
}

export async function createRoom(name, destinationLat, destinationLng, destinationName) {
  const API_BASE = getBackendBase()
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
  const API_BASE = getBackendBase()
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: memberName }),
  })
  if (!res.ok) throw new Error('Failed to join room')
  return res.json()
}

export async function getRoom(roomId) {
  const API_BASE = getBackendBase()
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}`)
  if (!res.ok) throw new Error('Room not found')
  return res.json()
}

export async function updateMemberLocation(roomId, memberId, lat, lng) {
  const API_BASE = getBackendBase()
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  })
  if (!res.ok) throw new Error('Failed to update location')
  return res.json()
}
