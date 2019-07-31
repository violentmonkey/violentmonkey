<template>
  <div class="page-options flex h-100">
    <aside :class="{ 'show-aside': aside }">
      <div v-if="aside" class="aside-backdrop visible-sm" @click="aside = false" />
      <div class="aside-content">
        <img src="/public/images/icon128.png">
        <h1 v-text="i18n('extName')"></h1>
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
        <div class="aside-toggle-wrapper visible-sm" @click="aside = !aside">
          <div class="aside-toggle">
            <icon name="arrow" />
          </div>
        </div>
      </div>
    </aside>
    <component :is="tabComponent" class="tab flex-auto"></component>
  </div>
</template>

<script>
import { i18n } from '#/common';
import Icon from '#/common/ui/icon';
import { store } from '../utils';
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
    return {
      aside: false,
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
  },
};
</script>

<style src="../style.css"></style>
