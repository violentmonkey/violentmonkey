<template>
  <svg class="icon"><use :xlink:href="`#${name}`" /></svg>
</template>

<script>
const requireIcon = require.context('#/resources/svg', false, /\.svg$/);
requireIcon.keys().map(key => requireIcon(key));

export default {
  props: ['name'],
};
</script>
