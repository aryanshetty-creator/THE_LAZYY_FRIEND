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

    <div ref="mapEl" class="map-container"></div>

    <div class="members-list">
      <h3>Members</h3>
      <div v-for="member in sortedMembers" :key="member.member_id" class="member-row">
        <span class="member-dot" :class="{ reached: member.reached, you: member.member_id === memberId }"></span>
        <span class="member-name">
          {{ member.name }}
          <span v-if="member.member_id === memberId" class="you-badge">(you)</span>
        </span>
        <span class="member-tag closest" v-if="member.member_id === closestId">Closest</span>
        <span class="member-tag furthest" v-if="member.member_id === furthestId">Furthest</span>
        <span class="member-distance" v-if="member.distance_text">
          {{ member.reached ? 'Arrived' : member.distance_text + ' remaining' }}
        </span>
        <span class="member-distance" v-else>Waiting for location...</span>
      </div>
      <p v-if="members.length === 0" class="no-members">No members yet</p>
    </div>

    <div v-if="geoError" class="error location-error">
      <span>{{ geoError }}</span>
      <button class="retry-btn" @click="beginLocationWatch">Retry location</button>
    </div>
    <p v-if="liveError" class="error">{{ liveError }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { connectWebSocket, sendLocation, disconnectWebSocket } from '../../shared/websocket.js'
import { startWatchingLocation, stopWatchingLocation } from '../../shared/geolocation.js'
import { getRoom } from '../../shared/api.js'
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
let memberRoutes = {}
let destMarker = null
let hasCenteredOnDestination = false
let hasCenteredOnUser = false
let hasFittedOnce = false
let lastFitSignature = ''

// Color palette for members
const COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6', '#7B1FA2']
const ARRIVAL_RADIUS_METERS = 50

function getColor(index) {
  return COLORS[index % COLORS.length]
}

function getMemberColor(member) {
  if (member.member_id === props.memberId) return '#4F46E5'
  const index = members.value.findIndex((m) => m.member_id === member.member_id)
  return getColor(index >= 0 ? index : 0)
}

// Create avatar-style circular marker with initials
function createAvatarIcon(name, color) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  return L.divIcon({
    className: 'avatar-marker',
    html: `
      <div style="
        width: 40px; height: 40px;
        background: ${color};
        border: 3px solid #fff;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 700;
        font-size: 14px;
        font-family: 'Segoe UI', sans-serif;
      ">${initials}</div>
      <div style="
        width: 0; height: 0;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-top: 10px solid #fff;
        margin: -2px auto 0;
      "></div>
    `,
    iconSize: [40, 54],
    iconAnchor: [20, 54],
  })
}

function bindMemberTooltip(marker, member) {
  const label = member.member_id === props.memberId ? `${member.name} (You)` : member.name
  marker.bindTooltip(label, {
    permanent: true,
    direction: 'top',
    offset: [0, -48],
    className: 'member-tooltip',
  })
}

function upsertMemberMarker(member, pos) {
  const color = member.reached ? '#34A853' : getMemberColor(member)
  const icon = createAvatarIcon(member.name, color)

  if (memberMarkers[member.member_id]) {
    memberMarkers[member.member_id].setLatLng(pos).setIcon(icon)
    bindMemberTooltip(memberMarkers[member.member_id], member)
  } else {
    memberMarkers[member.member_id] = L.marker(pos, { icon }).addTo(map)
    bindMemberTooltip(memberMarkers[member.member_id], member)
  }
}

function upsertMemberRoute(member, pos) {
  if (!roomData.value?.destination || !map) return

  const destination = roomData.value.destination
  const destinationPosition = [destination.lat, destination.lng]

  if (member.reached) {
    removeMemberRoute(member.member_id)
    return
  }

  if (memberRoutes[member.member_id]) {
    memberRoutes[member.member_id].setLatLngs([pos, destinationPosition])
    memberRoutes[member.member_id].setStyle({ color: getMemberColor(member) })
    return
  }

  memberRoutes[member.member_id] = L.polyline([pos, destinationPosition], {
    color: getMemberColor(member),
    weight: 5,
    opacity: 0.7,
    dashArray: '10, 8',
  }).addTo(map)
}

function removeMemberRoute(memberId) {
  if (!memberRoutes[memberId] || !map) return
  map.removeLayer(memberRoutes[memberId])
  delete memberRoutes[memberId]
}

function fitToUserAndDestination(lat, lng) {
  if (!roomData.value?.destination || !map) return
  map.fitBounds(
    [
      [lat, lng],
      [roomData.value.destination.lat, roomData.value.destination.lng],
    ],
    { padding: [50, 50], maxZoom: 15 }
  )
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
  const currentMember = {
    member_id: props.memberId,
    name: props.memberName || 'You',
    lat,
    lng,
    reached,
    distance_meters: distance,
    distance_text: formatDistance(distance),
  }
  const existingIndex = members.value.findIndex((member) => member.member_id === props.memberId)

  if (existingIndex >= 0) {
    members.value = members.value.map((member, index) => (
      index === existingIndex ? { ...member, ...currentMember } : member
    ))
  } else {
    members.value = [...members.value, currentMember]
  }

  upsertMemberMarker(currentMember, [lat, lng])
  upsertMemberRoute(currentMember, [lat, lng])
  fitAllKnownLocations()
}

