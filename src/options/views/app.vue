<template>
  <div class="page-options flex h-screen">
    <aside :class="{ 'show-aside': aside }" v-if="canRenderAside">
      <div class="aside-content">
        <img src="/public/images/icon128.png">
        <h1 class="hidden-sm" v-text="i18n('extName')"/>
        <div class="aside-menu">
          <a
            v-for="tab in tabs"
            :key="tab.name"
            :href="`#${tab.name}`"
            :class="{active: tab === current}"
            :data-num-scripts="tab.name === 'scripts' && installedScripts.length || null"
            v-text="tab.label"
          />
        </div>
      </div>
    </aside>
    <keep-alive>
      <component :is="tabComponent" class="tab flex-auto"/>
    </keep-alive>
  </div>
</template>

<script>
import { i18n } from '@/common';
import { setRoute } from '@/common/router';
import Icon from '@/common/ui/icon';
import { keyboardService } from '@/common/keyboard';
import { store, installedScripts } from '../utils';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';

const SETTINGS = 'settings';
const SCRIPTS = 'scripts';
const ABOUT = 'about';
const tabs = [
  { name: SCRIPTS, comp: Installed, label: i18n('sideMenuInstalled') },
  { name: SETTINGS, comp: Settings, label: i18n('sideMenuSettings') },
  { name: ABOUT, comp: About, label: i18n('sideMenuAbout') },
];
const extName = i18n('extName');
const conditionNotEdit = '!editScript';

export default {
  components: {
    Icon,
  },
  data() {
    const [name, tabFunc] = store.route.paths;
    return {
      tabs,
      aside: false,
      // Speedup and deflicker for initial page load:
      // skip rendering the aside when starting in the editor for a new script.
      canRenderAside: name !== SCRIPTS || (tabFunc !== '_new' && !Number(tabFunc)),
      store,
      installedScripts,
    };
  },
  computed: {
    current() {
      const name = this.store.route.paths[0];
      return tabs.find(tab => tab.name === name) || tabs[0];
    },
    tabComponent() {
      return this.current.comp;
    },
  },
  watch: {
    'store.title'(title) {
      document.title = title ? `${title} - ${extName}` : extName;
    },
    'store.route.paths'() {
      // First time showing the aside we need to tell v-if to keep it forever
      this.canRenderAside = true;
      this.updateContext();
    },
  },
  methods: {
    updateContext() {
      const isScriptsTab = this.current.name === SCRIPTS;
      const { paths } = this.store.route;
      keyboardService.setContext('editScript', isScriptsTab && paths[1]);
      keyboardService.setContext('tabScripts', isScriptsTab && !paths[1]);
    },
    switchTab(step) {
      const index = this.tabs.indexOf(this.current);
      const switchTo = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
      setRoute(switchTo?.name || '');
    },
  },
  created() {
    document.addEventListener('dragover', evt => {
      if (['', ABOUT, SCRIPTS].includes(this.store.route.hash)
      && /^application\/(zip|x-zip-compressed)$/.test(evt.dataTransfer.items[0]?.type)) {
        setRoute(`#${SETTINGS}`);
      }
    });
  },
  mounted() {
    this.disposeList = [
      keyboardService.register('a-pageup', () => this.switchTab(-1), {
        condition: conditionNotEdit,
      }),
      keyboardService.register('a-pagedown', () => this.switchTab(1), {
        condition: conditionNotEdit,
      }),
    ];
    keyboardService.enable();
    this.updateContext();
  },
  beforeUnmount() {
    this.disposeList?.forEach(dispose => {
      dispose();
    });
    keyboardService.disable();
  },
};
</script>

<style src="../style.css"></style>
