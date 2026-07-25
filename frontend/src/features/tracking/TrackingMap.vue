<template>
  <div class="tracking-view">
    <!-- Top Header -->
    <div class="header">
      <div class="header-left">
        <div class="header-title-wrap">
          <span class="dest-icon">📍</span>
          <div>
            <h2>{{ roomData?.destination?.name || 'Live Tracking' }}</h2>
            <span class="room-id">Room Code: <strong>{{ roomId }}</strong></span>
          </div>
        </div>
      </div>
      <button class="share-btn" @click="copyInvite">
        <span class="btn-icon">🔗</span>
        {{ copied ? 'Copied Link!' : 'Share Invite' }}
      </button>
    </div>
    
    <div v-if="shareMessage" class="notice-banner">
      <span>✨ {{ shareMessage }}</span>
    </div>

    <!-- Map Container Stage -->
    <div class="map-stage">
      <div ref="mapEl" class="map-container"></div>
      
      <!-- Pan Controls -->
      <div class="pan-controls" aria-label="Move map">
        <button class="pan-btn pan-up" title="Move map up" @click="panMap(0, -160)">↑</button>
        <button class="pan-btn pan-left" title="Move map left" @click="panMap(-160, 0)">←</button>
        <button class="pan-btn pan-right" title="Move map right" @click="panMap(160, 0)">→</button>
        <button class="pan-btn pan-down" title="Move map down" @click="panMap(0, 160)">↓</button>
      </div>

      <!-- Floating Live Status Overlay -->
      <div class="live-status-pill">
        <span class="pulse-dot"></span>
        <span>{{ members.length }} Member{{ members.length === 1 ? '' : 's' }} Live</span>
      </div>
    </div>

    <!-- Members Leaderboard Panel -->
    <div class="members-card">
      <div class="members-header">
        <div class="header-title">
          <h3>🏆 Distance Leaderboard</h3>
          <span class="member-count-badge">{{ rankedMembers.length }} Connected</span>
        </div>
      </div>

      <div class="members-grid">
        <div 
          v-for="member in rankedMembers" 
          :key="member.member_id" 
          class="member-card"
          :class="{ 'is-you': member.member_id === memberId, 'is-arrived': member.reached }"
        >
          <!-- Left Avatar & Rank Badge -->
          <div class="avatar-wrap">
            <div 
              class="avatar-circle" 
              :style="{ backgroundColor: getMemberColor(member) }"
            >
              {{ getInitials(member.name) }}
            </div>
            <span class="rank-badge" :class="getRankClass(member.rank)">
              {{ member.rankSymbol }}
            </span>
          </div>

          <!-- Middle Member Details -->
          <div class="member-details">
            <div class="name-row">
              <span class="member-name">{{ member.name }}</span>
              <span v-if="member.member_id === memberId" class="you-tag">YOU</span>
            </div>

            <div class="status-row">
              <span v-if="member.reached" class="tag arrived-tag">🎉 Arrived</span>
              <span v-else-if="member.rank === 1 && member.distance_meters != null" class="tag leader-tag">👑 #1 Closest</span>
              <span v-else-if="member.distance_meters != null" class="tag rank-tag">Rank #{{ member.rank }}</span>

              <span class="distance-text" v-if="member.distance_text">
                {{ member.reached ? 'Reached Destination' : member.distance_text + ' remaining' }}
              </span>
              <span class="distance-text waiting" v-else>Locating GPS...</span>
            </div>
          </div>

          <!-- Right Color Line Indicator -->
          <div 
            class="color-indicator-bar"
            :style="{ backgroundColor: getMemberColor(member) }"
            :title="'Track color for ' + member.name"
          ></div>
        </div>

        <p v-if="rankedMembers.length === 0" class="no-members">No members in room yet. Click Share Invite to invite friends!</p>
      </div>
    </div>

    <!-- Banners -->
    <div v-if="geoError" class="error-banner location-error">
      <span>⚠️ {{ geoError }}</span>
      <button class="retry-btn" @click="beginLocationWatch">Retry GPS</button>
    </div>
    <p v-if="liveError" class="error-banner">{{ liveError }}</p>
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

