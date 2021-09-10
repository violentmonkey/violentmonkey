<template>
  <div class="page-options flex h-100">
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
            :data-num-scripts="tab.name === 'scripts' && store.installedScripts.length || null"
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
import { i18n } from '#/common';
import Icon from '#/common/ui/icon';
import { keyboardService } from '#/common/keyboard';
import { store } from '../utils';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';

const tabs = [
  { name: 'scripts', comp: Installed, label: i18n('sideMenuInstalled') },
  { name: 'settings', comp: Settings, label: i18n('sideMenuSettings') },
  { name: 'about', comp: About, label: i18n('sideMenuAbout') },
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
      canRenderAside: name !== 'scripts' || (tabFunc !== '_new' && !Number(tabFunc)),
      store,
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
      const isScriptsTab = this.current.name === 'scripts';
      const { paths } = this.store.route;
      keyboardService.setContext('editScript', isScriptsTab && paths[1]);
      keyboardService.setContext('tabScripts', isScriptsTab && !paths[1]);
    },
    switchTab(step) {
      const index = this.tabs.indexOf(this.current);
      const switchTo = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
      window.location.hash = switchTo?.name || '';
    },
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
  beforeDestroy() {
    this.disposeList?.forEach(dispose => {
      dispose();
    });
    keyboardService.disable();
  },
};
</script>

<style src="../style.css"></style>
