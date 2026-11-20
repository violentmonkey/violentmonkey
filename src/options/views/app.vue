<template>
  <div class="page-options">
    <aside v-if="canRenderAside" :data-recycled="numbers[TAB_RECYCLE] ? '' : null">
      <header>
        <img src="/public/images/icon128.png">
        <h1 class="hidden-sm" v-text="i18n('extName')"/>
      </header>
      <div class="aside-content">
        <div class="aside-menu-item" v-for="{name, label: [label, short]} in tabs" :key="name" :data-name="name">
          <a
            :href="`#${name}`"
            :class="{active: name === current.name}"
            :data-num-scripts="numbers[name]"
            :data-short="short"
          ><span v-text="label"/></a>
        </div>
      </div>
    </aside>
    <keep-alive>
      <component :is="current.comp" class="tab"/>
    </keep-alive>
    <div v-if="showBanner" ref="$banner" class="setup-banner" role="alert">
      <div>
        <strong v-text="i18n('hintUserScriptsBanner')"/>
        <div v-text="store.error"/>
      </div>
      <button v-text="i18n('buttonOpenExtensionDetails')" @click="openExtensionDetails"/>
      <button v-text="i18n('buttonClose')" @click="bannerClosed = true"/>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { extensionDetailsUrl } from '@/common/browser-scripts-api';
import { i18n, sendCmdDirectly } from '@/common';
import { keyboardService } from '@/common/keyboard';
import { docElem } from '@/common/ui';
import { TAB_RECYCLE } from '@/common/safe-globals'; // explicit import for the template
import { setLocationHash, store } from '../utils';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';

const SHOW_ERROR = __.MV3; // applying conditional compilation to the template
const i18nSettings = i18n('sideMenuSettings');
const tabs = [
  {
    name: SCRIPTS, comp: Installed,
    label: [
      i18n('sideMenuInstalled'),
      i18n('sideMenuScripts'),
    ],
  },
  {
    name: TAB_SETTINGS, comp: Settings,
    label: [
      i18nSettings + ' | ' + i18n('labelBackup'),
      i18nSettings,
    ],
  },
  { name: TAB_ABOUT, comp: About, label: [i18n('sideMenuAbout')] },
  { name: TAB_RECYCLE, comp: Installed, label: [i18n('buttonRecycleBin')] },
];
const extName = i18n('extName');
const conditionNotEdit = '!editScript';

const current = computed(() => {
  const name = store.route.paths[0];
  return tabs.find(tab => tab.name === name) || tabs[0];
});

const $banner = ref();
const bannerClosed = ref(false);
// Hidden in the editor, which fills the whole page
const showBanner = computed(() => SHOW_ERROR && store.error && !bannerClosed.value
  && !(current.value.name === SCRIPTS && store.route.paths[1]));

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
function openExtensionDetails() {
  chrome.tabs.update({ url: extensionDetailsUrl });
}
function switchTab(step) {
  const index = tabs.indexOf(current.value);
  const switchTo = tabs[(index + step + tabs.length) % tabs.length];
  setLocationHash(switchTo?.name || '');
}

if (__.MV3) {
  /* Re-check after the user comes back from chrome://extensions, so the banner
   * disappears as soon as "Allow User Scripts" is turned on. */
  addEventListener('focus', () => store.error && sendCmdDirectly('GetInjectorError')
    .then(err => { store.error = err; }));
  /* --banner-h keeps the aside and the end of each tab above the banner */
  const resizeObserver = new ResizeObserver(([entry]) => {
    docElem.style.setProperty('--banner-h', entry.target.offsetHeight + 'px');
  });
  watch($banner, el => {
    resizeObserver.disconnect();
    if (el) resizeObserver.observe(el);
    else docElem.style.removeProperty('--banner-h');
  });
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
