/**
 * Thin wrapper around the native WebSocket API.
 * Handles connect, reconnect, and JSON message parsing.
 */

let socket = null
let messageHandler = null
let pendingLocation = null
let statusHandler = null
let reconnectTimer = null
let currentRoomId = null
let currentMemberId = null
let isExplicitDisconnect = false

export function getWsBase() {
  if (import.meta.env.VITE_WS_BASE) {
    return import.meta.env.VITE_WS_BASE
  }
  const { protocol, hostname } = window.location
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
  const isLocal = hostname === 'localhost' || 
                  hostname === '127.0.0.1' || 
                  /^192\.168\.\d+\.\d+$/.test(hostname) || 
                  /^10\.\d+\.\d+\.\d+$/.test(hostname) || 
                  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/.test(hostname)

  if (isLocal) {
    return `${wsProtocol}//${hostname}:8000/ws`
  }
  return "wss://the-lazyy-friend.onrender.com/ws"
}

export function connectWebSocket(roomId, memberId, onMessage, onStatus) {
  currentRoomId = roomId
  currentMemberId = memberId
  messageHandler = onMessage
  statusHandler = onStatus
  isExplicitDisconnect = false

  const wsBase = getWsBase()
  const url = `${wsBase}/${roomId}/${memberId}`

  if (socket) {
    try { socket.close() } catch (e) {}
  }

  socket = new WebSocket(url)

  socket.onopen = () => {
    console.log('[WS] Connected to room', roomId)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
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

    if (!isExplicitDisconnect && event.code !== 4004 && currentRoomId && currentMemberId) {
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          console.log('[WS] Reconnecting...')
          connectWebSocket(currentRoomId, currentMemberId, messageHandler, statusHandler)
        }, 3000)
      }
    }
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
  isExplicitDisconnect = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    socket.close()
    socket = null
  }
  statusHandler = null
  messageHandler = null
  pendingLocation = null
  currentRoomId = null
  currentMemberId = null
}
