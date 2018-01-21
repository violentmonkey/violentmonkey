<template>
  <div class="page-options flex h-100">
    <aside>
      <img src="/public/images/icon128.png">
      <h1 v-text="i18n('extName')"></h1>
      <div class="sidemenu">
        <a href="#scripts" :class="{active: tab === 'scripts'}" v-text="i18n('sideMenuInstalled')"></a>
        <feature name="settings" tag="a" href="#settings" :class="{active: tab === 'settings'}">
          <span class="feature-text" v-text="i18n('sideMenuSettings')"></span>
        </feature>
        <a href="#about" :class="{active: tab === 'about'}" v-text="i18n('sideMenuAbout')"></a>
      </div>
    </aside>
    <component :is="getTab()" class="tab flex-auto"></component>
  </div>
</template>

<script>
import { store } from '../utils';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';
import Feature from './feature';

const tabs = {
  scripts: Installed,
  settings: Settings,
  about: About,
};

export default {
  components: {
    Feature,
  },
  data() {
    return store;
  },
  computed: {
    tab() {
      let tab = this.route.paths[0];
      if (!tabs[tab]) tab = 'scripts';
      return tab;
    },
  },
  methods: {
    getTab() {
      return tabs[this.tab];
    },
  },
};
</script>

<style src="../style.css"></style>
