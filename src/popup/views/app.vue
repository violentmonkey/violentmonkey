<template>
  <div class="page-popup">
    <div class="logo" :class="{disabled:!options.isApplied}">
      <img src="/public/images/icon128.png">
    </div>
    <div class="menu-item" :class="{disabled:!options.isApplied}" @click="onToggle">
      <icon :name="getSymbolCheck(options.isApplied)"></icon>
      <div class="flex-auto" v-text="options.isApplied ? i18n('menuScriptEnabled') : i18n('menuScriptDisabled')"></div>
    </div>
    <div class="menu">
      <div class="menu-item" @click="onManage">
        <icon name="cog"></icon>
        <div class="flex-auto" v-text="i18n('menuDashboard')"></div>
      </div>
    </div>
    <div class="menu" v-show="store.domain">
      <div class="menu-item" @click="onFindSameDomainScripts">
        <icon name="search"></icon>
        <div class="flex-auto" v-text="i18n('menuFindScripts')"></div>
      </div>
    </div>
    <div class="menu menu-commands" v-show="commands.length" :class="{expand: activeMenu === 'commands'}">
      <div class="menu-item" @click="toggleMenu('commands')">
        <div class="flex-auto" v-text="i18n('menuCommands')"></div>
        <icon name="arrow" class="icon-collapse"></icon>
      </div>
      <div class="submenu">
        <div class="menu-item" v-for="item in commands" @click="onCommand(item)">
          <span v-text="item.name"></span>
        </div>
      </div>
    </div>
    <div class="menu menu-scripts" v-show="scripts.length" :class="{expand: activeMenu === 'scripts'}">
      <div class="menu-item" @click="toggleMenu('scripts')">
        <div class="flex-auto" v-text="i18n('menuMatchedScripts')"></div>
        <icon name="arrow" class="icon-collapse"></icon>
      </div>
      <div class="submenu">
        <div v-for="item in scripts">
          <div class="menu-item" @click="onToggleScript(item)" :class="{disabled:!item.data.config.enabled}">
            <icon :name="getSymbolCheck(item.data.config.enabled)"></icon>
            <div class="flex-auto ellipsis" v-text="item.name"></div>
          </div>
          <div class="submenu-buttons">
            <div class="submenu-button" @click="onEditScript(item)">
              <icon name="code"></icon>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import options from 'src/common/options';
import { getLocaleString, sendMessage } from 'src/common';
import Icon from 'src/common/ui/icon';
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
    };
  },
  computed: {
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
      return `toggle-${bool ? 'on' : 'off'}`;
    },
    onToggle() {
      options.set('isApplied', !this.options.isApplied);
      this.checkReload();
    },
    onManage() {
      browser.runtime.openOptionsPage();
      window.close();
    },
    onEditScript(item) {
      browser.tabs.create({
        url: browser.runtime.getURL(`/options/index.html#scripts/${item.data.props.id}`),
      });
      window.close();
    },
    onFindSameDomainScripts() {
      browser.tabs.create({
        url: `https://greasyfork.org/scripts/by-site/${encodeURIComponent(this.store.domain)}`,
      });
    },
    onCommand(item) {
      browser.tabs.sendMessage(this.store.currentTab.id, {
        cmd: 'Command',
        data: item.name,
      });
    },
    onToggleScript(item) {
      const { data } = item;
      const enabled = !data.config.enabled;
      sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: data.props.id,
          config: { enabled },
        },
      })
      .then(() => {
        data.config.enabled = enabled;
        this.checkReload();
      });
    },
    checkReload() {
      if (options.get('autoReload')) browser.tabs.reload(this.store.currentTab.id);
    },
  },
};
</script>

<style src="../style.css"></style>
