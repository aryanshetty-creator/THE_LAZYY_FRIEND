/**
 * Geolocation helper — wraps the Browser Geolocation API.
 */

let watchId = null

export function startWatchingLocation(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError && onError('Geolocation is not supported by your browser')
    return
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onUpdate(pos.coords.latitude, pos.coords.longitude)
    },
    (err) => {
      onError && onError(err.message)
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000,
    }
  )
}

export function stopWatchingLocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}