// High-contrast, distinct colors for members
const DISTINCT_COLORS = [
  '#4F46E5', // Indigo Blue (Reserved for You / Host)
  '#EC4899', // Hot Pink
  '#10B981', // Emerald Green
  '#F59E0B', // Amber Gold
  '#8B5CF6', // Vivid Purple
  '#06B6D4', // Cyan
  '#EF4444', // Coral Red
  '#84CC16', // Lime
]

const ARRIVAL_RADIUS_METERS = 100

// Ranked & sorted members by closeness to destination
const rankedMembers = computed(() => {
  const sorted = [...members.value].sort((a, b) => {
    if (a.reached && !b.reached) return -1
    if (!a.reached && b.reached) return 1
    const distA = a.distance_meters ?? Infinity
    const distB = b.distance_meters ?? Infinity
    return distA - distB
  })

  let rankCounter = 1
  return sorted.map((member) => {
    const rank = rankCounter++
    let rankSymbol = `#${rank}`
    if (rank === 1) rankSymbol = '1st'
    else if (rank === 2) rankSymbol = '2nd'
    else if (rank === 3) rankSymbol = '3rd'

    return {
      ...member,
      rank,
      rankSymbol,
    }
  })
})

let map = null
let memberMarkers = {}
let memberTrackLines = {} // Solid Polyline for member traveled path history
let memberRouteLines = {} // Dashed Polyline for route to destination
let destMarker = null
let hasCenteredOnDestination = false
let hasCenteredOnUser = false
let hasFittedOnce = false
let lastFitSignature = ''
let lastMyLat = null
let lastMyLng = null

function getMemberColor(member) {
  if (!member) return DISTINCT_COLORS[0]
  if (member.member_id === props.memberId) return '#4F46E5' // You are always Indigo Blue

  let hash = 0
  for (let i = 0; i < member.member_id.length; i++) {
    hash = member.member_id.charCodeAt(i) + ((hash << 5) - hash)
  }
  const idx = (Math.abs(hash) % (DISTINCT_COLORS.length - 1)) + 1
  return DISTINCT_COLORS[idx]
}

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getRankClass(rank) {
  if (rank === 1) return 'rank-first'
  if (rank === 2) return 'rank-second'
  if (rank === 3) return 'rank-third'
  return 'rank-other'
}

// Create custom avatar marker with rank badge on map
function createAvatarIcon(member, color) {
  const initials = getInitials(member.name)
  const isReached = member.reached
  const finalColor = isReached ? '#10B981' : color
  const rankText = member.rank === 1 ? '👑 #1' : `#${member.rank || '?'}`

  return L.divIcon({
    className: 'avatar-marker',
    html: `
      <div style="position: relative; width: 48px; height: 62px; display: flex; flex-direction: column; align-items: center;">
        <!-- Pulsing ring animation for live location -->
        <div style="
          position: absolute;
          top: -3px; left: -1px;
          width: 50px; height: 50px;
          border-radius: 50%;
          border: 2.5px solid ${finalColor};
          animation: pulse-ring 2.2s infinite;
          opacity: 0.6;
        "></div>
        
        <!-- Rank Pill Badge -->
        <div style="
          position: absolute;
          top: -8px;
          background: #1E293B;
          color: #F8FAFC;
          font-size: 10px;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 10px;
          border: 1.5px solid ${finalColor};
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          z-index: 10;
          white-space: nowrap;
        ">${rankText}</div>

        <!-- Avatar Circle -->
        <div style="
          width: 44px; height: 44px;
          background: ${finalColor};
          border: 3px solid #FFFFFF;
          border-radius: 50%;
          box-shadow: 0 4px 14px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          font-weight: 800;
          font-size: 15px;
          font-family: 'Segoe UI', sans-serif;
          z-index: 2;
          margin-top: 4px;
        ">${initials}</div>
        
        <!-- Pointer Arrow -->
        <div style="
          width: 0; height: 0;
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-top: 9px solid #FFFFFF;
          margin-top: -2px;
          z-index: 1;
        "></div>
      </div>
    `,
    iconSize: [48, 62],
    iconAnchor: [24, 62],
  })
}

