<template>
  <p v-text="props.desc" class="mt-1"/>
  <div class="flex flex-wrap">
    <setting-text :name="props.name" class="flex-1" @bgError="errors = $event"/>
    <ol v-if="errors" class="text-red">
      <li v-for="e in errors" :key="e" v-text="e"/>
    </ol>
  </div>
</template>

<script>
import { sendCmdDirectly } from '@/common';
import { ERRORS } from '@/common/consts';
</script>

<script setup>
import SettingText from '@/common/ui/setting-text';
import { onMounted, ref } from 'vue';

const errors = ref();
const props = defineProps({
  name: String,
  desc: String,
});

onMounted(async () => {
  errors.value = await sendCmdDirectly('Storage', ['base', 'getOne', props.name + ERRORS]);
});
</script>
