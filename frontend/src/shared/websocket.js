/**
 * Thin wrapper around the native WebSocket API.
 * Handles connect, reconnect, and JSON message parsing.
 */

let socket = null
let messageHandler = null
let pendingLocation = null
let statusHandler = null

export function connectWebSocket(roomId, memberId, onMessage, onStatus) {
  const url = `wss://the-lazyy-friend.onrender.com/ws/${roomId}/${memberId}`

  socket = new WebSocket(url)
  messageHandler = onMessage
  statusHandler = onStatus

  socket.onopen = () => {
    console.log('[WS] Connected to room', roomId)
    if (statusHandler) statusHandler({ type: 'open' })
    if (pendingLocation) {
      socket.send(JSON.stringify({
        type: 'location_update',
        lat: pendingLocation.lat,
        lng: pendingLocation.lng,
      }))
      pendingLocation = null
    }
  }

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (messageHandler) messageHandler(data)
    } catch (e) {
      console.error('[WS] Bad message', e)
    }
  }

  socket.onclose = (event) => {
    console.log('[WS] Disconnected', event.code, event.reason)
    if (statusHandler) statusHandler({ type: 'close', code: event.code, reason: event.reason })
  }

  socket.onerror = (err) => {
    console.error('[WS] Error', err)
    if (statusHandler) statusHandler({ type: 'error' })
  }
}

export function sendLocation(lat, lng) {
  pendingLocation = { lat, lng }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'location_update',
      lat,
      lng,
    }))
    pendingLocation = null
  }
}

export function disconnectWebSocket() {
  if (socket) {
    socket.close()
    socket = null
  }
  statusHandler = null
  messageHandler = null
  pendingLocation = null
}
