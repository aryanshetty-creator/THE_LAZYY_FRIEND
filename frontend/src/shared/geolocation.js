/**
 * Geolocation helper — wraps the Browser Geolocation API.
 */

let watchId = null
let lastErrorMessage = ''

export function startWatchingLocation(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError && onError('Geolocation is not supported by your browser')
    return
  }

  stopWatchingLocation()
  lastErrorMessage = ''

  const options = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000,
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onUpdate(pos.coords.latitude, pos.coords.longitude)
    },
    (err) => {
      console.warn('[Geo] High accuracy initial fix failed, attempting fallback...', err)
      navigator.geolocation.getCurrentPosition(
        (fallbackPos) => {
          onUpdate(fallbackPos.coords.latitude, fallbackPos.coords.longitude)
        },
        (fallbackErr) => {
          lastErrorMessage = readableLocationError(fallbackErr)
          onError && onError(lastErrorMessage)
        },
        { enableHighAccuracy: false, maximumAge: 10000, timeout: 10000 }
      )
    },
    options
  )

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastErrorMessage = ''
      onUpdate(pos.coords.latitude, pos.coords.longitude)
    },
    (err) => {
      const message = readableLocationError(err)
      if (message !== lastErrorMessage) {
        lastErrorMessage = message
        onError && onError(message)
      }
    },
    options
  )
}

export function stopWatchingLocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}

function readableLocationError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    return 'Location permission is blocked. Allow location access in the browser, then try again.'
  }

  if (err.code === err.POSITION_UNAVAILABLE) {
    return 'Your location is unavailable right now. Turn on Wi-Fi/GPS and try again.'
  }

  if (err.code === err.TIMEOUT) {
    return 'Location timed out. Move near a window or try again with Wi-Fi/GPS on.'
  }

  return err.message || 'Could not get your location'
}
