<template>
  <div>
    <div class="form-group condensed">
      <label>
        <input type="checkbox" v-model="config.shouldUpdate" v-bind="{disabled}">
        <span v-text="i18n('labelAllowUpdate')"/>
        <span v-text="i18n('labelNotifyThisUpdated')" class="melt"/>
      </label>
      <label class="ml-1 melt" :key="value" v-for="([text, value]) of [
        [i18n('genericOn'), '1'],
        [i18n('genericOff'), '0'],
        [i18n('genericUseGlobal'), ''],
      ]"><!-- make sure to place the input and span on one line with a space between -->
        <input type="radio" v-bind="{value, disabled}"
               v-model="config.notifyUpdates"> <span v-text="text"/>
      </label>
    </div>
    <label>
      <input type="checkbox" v-model="config._editable" class="scary-switch"
             :disabled="disabled || !config.shouldUpdate">
      <span v-text="i18n('readonlyOpt')"/> <span v-text="i18n('readonlyOptWarn')"/>
    </label>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  script: Object,
});
const config = computed(() => props.script.config);
const disabled = computed(() => !props.script._remote);
</script>

<style>
.frozen-note .melt {
  display: none;
}
</style>
