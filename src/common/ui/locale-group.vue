<template>
  <span>
    {{parts[0]}}
    <slot></slot>
    {{parts[1]}}
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { i18n } from '@/common';

const SEP = '\x02';
const props = defineProps(['i18nKey']);
const parts = computed(() => i18n(props.i18nKey, [SEP]).split(SEP));
</script>
