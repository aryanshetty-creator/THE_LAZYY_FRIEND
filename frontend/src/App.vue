<script setup>
import { ref } from 'vue'
import RoomHome from './features/room/RoomHome.vue'
import TrackingMap from './features/tracking/TrackingMap.vue'

const session = ref(null)

function onEntered(data) {
  session.value = data
}
</script>

<template>
  <TrackingMap
    v-if="session"
    :roomId="session.roomId"
    :memberId="session.memberId"
    :memberName="session.memberName"
  />
  <RoomHome v-else @entered="onEntered" />
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  background: linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #fef3f2 100%);
  font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
  min-height: 100vh;
}
</style>
