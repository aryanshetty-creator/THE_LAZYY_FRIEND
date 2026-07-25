<template>
  <div class="tracking-view">
    <div class="header">
      <div class="header-left">
        <h2>{{ roomData?.destination?.name || 'Tracking' }}</h2>
        <span class="room-id">Room: {{ roomId }}</span>
      </div>
      <button class="share-btn" @click="copyInvite">{{ copied ? 'Copied!' : 'Share Invite' }}</button>
    </div>
    <p v-if="shareMessage" class="notice">{{ shareMessage }}</p>

    <div class="map-stage">
      <div ref="mapEl" class="map-container"></div>
      <div class="pan-controls" aria-label="Move map">
        <button class="pan-btn pan-up" title="Move map up" @click="panMap(0, -160)">↑</button>
        <button class="pan-btn pan-left" title="Move map left" @click="panMap(-160, 0)">←</button>
        <button class="pan-btn pan-right" title="Move map right" @click="panMap(160, 0)">→</button>
        <button class="pan-btn pan-down" title="Move map down" @click="panMap(0, 160)">↓</button>
      </div>
    </div>

    <div class="members-list">
      <h3>Live Members</h3>
      <div v-for="member in sortedMembers" :key="member.member_id" class="member-row">
        <span
          class="member-dot"
          :style="{ backgroundColor: getMemberColor(member) }"
          :class="{ reached: member.reached, you: member.member_id === memberId }"
        ></span>
        <div class="member-info">
          <span class="member-name">
            {{ member.name }}
            <span v-if="member.member_id === memberId" class="you-badge">(you)</span>
          </span>
          <div class="member-sub">
            <span class="member-tag closest" v-if="member.member_id === closestId">Closest</span>
            <span class="member-tag furthest" v-if="member.member_id === furthestId">Furthest</span>
            <span class="member-distance" v-if="member.distance_text">
              {{ member.reached ? '🎉 Arrived' : member.distance_text + ' remaining' }}
            </span>
            <span class="member-distance" v-else>Waiting for location...</span>
          </div>
        </div>
      </div>
      <p v-if="members.length === 0" class="no-members">No members connected yet</p>
    </div>

    <div v-if="geoError" class="error location-error">
      <span>{{ geoError }}</span>
      <button class="retry-btn" @click="beginLocationWatch">Retry Location</button>
    </div>
    <p v-if="liveError" class="error">{{ liveError }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { connectWebSocket, sendLocation, disconnectWebSocket } from '../../shared/websocket.js'
import { startWatchingLocation, stopWatchingLocation } from '../../shared/geolocation.js'
import { getRoom, updateMemberLocation } from '../../shared/api.js'
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM, DESTINATION_ZOOM } from '../../shared/mapConfig.js'

const props = defineProps({
  roomId: String,
  memberId: String,
  memberName: String,
})

const mapEl = ref(null)
const members = ref([])
const roomData = ref(null)
const geoError = ref('')
const liveError = ref('')
const copied = ref(false)
const shareMessage = ref('')
const wsConnected = ref(false)

let pollInterval = null
const POLL_INTERVAL_MS = 4000

// Palette of distinct, high-visibility colors for members
const MEMBER_COLORS = [
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#84CC16', // Lime
]

const ARRIVAL_RADIUS_METERS = 100

// Sorted: arrived first, then by distance ascending
const sortedMembers = computed(() => {
  return [...members.value].sort((a, b) => {
    if (a.reached && !b.reached) return -1
    if (!a.reached && b.reached) return 1
    const distA = a.distance_meters ?? Infinity
    const distB = b.distance_meters ?? Infinity
    return distA - distB
  })
})

// Closest non-arrived member with a known location
const closestId = computed(() => {
  const active = members.value.filter(m => !m.reached && m.distance_meters != null)
  if (active.length === 0) return null
  return active.reduce((min, m) => m.distance_meters < min.distance_meters ? m : min).member_id
})

// Furthest non-arrived member with a known location
const furthestId = computed(() => {
  const active = members.value.filter(m => !m.reached && m.distance_meters != null)
  if (active.length === 0) return null
  return active.reduce((max, m) => m.distance_meters > max.distance_meters ? m : max).member_id
})

let map = null
let memberMarkers = {}
let memberTrackLines = {} // Polyline for member traveled path history
let memberRouteLines = {} // Dashed Polyline for route to destination
let destMarker = null
let hasCenteredOnDestination = false
let hasCenteredOnUser = false
let hasFittedOnce = false
let lastFitSignature = ''
let lastMyLat = null
let lastMyLng = null

