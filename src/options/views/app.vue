<template>
  <div class="page-options">
    <aside v-if="canRenderAside">
      <div class="aside-content">
        <img src="/public/images/icon128.png">
        <h1 class="hidden-sm" v-text="i18n('extName')"/>
        <hr />
        <div class="aside-menu-item" v-for="tab in tabs" :key="tab.name">
          <a
            :href="`#${tab.name}`"
            :class="{active: tab === current}"
            :data-num-scripts="numbers[tab.name]"
            v-text="tab.label"
          />
        </div>
      </div>
    </aside>
    <keep-alive>
      <component :is="current.comp" class="tab"/>
    </keep-alive>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { i18n } from '@/common';
import { keyboardService } from '@/common/keyboard';
import { setLocationHash, store } from '../utils';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';

const tabs = [
  { name: SCRIPTS, comp: Installed, label: i18n('sideMenuInstalled') },
  { name: TAB_SETTINGS, comp: Settings, label: i18n('sideMenuSettings') },
  { name: TAB_ABOUT, comp: About, label: i18n('sideMenuAbout') },
  { name: TAB_RECYCLE, comp: Installed, label: i18n('buttonRecycleBin') },
];
const extName = i18n('extName');
const conditionNotEdit = '!editScript';

const current = computed(() => {
  const name = store.route.paths[0];
  return tabs.find(tab => tab.name === name) || tabs[0];
});

const numbers = computed(() => ({
  [SCRIPTS]: store.scripts.length,
  [TAB_RECYCLE]: store.removedScripts.length,
}));

function updateContext() {
  const isScriptsTab = current.value.name === SCRIPTS;
  const { paths } = store.route;
  keyboardService.setContext('editScript', isScriptsTab && paths[1]);
  keyboardService.setContext('tabScripts', isScriptsTab && !paths[1]);
  keyboardService.setContext('showRecycle', current.value.name === TAB_RECYCLE);
}

function switchTab(step) {
  const index = tabs.indexOf(current.value);
  const switchTo = tabs[(index + step + tabs.length) % tabs.length];
  setLocationHash(switchTo?.name || '');
}

addEventListener('dragover', evt => {
  if (store.route.hash !== TAB_SETTINGS
    && /^application\/(zip|x-zip-compressed)$/.test(evt.dataTransfer.items[0]?.type)) {
    setLocationHash(TAB_SETTINGS);
  }
}, true);

// Speedup and deflicker for initial page load:
// skip rendering the aside when starting in the editor for a new script.
const [name, tabFunc] = store.route.paths;
const canRenderAside = ref(name !== SCRIPTS || (tabFunc !== '_new' && !Number(tabFunc)));

watchEffect(() => {
  const { title } = store;
  document.title = title ? `${title} - ${extName}` : extName;
});
watch(() => store.route.paths, () => {
  // First time showing the aside we need to tell v-if to keep it forever
  canRenderAside.value = true;
  updateContext();
});
onMounted(() => {
  const disposeList = [
    keyboardService.register('a-pageup', () => switchTab(-1), {
      condition: conditionNotEdit,
    }),
    keyboardService.register('a-pagedown', () => switchTab(1), {
      condition: conditionNotEdit,
    }),
  ];
  keyboardService.enable();
  updateContext();
  return () => {
    disposeList.forEach(dispose => {
      dispose();
    });
    keyboardService.disable();
  };
});
</script>

<style src="../style.css"></style>
