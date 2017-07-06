<template>
  <div class="page-options pos-rel h-100">
    <aside class="h-100">
      <img src="/public/images/icon128.png">
      <h1 v-text="i18n('extName')"></h1>
      <hr>
      <div class=sidemenu>
        <a href="#?t=Installed" :class="{active: tab === 'Installed'}" v-text="i18n('sideMenuInstalled')"></a>
        <a href="#?t=Settings" :class="{active: tab === 'Settings'}" v-feature="'settings'">
          <span v-text="i18n('sideMenuSettings')" class="feature-text"></span>
        </a>
        <a href="#?t=About" :class="{active: tab === 'About'}" v-text="i18n('sideMenuAbout')"></a>
      </div>
    </aside>
    <component :is="tab" class="tab"></component>
  </div>
</template>

<script>
import { store } from '../utils';
import Installed from './tab-installed';
import Settings from './tab-settings';
import About from './tab-about';

const components = {
  Installed,
  Settings,
  About,
};

export default {
  components,
  data() {
    return store;
  },
  computed: {
    tab() {
      let tab = this.route.query.t;
      if (!components[tab]) tab = 'Installed';
      return tab;
    },
  },
};
</script>

<style src="../style.css"></style>