function bindMemberTooltip(marker, member) {
  const isYou = member.member_id === props.memberId
  const nameLabel = isYou ? `${member.name} (You)` : member.name
  const distLabel = member.reached ? 'Arrived' : (member.distance_text || 'Locating...')
  const rankLabel = member.rank ? `[#${member.rank}] ` : ''
  const fullLabel = `${rankLabel}${nameLabel} • ${distLabel}`

  marker.bindTooltip(fullLabel, {
    permanent: true,
    direction: 'top',
    offset: [0, -56],
    className: 'member-tooltip',
  })
}

function upsertMemberMarker(member, pos) {
  const color = getMemberColor(member)
  const icon = createAvatarIcon(member, color)

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
      memberTrackLines[member.member_id].setStyle({ color, opacity: 0.88 })
    } else {
      memberTrackLines[member.member_id] = L.polyline(historyPoints, {
        color,
        weight: 5,
        opacity: 0.88,
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
        opacity: 0.65,
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

  const enrichedMember = rankedMembers.value.find(m => m.member_id === props.memberId) || currentMember
  upsertMemberMarker(enrichedMember, [lat, lng])
  upsertMemberTrackAndRoute(enrichedMember, [lat, lng], history)
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
        background: #EF4444;
        border: 3px solid #991B1B;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
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

  const serverMembers = (data.members || [])
  const updatedMembers = serverMembers.map(m => {
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

    const existingMember = members.value.find(em => em.member_id === m.member_id)
    const history = (m.history && m.history.length > 0) ? m.history : (existingMember?.history || [])

    return {
      ...m,
      history,
      distance_meters: dist,
      distance_text: distText,
    }
  })

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
  rankedMembers.value.forEach((m) => {
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
      if (!wsConnected.value && liveError.value) {
        liveError.value = ''
      }
    } catch (e) {
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
    return
  }

  if (status.type === 'error') {
    wsConnected.value = false
    liveError.value = ''
  }
}

function copyInvite() {
  const url = `${location.origin}${location.pathname}?room=${props.roomId}`
  navigator.clipboard.writeText(url).then(() => {
    copied.value = true
    if (isLocalOnlyHost()) {
      shareMessage.value = `Room Link: ${url} (Use local IP e.g. http://192.168.x.x:5173 for mobile)`
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
  font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #F8FAFC;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #FFFFFF;
  border-bottom: 1px solid #E2E8F0;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
  z-index: 1000;
}
.header-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dest-icon {
  font-size: 24px;
}
.header-left h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: #0F172A;
}
.room-id {
  font-size: 12px;
  color: #64748B;
}
.room-id strong {
  color: #4F46E5;
  font-family: monospace;
}
.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border: none;
  border-radius: 20px;
  background: linear-gradient(135deg, #4F46E5, #6366F1);
  color: #FFFFFF;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.35);
  transition: all 0.2s ease;
}
.share-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.45);
}

/* Notice Banner */
.notice-banner {
  background: #EEF2FF;
  color: #3730A3;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  text-align: center;
  border-bottom: 1px solid #C7D2FE;
}

/* Map Stage */
.map-stage {
  flex: 1;
  min-height: 320px;
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
  background: #FFFFFF;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  color: #1E293B;
  cursor: pointer;
  display: flex;
  font-size: 16px;
  font-weight: 800;
  height: 36px;
  justify-content: center;
  width: 36px;
  transition: background 0.15s;
}
.pan-btn:hover {
  background: #F1F5F9;
}
.pan-up { grid-column: 2; grid-row: 1; }
.pan-left { grid-column: 1; grid-row: 2; }
.pan-right { grid-column: 3; grid-row: 2; }
.pan-down { grid-column: 2; grid-row: 3; }

/* Live Status Pill Overlay */
.live-status-pill {
  position: absolute;
  top: 14px;
  right: 14px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(8px);
  color: #FFFFFF;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  z-index: 700;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  background: #10B981;
  border-radius: 50%;
  box-shadow: 0 0 8px #10B981;
  animation: pulse-dot 1.5s infinite;
}

/* Members Card & Leaderboard */
.members-card {
  background: #FFFFFF;
  border-top: 1px solid #E2E8F0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.06);
  padding: 16px 20px;
  max-height: 250px;
  overflow-y: auto;
}
.members-header {
  margin-bottom: 12px;
}
.header-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: #1E293B;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.member-count-badge {
  background: #F1F5F9;
  color: #475569;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
}

/* Members Grid */
.members-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.member-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  position: relative;
  transition: transform 0.15s, box-shadow 0.15s;
}
.member-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(0,0,0,0.04);
}
.member-card.is-you {
  background: #EEF2FF;
  border-color: #C7D2FE;
}
.member-card.is-arrived {
  background: #ECFDF5;
  border-color: #A7F3D0;
}