function getMemberColor(member) {
  if (!member) return MEMBER_COLORS[0]
  const index = members.value.findIndex((m) => m.member_id === member.member_id)
  if (index >= 0) {
    return MEMBER_COLORS[index % MEMBER_COLORS.length]
  }
  return MEMBER_COLORS[0]
}

// Create avatar-style circular marker with initials & pulsing ring
function createAvatarIcon(name, color, isReached) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const finalColor = isReached ? '#22C55E' : color

  return L.divIcon({
    className: 'avatar-marker',
    html: `
      <div style="position: relative; width: 44px; height: 58px; display: flex; flex-direction: column; align-items: center;">
        <div style="
          position: absolute;
          top: -3px; left: -3px;
          width: 46px; height: 46px;
          border-radius: 50%;
          border: 2px solid ${finalColor};
          animation: pulse-ring 2s infinite;
          opacity: 0.6;
        "></div>
        <div style="
          width: 40px; height: 40px;
          background: ${finalColor};
          border: 3px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-weight: 700;
          font-size: 14px;
          font-family: 'Segoe UI', sans-serif;
          z-index: 2;
        ">${initials}</div>
        <div style="
          width: 0; height: 0;
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-top: 9px solid #ffffff;
          margin-top: -2px;
          z-index: 1;
        "></div>
      </div>
    `,
    iconSize: [44, 58],
    iconAnchor: [22, 58],
  })
}

function bindMemberTooltip(marker, member) {
  const isYou = member.member_id === props.memberId
  const nameLabel = isYou ? `${member.name} (You)` : member.name
  const distLabel = member.reached ? 'Arrived' : (member.distance_text || 'Locating...')
  const fullLabel = `${nameLabel} • ${distLabel}`

  marker.bindTooltip(fullLabel, {
    permanent: true,
    direction: 'top',
    offset: [0, -52],
    className: 'member-tooltip',
  })
}

function upsertMemberMarker(member, pos) {
  const color = getMemberColor(member)
  const icon = createAvatarIcon(member.name, color, member.reached)

  if (memberMarkers[member.member_id]) {
    memberMarkers[member.member_id].setLatLng(pos).setIcon(icon)
    bindMemberTooltip(memberMarkers[member.member_id], member)
  } else {
    memberMarkers[member.member_id] = L.marker(pos, { icon }).addTo(map)
    bindMemberTooltip(memberMarkers[member.member_id], member)
  }
}

