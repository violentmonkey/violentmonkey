<template>
  <svg class="icon"><use :xlink:href="iconName" /></svg>
</template>

<script>
export default {
  props: ['name'],
  computed: {
    iconName() {
      return `#${this.name}`;
    },
  },
};
</script>
