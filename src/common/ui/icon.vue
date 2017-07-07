<template>
  <svg class="icon"><use :xlink:href="`#${name}`" /></svg>
</template>

<script>
export default {
  props: ['name'],
};
</script>
