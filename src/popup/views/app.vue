<template>
  <div id="app">
    <div class="logo" :class="{disabled:!options.isApplied}">
      <img src="/public/images/icon128.png">
    </div>
    <div class="menu-item" :class="{disabled:!options.isApplied}" @click="onToggle">
      <icon :name="getSymbolCheck(options.isApplied)"></icon>
      <span v-text="options.isApplied ? i18n('menuScriptEnabled') : i18n('menuScriptDisabled')"></span>
    </div>
    <div class="menu">
      <div class="menu-item" @click="onManage">
        <icon name="cog"></icon>
        <span v-text="i18n('menuDashboard')"></span>
      </div>
    </div>
    <div class="menu menu-domains" v-show="domains.length" :class="{collapse:activeMenu!=='domains'}">
      <div class="menu-item" @click="toggleMenu('domains')">
        <icon name="search"></icon>
        <icon name="more" class="icon-right icon-collapse"></icon>
        <span v-text="i18n('menuFindScripts')"></span>
      </div>
      <div class="submenu">
        <div class="menu-item" v-for="item in domains" @click="onFindScripts(item)">
          <span v-text="item.name"></span>
        </div>
      </div>
    </div>
    <div class="menu menu-commands" v-show="commands.length" :class="{collapse:activeMenu!=='commands'}">
      <div class="menu-item" @click="toggleMenu('commands')">
        <icon name="more" class="icon-right icon-collapse"></icon>
        <span v-text="i18n('menuCommands')"></span>
      </div>
      <div class="submenu">
        <div class="menu-item" v-for="item in commands" @click="onCommand(item)">
          <span v-text="item.name"></span>
        </div>
      </div>
    </div>
    <div class="menu menu-scripts" v-show="scripts.length" :class="{collapse:activeMenu!=='scripts'}">
      <div class="menu-item" @click="toggleMenu('scripts')">
        <icon name="more" class="icon-right icon-collapse"></icon>
        <span v-text="i18n('menuMatchedScripts')"></span>
      </div>
      <div class="submenu">
        <div class="menu-item" v-for="item in scripts" @click="onToggleScript(item)" :class="{disabled:!item.data.enabled}">
          <icon :name="getSymbolCheck(item.data.enabled)" class="icon-right"></icon>
          <span v-text="item.name"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import options from 'src/common/options';
import { getLocaleString, sendMessage } from 'src/common';
import Icon from './icon';
import { store } from '../utils';

const optionsData = {
  isApplied: options.get('isApplied'),
};
options.hook(changes => {
  if ('isApplied' in changes) {
    optionsData.isApplied = changes.isApplied;
  }
});

export default {
  components: {
    Icon,
  },
  data() {
    return {
      store,
      options: optionsData,
      activeMenu: 'scripts',
      collapse: {
        domains: true,
        commands: true,
        scripts: false,
      },
    };
  },
  computed: {
    domains() {
      return this.store.domains.map(item => ({
        name: item,
        data: item,
      }));
    },
    commands() {
      return this.store.commands.map(item => ({
        name: item[0],
        data: item,
      }));
    },
    scripts() {
      return this.store.scripts.map(script => ({
        name: script.custom.name || getLocaleString(script.meta, 'name'),
        data: script,
      }));
    },
  },
  methods: {
    toggleMenu(name) {
      this.activeMenu = this.activeMenu === name ? null : name;
    },
    getSymbolCheck(bool) {
      return bool ? 'check' : 'remove';
    },
    onToggle() {
      options.set('isApplied', !this.options.isApplied);
    },
    onManage() {
      const url = browser.runtime.getURL(browser.runtime.getManifest().options_page);
      // Firefox: browser.tabs.query cannot filter tabs by URLs with custom
      // schemes like `moz-extension:`
      browser.tabs.query({
        currentWindow: true,
        // url: url,
      })
      .then(tabs => {
        const optionsTab = tabs.find(tab => {
          const [path, qs] = tab.url.split('#');
          return path === url && (!qs || qs.startsWith('?'));
        });
        if (optionsTab) browser.tabs.update(optionsTab.id, { active: true });
        else browser.tabs.create({ url });
      });
    },
    onFindScripts(item) {
      let domain;
      if (item) {
        domain = item.name;
      } else {
        const matches = this.store.currentTab.url.match(/:\/\/(?:www\.)?([^/]*)/);
        domain = matches[1];
      }
      browser.tabs.create({
        url: `https://greasyfork.org/scripts/search?q=${encodeURIComponent(domain)}`,
      });
    },
    onCommand(item) {
      browser.tabs.sendMessage(this.store.currentTab.id, {
        cmd: 'Command',
        data: item.name,
      });
    },
    onToggleScript(item) {
      sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: item.data.id,
          enabled: !item.data.enabled,
        },
      })
      .then(() => {
        item.data.enabled = !item.data.enabled;
        if (options.get('autoReload')) browser.tabs.reload(this.store.currentTab.id);
      });
    },
  },
};
</script>

<style>
@import '../style.css';
</style>