// Red pin destination marker
const destIcon = L.divIcon({
  className: 'dest-pin-marker',
  html: `
    <div style="position: relative; width: 30px; height: 42px;">
      <div style="
        width: 30px; height: 30px;
        background: #EA4335;
        border: 3px solid #B71C1C;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      "></div>
      <div style="
        position: absolute;
        top: 8px; left: 10px;
        width: 10px; height: 10px;
        background: #B71C1C;
        border-radius: 50%;
      "></div>
    </div>
  `,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
})

onMounted(() => {
  // Fallback center when live geolocation has not arrived yet.
  map = L.map(mapEl.value).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(map)

  loadInitialRoomState()

  connectWebSocket(props.roomId, props.memberId, handleRoomState, handleSocketStatus)

  beginLocationWatch()
})

onBeforeUnmount(() => {
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
      updateLocalMemberLocation(lat, lng)

      if (map && !hasCenteredOnUser && !hasFittedOnce) {
        hasCenteredOnUser = true
        map.setView([lat, lng], USER_LOCATION_ZOOM)
      }

      if (roomData.value?.destination && !hasFittedOnce) {
        fitToUserAndDestination(lat, lng)
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
  members.value = data.members

  // Destination marker
  if (data.destination && !destMarker) {
    destMarker = L.marker([data.destination.lat, data.destination.lng], { icon: destIcon })
      .bindTooltip(data.destination.name, { permanent: true, direction: 'top', offset: [0, -44], className: 'dest-tooltip' })
      .addTo(map)
  }

  // Update member markers and route lines
  const activeIds = new Set()
  const bounds = []

  if (data.destination) {
    bounds.push([data.destination.lat, data.destination.lng])
  }

  data.members.forEach((m, index) => {
    activeIds.add(m.member_id)
    if (m.lat == null || m.lng == null) return

    const pos = [m.lat, m.lng]
    bounds.push(pos)
    upsertMemberMarker(m, pos)
    upsertMemberRoute(m, pos)

    // Route line from member to destination
    if (!data.destination || m.reached) {
      removeMemberRoute(m.member_id)
    }
  })

  // Remove old markers and routes
  for (const id of Object.keys(memberMarkers)) {
    if (!activeIds.has(id)) {
      map.removeLayer(memberMarkers[id])
      delete memberMarkers[id]
    }
  }
  for (const id of Object.keys(memberRoutes)) {
    if (!activeIds.has(id)) {
      map.removeLayer(memberRoutes[id])
      delete memberRoutes[id]
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
      members: room.members.map((member) => ({
        ...member,
        distance_meters: null,
        distance_text: null,
      })),
    })
  } catch (e) {
    liveError.value = e.message || 'Could not load room'
  }
}

function handleSocketStatus(status) {
  if (status.type === 'open') {
    liveError.value = ''
    return
  }

  if (status.type === 'close' && status.code === 4004) {
    liveError.value = 'Room link is invalid or expired'
    return
  }

  if (status.type === 'error') {
    liveError.value = 'Live updates could not connect. Check that the backend is running on port 8000.'
  }
}

function copyInvite() {
  const url = `${location.origin}${location.pathname}?room=${props.roomId}`
  navigator.clipboard.writeText(url).then(() => {
    copied.value = true
    shareMessage.value = isLocalOnlyHost()
      ? 'This invite uses localhost, so it only opens on this device. Use your LAN IP or a hosted URL before sending it.'
      : 'Invite link copied'
    setTimeout(() => (copied.value = false), 2000)
  })
}

function isLocalOnlyHost() {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname)
}
</script>

<style scoped>
.tracking-view {
  font-family: 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  z-index: 1000;
}
.header-left h2 {
  margin: 0;
  font-size: 1.2rem;
}
.room-id {
  font-size: 12px;
  color: #888;
}
.share-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 20px;
  background: #4285F4;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.share-btn:hover {
  background: #3367D6;
}
.map-container {
  flex: 1;
  min-height: 300px;
}
.members-list {
  background: #fff;
  padding: 12px 16px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.06);
}
.members-list h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #555;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}
.member-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f97316;
  flex-shrink: 0;
}
.member-dot.you {
  background: #4f46e5;
}
.member-dot.reached {
  background: #22c55e;
}
.member-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}
.you-badge {
  color: #4f46e5;
  font-size: 12px;
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
  color: #888;
  flex-shrink: 0;
}
.no-members {
  color: #aaa;
  font-size: 13px;
}
.error {
  color: #ef4444;
  text-align: center;
  padding: 8px;
  margin: 0;
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
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
}
.retry-btn:hover {
  background: #dc2626;
}
.notice {
  background: #fffbeb;
  color: #92400e;
  font-size: 13px;
  padding: 8px 16px;
  text-align: center;
  margin: 0;
}
</style>

<style>
/* Global overrides for Leaflet markers */
.avatar-marker, .dest-pin-marker {
  background: none !important;
  border: none !important;
}
.dest-tooltip {
  background: #fff;
  border: none;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  font-weight: 600;
  font-size: 13px;
  padding: 4px 8px;
}
.dest-tooltip::before {
  border-top-color: #fff !important;
}
.member-tooltip {
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
  font-weight: 600;
  font-size: 12px;
  padding: 4px 8px;
}
.member-tooltip::before {
  border-top-color: #111827 !important;
}
</style>