function upsertMemberTrackAndRoute(member, pos, history) {
  if (!map) return

  const color = getMemberColor(member)

  // 1. Solid track line showing traveled movement history
  const historyPoints = (history && history.length > 0) ? history : [pos]
  if (historyPoints.length >= 2) {
    if (memberTrackLines[member.member_id]) {
      memberTrackLines[member.member_id].setLatLngs(historyPoints)
      memberTrackLines[member.member_id].setStyle({ color, opacity: 0.85 })
    } else {
      memberTrackLines[member.member_id] = L.polyline(historyPoints, {
        color,
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map)
    }
  }

  // 2. Dashed line to destination
  if (!member.reached && roomData.value?.destination) {
    const destPos = [roomData.value.destination.lat, roomData.value.destination.lng]
    if (memberRouteLines[member.member_id]) {
      memberRouteLines[member.member_id].setLatLngs([pos, destPos])
      memberRouteLines[member.member_id].setStyle({ color })
    } else {
      memberRouteLines[member.member_id] = L.polyline([pos, destPos], {
        color,
        weight: 3,
        opacity: 0.6,
        dashArray: '8, 8',
      }).addTo(map)
    }
  } else {
    removeMemberRoute(member.member_id)
  }
}

function removeMemberRoute(memberId) {
  if (memberRouteLines[memberId] && map) {
    map.removeLayer(memberRouteLines[memberId])
    delete memberRouteLines[memberId]
  }
}

function removeMemberTrack(memberId) {
  if (memberTrackLines[memberId] && map) {
    map.removeLayer(memberTrackLines[memberId])
    delete memberTrackLines[memberId]
  }
}

function getKnownMapPoints() {
  const points = []
  if (roomData.value?.destination) {
    points.push([roomData.value.destination.lat, roomData.value.destination.lng])
  }
  for (const member of members.value) {
    if (member.lat != null && member.lng != null) {
      points.push([member.lat, member.lng])
    }
  }
  return points
}

function getFitSignature(points) {
  return points
    .map(([lat, lng]) => `${lat.toFixed(3)},${lng.toFixed(3)}`)
    .sort()
    .join('|')
}

function fitAllKnownLocations() {
  if (!map) return
  const points = getKnownMapPoints()
  if (points.length === 0) return

  if (points.length === 1) {
    const [lat, lng] = points[0]
    if (!hasCenteredOnDestination) {
      hasCenteredOnDestination = true
      map.setView([lat, lng], DESTINATION_ZOOM)
    }
    return
  }

  const signature = getFitSignature(points)
  const paddedBounds = map.getBounds().pad(-0.08)
  const hasPointOutsideView = points.some((point) => !paddedBounds.contains(point))

  if (!hasFittedOnce || (hasPointOutsideView && signature !== lastFitSignature)) {
    hasFittedOnce = true
    lastFitSignature = signature
    map.fitBounds(points, { padding: [60, 60], maxZoom: 15 })
  }
}

function distanceToDestination(lat, lng) {
  if (!roomData.value?.destination) return null
  return haversineDistance(
    lat,
    lng,
    roomData.value.destination.lat,
    roomData.value.destination.lng
  )
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const radius = 6371000
  const toRad = (value) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters) {
  if (meters == null) return null
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function updateLocalMemberLocation(lat, lng) {
  const distance = distanceToDestination(lat, lng)
  const reached = distance != null && distance <= ARRIVAL_RADIUS_METERS

  const existing = members.value.find(m => m.member_id === props.memberId)
  const history = existing?.history ? [...existing.history] : []
  const pos = [lat, lng]
  if (history.length === 0 || Math.abs(history[history.length - 1][0] - lat) > 0.000005 || Math.abs(history[history.length - 1][1] - lng) > 0.000005) {
    history.push(pos)
  }

  const currentMember = {
    member_id: props.memberId,
    name: props.memberName || 'You',
    lat,
    lng,
    history,
    reached,
    distance_meters: distance,
    distance_text: formatDistance(distance),
  }

  const existingIndex = members.value.findIndex((m) => m.member_id === props.memberId)
  if (existingIndex >= 0) {
    members.value = members.value.map((m, idx) => (idx === existingIndex ? { ...m, ...currentMember } : m))
  } else {
    members.value = [...members.value, currentMember]
  }

  upsertMemberMarker(currentMember, [lat, lng])
  upsertMemberTrackAndRoute(currentMember, [lat, lng], history)
  fitAllKnownLocations()

  // Always sync location to backend via REST in background
  updateMemberLocation(props.roomId, props.memberId, lat, lng).catch(() => {})
}

// Red pin destination marker
const destIcon = L.divIcon({
  className: 'dest-pin-marker',
  html: `
    <div style="position: relative; width: 34px; height: 46px;">
      <div style="
        width: 34px; height: 34px;
        background: #EA4335;
        border: 3px solid #B71C1C;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 3px 10px rgba(0,0,0,0.35);
      "></div>
      <div style="
        position: absolute;
        top: 10px; left: 12px;
        width: 10px; height: 10px;
        background: #FFFFFF;
        border-radius: 50%;
      "></div>
    </div>
  `,
  iconSize: [34, 46],
  iconAnchor: [17, 46],
})

onMounted(() => {
  map = L.map(mapEl.value, {
    dragging: true,
    scrollWheelZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
    boxZoom: true,
    keyboard: true,
  }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(map)

  loadInitialRoomState()
  connectWebSocket(props.roomId, props.memberId, handleRoomState, handleSocketStatus)
  beginLocationWatch()
  startPollingFallback()
})

onBeforeUnmount(() => {
  stopPollingFallback()
  disconnectWebSocket()
  stopWatchingLocation()
  if (map) {
    map.remove()
    map = null
  }
})

function beginLocationWatch() {
  geoError.value = ''
  stopWatchingLocation()

  startWatchingLocation(
    (lat, lng) => {
      geoError.value = ''
      lastMyLat = lat
      lastMyLng = lng
      updateLocalMemberLocation(lat, lng)

      if (map && !hasCenteredOnUser && !hasFittedOnce) {
        hasCenteredOnUser = true
        map.setView([lat, lng], USER_LOCATION_ZOOM)
      }

      sendLocation(lat, lng)
    },
    (err) => {
      geoError.value = err
    }
  )
}

function handleRoomState(data) {
  if (data.type !== 'room_state') return

  roomData.value = data

  // Merge server members with local "self" data to preserve our latest GPS position
  const serverMembers = (data.members || [])
  const updatedMembers = serverMembers.map(m => {
    // For ourselves, overlay our latest local GPS if server hasn't caught up yet
    if (m.member_id === props.memberId && lastMyLat != null && lastMyLng != null) {
      if (m.lat == null || m.lng == null) {
        m = { ...m, lat: lastMyLat, lng: lastMyLng }
      }
    }

    let dist = m.distance_meters
    let distText = m.distance_text
    if (dist == null && m.lat != null && m.lng != null && data.destination) {
      dist = haversineDistance(m.lat, m.lng, data.destination.lat, data.destination.lng)
      distText = formatDistance(dist)
    }

    // Preserve local history if server doesn't have it yet
    const existingMember = members.value.find(em => em.member_id === m.member_id)
    const history = (m.history && m.history.length > 0) ? m.history : (existingMember?.history || [])

    return {
      ...m,
      history,
      distance_meters: dist,
      distance_text: distText,
    }
  })

  // If we (self) are not in the server list yet but we have local GPS, add ourselves
  const selfInList = updatedMembers.some(m => m.member_id === props.memberId)
  if (!selfInList && lastMyLat != null && lastMyLng != null) {
    const dist = data.destination ? haversineDistance(lastMyLat, lastMyLng, data.destination.lat, data.destination.lng) : null
    updatedMembers.push({
      member_id: props.memberId,
      name: props.memberName || 'You',
      lat: lastMyLat,
      lng: lastMyLng,
      history: [],
      reached: dist != null && dist <= ARRIVAL_RADIUS_METERS,
      distance_meters: dist,
      distance_text: formatDistance(dist),
    })
  }

  members.value = updatedMembers

  // Destination marker
  if (data.destination && !destMarker && map) {
    destMarker = L.marker([data.destination.lat, data.destination.lng], { icon: destIcon })
      .bindTooltip(data.destination.name, { permanent: true, direction: 'top', offset: [0, -48], className: 'dest-tooltip' })
      .addTo(map)
  }

  if (!map) return

  // Update member markers and polylines for all members
  const activeIds = new Set()
  updatedMembers.forEach((m) => {
    activeIds.add(m.member_id)
    if (m.lat == null || m.lng == null) return

    const pos = [m.lat, m.lng]
    upsertMemberMarker(m, pos)
    upsertMemberTrackAndRoute(m, pos, m.history)
  })

  // Cleanup disconnected or removed members
  for (const id of Object.keys(memberMarkers)) {
    if (!activeIds.has(id)) {
      map.removeLayer(memberMarkers[id])
      delete memberMarkers[id]
      removeMemberTrack(id)
      removeMemberRoute(id)
    }
  }

  fitAllKnownLocations()
}

async function loadInitialRoomState() {
  try {
    const room = await getRoom(props.roomId)
    handleRoomState({
      type: 'room_state',
      destination: room.destination,
      members: room.members || [],
    })
  } catch (e) {
    liveError.value = e.message || 'Could not load room'
  }
}

// ---------- REST POLLING FALLBACK ----------
// Polls the backend every POLL_INTERVAL_MS to fetch room state.
// This guarantees friend locations show even when WebSocket is down.
function startPollingFallback() {
  stopPollingFallback()
  pollInterval = setInterval(async () => {
    try {
      if (lastMyLat != null && lastMyLng != null) {
        await updateMemberLocation(props.roomId, props.memberId, lastMyLat, lastMyLng).catch(() => {})
      }
      const room = await getRoom(props.roomId)
      handleRoomState({
        type: 'room_state',
        destination: room.destination,
        members: room.members || [],
      })
      // If WebSocket is still dead but polling is working, clear the error
      if (!wsConnected.value && liveError.value) {
        liveError.value = ''
      }
    } catch (e) {
      // Polling error is silent — we don't overwrite existing error messages
      console.warn('[Poll] Failed to fetch room state:', e)
    }
  }, POLL_INTERVAL_MS)
}

function stopPollingFallback() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

function handleSocketStatus(status) {
  if (status.type === 'open') {
    wsConnected.value = true
    liveError.value = ''
    return
  }

  if (status.type === 'close') {
    wsConnected.value = false
    if (status.code === 4004) {
      liveError.value = 'Room link is invalid or expired'
    }
    // Don't show error for normal close — polling fallback handles it
    return
  }

  if (status.type === 'error') {
    wsConnected.value = false
    // Don't show scary error — polling will keep things working
    liveError.value = ''
  }
}

function copyInvite() {
  const url = `${location.origin}${location.pathname}?room=${props.roomId}`
  navigator.clipboard.writeText(url).then(() => {
    copied.value = true
    if (isLocalOnlyHost()) {
      shareMessage.value = `Room Code: ${props.roomId} | Share link: ${url} (Note: Use your local IP e.g. http://192.168.x.x:5173 to share with friends on mobile)`
    } else {
      shareMessage.value = 'Invite link copied to clipboard!'
    }
    setTimeout(() => {
      copied.value = false
      shareMessage.value = ''
    }, 4000)
  })
}

function isLocalOnlyHost() {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname)
}

function panMap(x, y) {
  if (!map) return
  map.panBy([x, y], { animate: true, duration: 0.25 })
}
</script>

<style scoped>
.tracking-view {
  font-family: 'Segoe UI', -apple-system, sans-serif;
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  z-index: 1000;
}
.header-left h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: #1f2937;
}
.room-id {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}
.share-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 20px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(79,70,229,0.3);
  transition: transform 0.15s, box-shadow 0.15s;
}
.share-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(79,70,229,0.4);
}
.map-stage {
  flex: 1;
  min-height: 300px;
  position: relative;
}
.map-container {
  height: 100%;
  width: 100%;
  cursor: grab;
}
.map-container:active {
  cursor: grabbing;
}
.pan-controls {
  display: grid;
  grid-template-columns: repeat(3, 36px);
  grid-template-rows: repeat(3, 36px);
  gap: 6px;
  left: 14px;
  position: absolute;
  top: 14px;
  z-index: 700;
}
.pan-btn {
  align-items: center;
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  color: #111827;
  cursor: pointer;
  display: flex;
  font-size: 18px;
  font-weight: 800;
  height: 36px;
  justify-content: center;
  width: 36px;
}
.pan-btn:hover {
  background: #f3f4f6;
}
.pan-up { grid-column: 2; grid-row: 1; }
.pan-left { grid-column: 1; grid-row: 2; }
.pan-right { grid-column: 3; grid-row: 2; }
.pan-down { grid-column: 2; grid-row: 3; }