/* Avatar Wrap & Rank Badge */
.avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #FFFFFF;
  font-weight: 800;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  border: 2px solid #FFFFFF;
}
.rank-badge {
  position: absolute;
  bottom: -4px;
  right: -6px;
  font-size: 9px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 8px;
  border: 1.5px solid #FFFFFF;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.rank-first {
  background: #FEF08A;
  color: #854D0E;
}
.rank-second {
  background: #E2E8F0;
  color: #334155;
}
.rank-third {
  background: #FFEDD5;
  color: #9A3412;
}
.rank-other {
  background: #1E293B;
  color: #F8FAFC;
}

/* Details */
.member-details {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.member-name {
  font-size: 14px;
  font-weight: 700;
  color: #0F172A;
}
.you-tag {
  background: #4F46E5;
  color: #FFFFFF;
  font-size: 10px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
  flex-wrap: wrap;
}
.tag {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}
.arrived-tag {
  background: #D1FAE5;
  color: #065F46;
}
.leader-tag {
  background: #FEF3C7;
  color: #92400E;
}
.rank-tag {
  background: #E2E8F0;
  color: #475569;
}
.distance-text {
  font-size: 13px;
  font-weight: 600;
  color: #64748B;
}
.distance-text.waiting {
  color: #94A3B8;
  font-style: italic;
}

/* Right Color Indicator Bar */
.color-indicator-bar {
  width: 6px;
  height: 32px;
  border-radius: 4px;
  flex-shrink: 0;
}

.no-members {
  color: #94A3B8;
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}

/* Banners */
.error-banner {
  color: #EF4444;
  background: #FEF2F2;
  text-align: center;
  padding: 8px;
  margin: 0;
  font-size: 13px;
  border-top: 1px solid #FEE2E2;
}
.location-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.retry-btn {
  border: none;
  border-radius: 999px;
  background: #EF4444;
  color: #FFFFFF;
  cursor: pointer;
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
}
.retry-btn:hover {
  background: #DC2626;
}
</style>

<style>
/* Global Leaflet Overrides */
.avatar-marker, .dest-pin-marker {
  background: none !important;
  border: none !important;
}
@keyframes pulse-ring {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.35); opacity: 0.15; }
  100% { transform: scale(0.95); opacity: 0.8; }
}
@keyframes pulse-dot {
  0% { transform: scale(0.9); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.6; }
  100% { transform: scale(0.9); opacity: 1; }
}
.dest-tooltip {
  background: #FFFFFF;
  color: #0F172A;
  border: none;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  font-weight: 800;
  font-size: 13px;
  padding: 6px 10px;
}
.dest-tooltip::before {
  border-top-color: #FFFFFF !important;
}
.member-tooltip {
  background: #0F172A;
  color: #FFFFFF;
  border: none;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  font-weight: 700;
  font-size: 12px;
  padding: 5px 11px;
  white-space: nowrap;
}
.member-tooltip::before {
  border-top-color: #0F172A !important;
}
</style>
