/**
 * Thin wrapper around the native WebSocket API.
 * Handles connect, reconnect, and JSON message parsing.
 */

let socket = null
let messageHandler = null

export function connectWebSocket(roomId, memberId, onMessage) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const host = location.hostname
  const port = import.meta.env.VITE_WEBSOCKET_PORT || location.port || (location.protocol === 'https:' ? 443 : 80)
  const url = `${protocol}://${host}:${port}/ws/${roomId}/${memberId}`

  socket = new WebSocket(url)
  messageHandler = onMessage

  socket.onopen = () => {
    console.log('[WS] Connected to room', roomId)
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
  }

  socket.onerror = (err) => {
    console.error('[WS] Error', err)
  }
}

export function sendLocation(lat, lng) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'location_update',
      lat,
      lng,
    }))
  }
}

export function disconnectWebSocket() {
  if (socket) {
    socket.close()
    socket = null
  }
}
