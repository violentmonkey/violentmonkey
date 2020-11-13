<template>
  <div class="page-options flex h-100">
    <aside :class="{ 'show-aside': aside }" v-if="canRenderAside">
      <div class="aside-content">
        <img src="/public/images/icon128.png">
        <h1 class="hidden-xs" v-text="i18n('extName')"></h1>
        <div class="aside-menu">
          <a
            href="#scripts"
            :class="{active: tab === 'scripts'}"
            v-text="i18n('sideMenuInstalled')"
          />
          <a
            href="#settings"
            :class="{active: tab === 'settings'}"
            v-text="i18n('sideMenuSettings')"
          />
          <a
            href="#about"
            :class="{active: tab === 'about'}"
            v-text="i18n('sideMenuAbout')"
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
import { store } from '../utils';
import * as Hotkeys from '../utils/hotkeys';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';

const tabs = {
  scripts: Installed,
  settings: Settings,
  about: About,
};
const extName = i18n('extName');

export default {
  components: {
    Icon,
  },
  data() {
    const [tab, tabFunc] = store.route.paths;
    return {
      aside: false,
      // Speedup and deflicker for initial page load:
      // skip rendering the aside when starting in the editor for a new script.
      canRenderAside: tab !== 'scripts' || (tabFunc !== '_new' && !Number(tabFunc)),
      store,
    };
  },
  computed: {
    tab() {
      let tab = this.store.route.paths[0];
      if (!tabs[tab]) tab = 'scripts';
      return tab;
    },
    tabComponent() {
      return tabs[this.tab];
    },
  },
  watch: {
    'store.title'(title) {
      document.title = title ? `${title} - ${extName}` : extName;
    },
    'store.route.paths'() {
      Hotkeys.routeChanged();
      // First time showing the aside we need to tell v-if to keep it forever
      this.canRenderAside = true;
    },
  },
};
</script>

<style src="../style.css"></style>
