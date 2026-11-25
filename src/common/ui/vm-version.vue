<template>
  <div>{{MAIN}} <small v-text="DETAILS" style="opacity: .5"/></div>
</template>

<script setup>
const MAIN = `${extensionManifest.name} ${__.VM_VER}`;
const DETAILS = __.MV3 ? 'MV3' + __.VM_VER_COMMIT : __.VM_VER_COMMIT.slice(1);
</script>
