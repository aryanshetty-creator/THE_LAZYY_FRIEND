<template>
  <div class="home-view">
    <div class="brand">
      <div class="logo">📍</div>
      <h1>The Lazy Friend</h1>
      <p class="tagline">Know exactly where your always-late friends are</p>
    </div>

    <div class="card" v-if="!joining">
      <div class="card-header">
        <h2>Create a Room</h2>
        <p class="card-desc">Set a meetup destination and invite your group</p>
      </div>

      <div class="form-group">
        <label>Room Name</label>
        <input v-model="roomName" placeholder="e.g. Pizza Night, College Reunion" />
      </div>

      <div class="form-group">
        <label>Your Name</label>
        <input v-model="yourName" placeholder="What should others see you as?" />
      </div>

      <div class="form-group">
        <label>Destination</label>
        <div class="dest-search-wrap">
          <input
            v-model="searchQuery"
            placeholder="Search a place (e.g. Udupi, Forum Mall)"
            @keyup.enter="searchAndSelectFirst"
            @input="onSearchInput"
          />
          <button class="icon-btn" @click="searchPlace()" :disabled="searching">
            <span v-if="!searching">🔍</span>
            <span v-else class="spinner"></span>
          </button>
        </div>
        <!-- Search results dropdown -->
        <div v-if="searchResults.length > 0" class="search-results">
          <div
            v-for="(result, i) in searchResults"
            :key="i"
            class="search-result-item"
            @click="selectPlace(result)"
          >
            <span class="result-icon">📍</span>
            <div class="result-text">
              <span class="result-name">{{ result.shortName }}</span>
              <span class="result-detail">{{ result.display_name }}</span>
            </div>
          </div>
        </div>
        <!-- Selected destination display -->
        <div v-if="destLat != null" class="selected-dest">
          <span class="dest-badge">✓ {{ destName }}</span>
          <button class="clear-btn" @click="clearDest">×</button>
        </div>
      </div>

      <!-- Map picker -->
      <div class="form-group">
        <button class="btn-outline" @click="pickOnMap = !pickOnMap">
          <span>🗺️</span> {{ pickOnMap ? 'Hide Map' : 'Or pick on map' }}
        </button>
        <div v-if="pickOnMap" class="map-wrap">
          <div ref="pickMapEl" class="pick-map"></div>
        </div>
      </div>

      <button class="btn-primary" @click="handleCreate" :disabled="creating">
        {{ creating ? 'Creating...' : 'Create Room →' }}
      </button>

      <div class="divider"><span>or</span></div>

      <button class="btn-ghost" @click="joining = true">Join an existing room</button>
    </div>

    <!-- JOIN CARD -->
    <div class="card" v-else>
      <div class="card-header">
        <h2>Join a Room</h2>
        <p class="card-desc">Enter the room code shared by your friend</p>
      </div>

      <div class="form-group">
        <label>Room Code</label>
        <input v-model="joinRoomId" placeholder="e.g. a3f8b2c1" />
      </div>

      <div class="form-group">
        <label>Your Name</label>
        <input v-model="yourName" placeholder="What should others see you as?" />
      </div>

      <button class="btn-primary" @click="handleJoin" :disabled="creating">
        {{ creating ? 'Joining...' : 'Join Room →' }}
      </button>

      <div class="divider"><span>or</span></div>

      <button class="btn-ghost" @click="joining = false">← Create a new room instead</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { createRoom, joinRoom } from '../../shared/api.js'
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM, DESTINATION_ZOOM } from '../../shared/mapConfig.js'
import L from 'leaflet'

const emit = defineEmits(['entered'])

const roomName = ref('')
const yourName = ref('')
const destName = ref('')
const destLat = ref(null)
const destLng = ref(null)
const joining = ref(false)
const joinRoomId = ref('')
const creating = ref(false)
const error = ref('')
const pickOnMap = ref(false)
const pickMapEl = ref(null)
const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)

