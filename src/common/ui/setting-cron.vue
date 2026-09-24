<template>
  <cron-input :model-value="value" :disabled @change="onChange"/>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { isValidCron } from '@/common/cron';
import options from '../options';
import hookSetting from '../hook-setting';
import CronInput from './cron-input.vue';

const props = defineProps({
  name: String,
  disabled: Boolean,
  sync: {
    type: Boolean,
    default: true,
  },
});
const emit = defineEmits(['change']);
const value = ref('');
const revoke = hookSetting(props.name, val => {
  value.value = val || '';
});

watch(value, val => {
  if (props.sync && (!val || isValidCron(val))) options.set(props.name, val);
  emit('change', val);
});
onBeforeUnmount(revoke);

function onChange(next) {
  value.value = next;
}
</script>
