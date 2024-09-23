<template>
  <div>
    <setting-check name="autoReload" :label="i18n('labelAutoReloadCurrentTab')"/>
  </div>
  <div class="ml-2c flex flex-col">
    <!-- ml-2c indents children after the first one for visual grouping -->
    <setting-check name="editorWindow" class="mr-2" ref="$EW">
      <tooltip :content="EDITOR_WINDOW_HINT" :disabled="!EDITOR_WINDOW_HINT">
        <span v-text="i18n('optionEditorWindow')"/>
      </tooltip>
    </setting-check>
    <setting-check name="editorWindowSimple" :label="i18n('optionEditorWindowSimple')"
                   v-show="$EW?.value"/>
  </div>
  <div class="single">
    <label>
      <span v-text="i18n('labelWidth')"/>
      <input v-model="popupWidth" type="range"
             @mousedown="onMouseDownInRangeInput"
             :min="WIDTH_MIN" :max="WIDTH_MAX" step="1" />
      <input v-model="popupWidth" type="number" style="field-sizing:content" class="ml-1"
             ref="$popupWidthNumber"
             :min="WIDTH_MIN" :max="WIDTH_MAX" step="1" />
      px
      <button v-text="i18n('buttonReset')" class="ml-1"
              v-if="popupWidth !== optionsDefaults[kPopupWidth]"
              @click="popupWidth = optionsDefaults[kPopupWidth]"/>
    </label>
  </div>
  <div class="ml-2c">
    <label>
      <locale-group i18n-key="labelPopupSort">
        <select v-for="opt in [kFPSort]" v-model="settings[opt]" :key="opt">
          <option v-for="(title, value) in items[opt]" :key="`${opt}:${value}`"
                  :value v-text="title"/>
        </select>
      </locale-group>
    </label>
    <setting-check name="filtersPopup.groupRunAt" :label="i18n('optionPopupGroupRunAt')"
                   v-show="settings[kFPSort] === 'exec'"/>
    <label>
      <select v-for="opt in [kFPHideDisabled]" v-model="settings[opt]" :key="opt">
        <option v-for="(title, value) in items[opt]" :key="`${opt}:${value}`"
                :value v-text="title"/>
      </select>
    </label>
    <setting-check name="filtersPopup.enabledFirst" :label="i18n('optionPopupEnabledFirst')"
                   v-show="!settings[kFPHideDisabled]"/>
  </div>
  <div class="single">
    <label>
      <span v-text="i18n('labelBadge')"/>
      <select v-for="opt in [kShowBadge]" v-model="settings[opt]" :key="opt">
        <option v-for="(title, value) in items[opt]" :key="`${opt}:${value}`"
                :value v-text="title"/>
      </select>
    </label>
  </div>
  <div class="single">
    <label>
      <span v-text="i18n('labelBadgeColors')"/>
      <tooltip v-for="(title, name) in badgeColorEnum" :key="`bc:${name}`"
               :content="title">
        <input type="color" v-model="settings[name]" v-if="settings[name]">
      </tooltip>
      <button v-text="i18n('buttonReset')" v-show="isCustomBadgeColor" class="ml-1"
              @click="onResetBadgeColors"/>
    </label>
  </div>
</template>

<script>
import { browserWindows, debounce, i18n } from '@/common';
import { mapEntry } from '@/common/object';
import optionsDefaults, { kPopupWidth } from '@/common/options-defaults';
import { getActiveElement } from '@/common/ui';
import { hookSettingsForUI, NORMALIZE } from '@/common/ui/util';

const EDITOR_WINDOW_HINT = browserWindows?.onBoundsChanged ? '' : i18n('optionEditorWindowHint');
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const WIDTH_MIN = 260;
const WIDTH_MAX = 800;
const kFPHideDisabled = 'filtersPopup.hideDisabled';
const kFPSort = 'filtersPopup.sort';
const kShowBadge = 'showBadge';
const badgeColorEnum = {
  badgeColor: i18n('titleBadgeColor'),
  badgeColorBlocked: i18n('titleBadgeColorBlocked'),
};
const badgeColorItem = {
  ...badgeColorEnum, // exposing to the template
  [NORMALIZE]: (val, name) => HEX_COLOR_RE.test(val) ? val : optionsDefaults[name],
};
const items = {
  [kPopupWidth]: val => Math.max(WIDTH_MIN, Math.min(WIDTH_MAX,
    +val || optionsDefaults[kPopupWidth])),
  [kShowBadge]: {
    '': i18n('labelBadgeNone'),
    unique: i18n('labelBadgeUnique'),
    total: i18n('labelBadgeTotal'),
  },
  [kFPHideDisabled]: {
    '': i18n('optionPopupShowDisabled'),
    group: i18n('optionPopupGroupDisabled'),
    hide: i18n('optionPopupHideDisabled'),
  },
  [kFPSort]: {
    exec: i18n('filterExecutionOrder'),
    alpha: i18n('filterAlphabeticalOrder'),
  },
  ...badgeColorEnum::mapEntry(() => badgeColorItem),
};
</script>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import LocaleGroup from './locale-group.vue';
import SettingCheck from './setting-check.vue';

let popupWidthDragging;

const settings = reactive({});
const popupWidth = ref();
const $popupWidthNumber = ref();
const $EW = ref();
const isCustomBadgeColor = computed(() => { // eslint-disable-line vue/return-in-computed-property
  for (const name in badgeColorEnum) {
    if (settings[name] !== optionsDefaults[name]) {
      return true;
    }
  }
});
const onResetBadgeColors = () => {
  for (const name in badgeColorEnum) {
    settings[name] = optionsDefaults[name]; // eslint-disable-line vue/no-mutating-props
  }
};
const onMouseUp = () => {
  popupWidthDragging = false;
  settings[kPopupWidth] = popupWidth.value;
};
const onMouseDownInRangeInput = () => {
  popupWidthDragging = true;
  addEventListener('mouseup', onMouseUp, { once: true });
};
const flushPopupWidth = val => {
  settings[kPopupWidth] = val;
};
const flushPopupWidthLater = debounce(flushPopupWidth, 250);

onMounted(() => {
  hookSettingsForUI(items, settings, watch, 0);
  watch(() => settings[kPopupWidth], val => {
    if (!popupWidthDragging) popupWidth.value = val;
  });
  watch(popupWidth, val => {
    if (!popupWidthDragging) {
      (getActiveElement() === $popupWidthNumber.value
        ? flushPopupWidthLater
        : flushPopupWidth
      )(val);
    }
  });
  popupWidth.value = settings[kPopupWidth];
});
</script>

<style>
.single > label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  white-space: pre-wrap;
}
</style>