let pickMap = null
let pickMarker = null
let searchTimeout = null

// Check URL for room invite
const urlParams = new URLSearchParams(window.location.search)
if (urlParams.get('room')) {
  joinRoomId.value = urlParams.get('room')
  joining.value = true
}

// Debounced search on input
function onSearchInput() {
  clearTimeout(searchTimeout)
  if (searchQuery.value.trim().length < 3) {
    searchResults.value = []
    return
  }
  searchTimeout = setTimeout(() => {
    searchPlace()
  }, 500)
}

async function searchAndSelectFirst() {
  if (searchResults.value.length > 0) {
    selectPlace(searchResults.value[0])
    await createAfterDestinationEnter()
    return
  }

  await searchPlace({ autoSelectFirst: true })
  await createAfterDestinationEnter()
}

async function searchPlace(options = {}) {
  if (!searchQuery.value.trim()) return
  searching.value = true
  error.value = ''
  try {
    const q = encodeURIComponent(searchQuery.value.trim())
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=5&countrycodes=in`)
    const data = await res.json()
    if (data.length > 0) {
      const results = data.map(item => ({
        ...item,
        shortName: item.display_name.split(',')[0],
      }))
      searchResults.value = results
      if (options.autoSelectFirst) {
        selectPlace(results[0])
      }
    } else {
      searchResults.value = []
      error.value = 'No results found, try a different name'
    }
  } catch (e) {
    error.value = 'Search failed, try again'
  } finally {
    searching.value = false
  }
}

function selectPlace(result) {
  const lat = parseFloat(result.lat)
  const lng = parseFloat(result.lon)
  destLat.value = parseFloat(lat.toFixed(6))
  destLng.value = parseFloat(lng.toFixed(6))
  destName.value = result.shortName
  searchResults.value = []
  searchQuery.value = ''

  // If map is open, fly to it
  if (pickMap) {
    pickMap.setView([lat, lng], 15)
    if (pickMarker) pickMap.removeLayer(pickMarker)
    pickMarker = L.marker([lat, lng]).addTo(pickMap)
  }
}

function clearDest() {
  destLat.value = null
  destLng.value = null
  destName.value = ''
  if (pickMarker && pickMap) {
    pickMap.removeLayer(pickMarker)
    pickMarker = null
  }
}

async function createAfterDestinationEnter() {
  if (!roomName.value || !yourName.value || destLat.value == null || destLng.value == null) {
    return
  }

  await handleCreate()
}

watch(pickOnMap, async (val) => {
  if (val) {
    await nextTick()
    if (!pickMap && pickMapEl.value) {
      pickMap = L.map(pickMapEl.value, {
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
      }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(pickMap)

      pickMap.on('click', (e) => {
        destLat.value = parseFloat(e.latlng.lat.toFixed(6))
        destLng.value = parseFloat(e.latlng.lng.toFixed(6))
        destName.value = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`
        if (pickMarker) pickMap.removeLayer(pickMarker)
        pickMarker = L.marker(e.latlng).addTo(pickMap)
      })

      // If destination already selected, show it
      if (destLat.value != null && destLng.value != null) {
        pickMap.setView([destLat.value, destLng.value], DESTINATION_ZOOM)
        pickMarker = L.marker([destLat.value, destLng.value]).addTo(pickMap)
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          pickMap.setView([pos.coords.latitude, pos.coords.longitude], USER_LOCATION_ZOOM)
        })
      }
    }
  }
})

onBeforeUnmount(() => {
  if (pickMap) {
    pickMap.remove()
    pickMap = null
  }
})