.members-list {
  background: #ffffff;
  padding: 14px 18px;
  max-height: 220px;
  overflow-y: auto;
  box-shadow: 0 -4px 16px rgba(0,0,0,0.08);
}
.members-list h3 {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 700;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}
.member-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  border: 2px solid #ffffff;
}
.member-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}
.member-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}
.you-badge {
  color: #4f46e5;
  font-size: 12px;
  font-weight: 700;
}
.member-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.member-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.member-tag.closest {
  background: #dcfce7;
  color: #166534;
}
.member-tag.furthest {
  background: #fee2e2;
  color: #991b1b;
}
.member-distance {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}
.no-members {
  color: #9ca3af;
  font-size: 13px;
}
.error {
  color: #ef4444;
  text-align: center;
  padding: 8px;
  margin: 0;
  font-size: 13px;
  background: #fef2f2;
}
.location-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.retry-btn {
  border: none;
  border-radius: 999px;
  background: #ef4444;
  color: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
}
.retry-btn:hover {
  background: #dc2626;
}
.notice {
  background: #eff6ff;
  color: #1e40af;
  font-size: 13px;
  padding: 10px 16px;
  text-align: center;
  margin: 0;
  border-bottom: 1px solid #dbeafe;
}
</style>

<style>
/* Global Leaflet overrides */
.avatar-marker, .dest-pin-marker {
  background: none !important;
  border: none !important;
}
@keyframes pulse-ring {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 0.2; }
  100% { transform: scale(0.95); opacity: 0.8; }
}
.dest-tooltip {
  background: #ffffff;
  color: #1f2937;
  border: none;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  font-weight: 700;
  font-size: 13px;
  padding: 6px 10px;
}
.dest-tooltip::before {
  border-top-color: #ffffff !important;
}
.member-tooltip {
  background: #111827;
  color: #ffffff;
  border: none;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  font-weight: 600;
  font-size: 12px;
  padding: 5px 10px;
  white-space: nowrap;
}
.member-tooltip::before {
  border-top-color: #111827 !important;
}
</style>
