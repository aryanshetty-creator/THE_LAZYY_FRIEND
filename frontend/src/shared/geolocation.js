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

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onUpdate(pos.coords.latitude, pos.coords.longitude)
    },
    (err) => {
      lastErrorMessage = err.message
      onError && onError(readableLocationError(err))
    },
    {
      enableHighAccuracy: false,
      maximumAge: 120000,
      timeout: 15000,
    }
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
    {
      enableHighAccuracy: false,
      maximumAge: 30000,
      timeout: 30000,
    }
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