async function handleCreate() {
  error.value = ''
  if (!roomName.value || !yourName.value || destLat.value == null || destLng.value == null) {
    error.value = 'Please fill all fields and set a destination'
    return
  }
  creating.value = true
  try {
    const res = await createRoom(roomName.value, destLat.value, destLng.value, destName.value || 'Destination')
    const joined = await joinRoom(res.room_id, yourName.value)
    emit('entered', {
      roomId: res.room_id,
      memberId: joined.member_id,
      memberName: yourName.value,
    })
  } catch (e) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

async function handleJoin() {
  error.value = ''
  if (!joinRoomId.value || !yourName.value) {
    error.value = 'Please enter room code and your name'
    return
  }
  creating.value = true
  try {
    const res = await joinRoom(joinRoomId.value, yourName.value)
    emit('entered', {
      roomId: joinRoomId.value,
      memberId: res.member_id,
      memberName: yourName.value,
    })
  } catch (e) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.home-view {
  max-width: 440px;
  margin: 0 auto;
  padding: 40px 20px;
  font-family: 'Segoe UI', -apple-system, sans-serif;
  min-height: 100vh;
}

/* Brand */
.brand {
  text-align: center;
  margin-bottom: 32px;
}
.logo {
  font-size: 48px;
  margin-bottom: 8px;
}
h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 6px;
}
.tagline {
  color: #6b7280;
  font-size: 14px;
  margin: 0;
}

/* Card */
.card {
  background: #fff;
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.04);
}
.card-header h2 {
  margin: 0 0 4px;
  font-size: 1.3rem;
  font-weight: 700;
  color: #1a1a2e;
}
.card-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: #9ca3af;
}

/* Form */
.form-group {
  margin-bottom: 16px;
  position: relative;
}
.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.form-group input {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: #fafafa;
}
.form-group input:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
  background: #fff;
}

/* Destination search */
.dest-search-wrap {
  display: flex;
  gap: 0;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #fafafa;
  transition: border-color 0.2s;
}
.dest-search-wrap:focus-within {
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
  background: #fff;
}
.dest-search-wrap input {
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 12px 14px;
  flex: 1;
  margin: 0;
}
.dest-search-wrap input:focus {
  outline: none;
  box-shadow: none;
}
.icon-btn {
  width: 44px;
  border: none;
  background: #4f46e5;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border-radius: 0;
  transition: background 0.2s;
}
.icon-btn:hover {
  background: #4338ca;
}
.icon-btn:disabled {
  opacity: 0.7;
}

/* Search results dropdown */
.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  z-index: 100;
  margin-top: 4px;
  max-height: 220px;
  overflow-y: auto;
}
.search-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.search-result-item:hover {
  background: #f3f4f6;
}
.search-result-item:not(:last-child) {
  border-bottom: 1px solid #f3f4f6;
}
.result-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.result-text {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.result-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a2e;
}
.result-detail {
  font-size: 12px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Selected destination badge */
.selected-dest {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 8px 12px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 8px;
}
.dest-badge {
  font-size: 13px;
  font-weight: 600;
  color: #065f46;
}
.clear-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  margin: 0;
  border: none;
  background: #d1fae5;
  color: #065f46;
  font-size: 16px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.clear-btn:hover {
  background: #a7f3d0;
}

/* Map */
.map-wrap {
  margin-top: 8px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}
.pick-map {
  width: 100%;
  height: 220px;
}

/* Buttons */
.btn-primary {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.2s;
  margin-top: 8px;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}
.btn-primary:active {
  transform: translateY(0);
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}
.btn-outline {
  width: 100%;
  padding: 10px;
  border: 1.5px dashed #d1d5db;
  border-radius: 10px;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
  margin: 0;
}
.btn-outline:hover {
  border-color: #4f46e5;
  color: #4f46e5;
}
.btn-ghost {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #4f46e5;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin: 0;
}
.btn-ghost:hover {
  background: #f5f3ff;
}

/* Divider */
.divider {
  display: flex;
  align-items: center;
  margin: 16px 0;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid #e5e7eb;
}
.divider span {
  padding: 0 12px;
  font-size: 12px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Error */
.error {
  color: #ef4444;
  text-align: center;
  margin-top: 16px;
  font-size: 13px;
  font-weight: 500;
}

/* Spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
