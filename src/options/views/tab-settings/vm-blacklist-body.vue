<template>
  <p v-text="desc" class="mt-1"/>
  <div class="flex flex-wrap">
    <setting-text :name="name" class="flex-1" :get-errors="getErrors"/>
  </div>
</template>

<script>
import { sendCmdDirectly } from '@/common';
import { ERRORS } from '@/common/consts';
</script>

<script setup>
import SettingText from '@/common/ui/setting-text';

const props = defineProps({
  name: String,
  desc: String,
});
const getErrors = () => sendCmdDirectly('Storage', ['base', 'getOne', props.name + ERRORS]);
</script>
