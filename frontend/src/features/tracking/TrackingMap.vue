<template>
  <div class="tracking-view">
    <div class="header">
      <div class="header-left">
        <h2>{{ roomData?.destination?.name || 'Tracking' }}</h2>
        <span class="room-id">Room: {{ roomId }}</span>
      </div>
      <button class="share-btn" @click="copyInvite">{{ copied ? 'Copied!' : 'Share Invite' }}</button>
    </div>

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
          {{ member.reached ? '✅ Arrived' : member.distance_text + ' away' }}
        </span>
        <span class="member-distance" v-else>Waiting for location...</span>
      </div>
      <p v-if="members.length === 0" class="no-members">No members yet</p>
    </div>

    <p v-if="geoError" class="error">{{ geoError }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { connectWebSocket, sendLocation, disconnectWebSocket } from '../../shared/websocket.js'
import { startWatchingLocation, stopWatchingLocation } from '../../shared/geolocation.js'

const props = defineProps({
  roomId: String,
  memberId: String,
  memberName: String,
})

const mapEl = ref(null)
const members = ref([])
const roomData = ref(null)
const geoError = ref('')
const copied = ref(false)

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
let hasFittedOnce = false

// Color palette for members
const COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6', '#7B1FA2']

function getColor(index) {
  return COLORS[index % COLORS.length]
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
  // Default center: Karnataka, India (Bangalore area)
  map = L.map(mapEl.value).setView([12.97, 77.59], 13)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(map)

  // Connect WebSocket
  connectWebSocket(props.roomId, props.memberId, handleRoomState)

  // Start sending our location
  startWatchingLocation(
    (lat, lng) => {
      sendLocation(lat, lng)
    },
    (err) => {
      geoError.value = err
    }
  )
})

onBeforeUnmount(() => {
  disconnectWebSocket()
  stopWatchingLocation()
  if (map) {
    map.remove()
    map = null
  }
})

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
    const color = getColor(index)
    const icon = createAvatarIcon(m.name, m.reached ? '#34A853' : color)

    // Marker
    if (memberMarkers[m.member_id]) {
      memberMarkers[m.member_id].setLatLng(pos).setIcon(icon)
    } else {
      memberMarkers[m.member_id] = L.marker(pos, { icon }).addTo(map)
    }

    // Route line from member to destination
    if (data.destination && !m.reached) {
      const destPos = [data.destination.lat, data.destination.lng]
      if (memberRoutes[m.member_id]) {
        memberRoutes[m.member_id].setLatLngs([pos, destPos])
        memberRoutes[m.member_id].setStyle({ color })
      } else {
        memberRoutes[m.member_id] = L.polyline([pos, destPos], {
          color,
          weight: 5,
          opacity: 0.7,
          dashArray: '10, 8',
        }).addTo(map)
      }
    } else if (memberRoutes[m.member_id]) {
      map.removeLayer(memberRoutes[m.member_id])
      delete memberRoutes[m.member_id]
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

  // Fit map: focus on members only (not destination) to avoid over-zooming when far apart
  // Only fit bounds on first load or when a new member appears
  const memberBounds = []
  for (const m of data.members) {
    if (m.lat != null && m.lng != null) {
      memberBounds.push([m.lat, m.lng])
    }
  }

  if (memberBounds.length > 0 && !hasFittedOnce) {
    hasFittedOnce = true
    // Include destination only if it's reasonably close (< 20km from any member)
    if (data.destination) {
      const destPos = [data.destination.lat, data.destination.lng]
      const closeMember = memberBounds.some(([lat, lng]) => {
        const dLat = Math.abs(lat - destPos[0])
        const dLng = Math.abs(lng - destPos[1])
        return dLat < 0.18 && dLng < 0.18 // ~20km
      })
      if (closeMember) {
        memberBounds.push(destPos)
      }
    }
    map.fitBounds(memberBounds, { padding: [50, 50], maxZoom: 15, minZoom: 12 })
  }
}

function copyInvite() {
  const url = `${location.origin}${location.pathname}?room=${props.roomId}`
  navigator.clipboard.writeText(url).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  })
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
</style>
