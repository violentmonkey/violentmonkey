<template>
  <div class="page-popup">
    <div class="flex menu-buttons">
      <div class="logo" :class="{disabled:!options.isApplied}">
        <img src="/public/images/icon128.png">
      </div>
      <div
        class="flex-1 ml-1 ext-name"
        :class="{disabled:!options.isApplied}"
        v-text="i18n('extName')"
      />
      <tooltip
        class="menu-area"
        :class="{disabled:!options.isApplied}"
        :content="options.isApplied ? i18n('menuScriptEnabled') : i18n('menuScriptDisabled')"
        placement="bottom"
        align="end"
        @click.native="onToggle">
        <icon :name="getSymbolCheck(options.isApplied)"></icon>
      </tooltip>
      <tooltip
        class="menu-area"
        :content="i18n('menuDashboard')"
        placement="bottom"
        align="end"
        @click.native="onManage">
        <icon name="cog"></icon>
      </tooltip>
      <tooltip
        class="menu-area"
        :content="i18n('menuNewScript')"
        placement="bottom"
        align="end"
        @click.native="onCreateScript">
        <icon name="plus"></icon>
      </tooltip>
    </div>
    <div class="menu" v-show="store.domain">
      <div class="menu-item menu-area" @click="onFindSameDomainScripts">
        <icon name="search"></icon>
        <div class="flex-1" v-text="i18n('menuFindScripts')"></div>
      </div>
    </div>
    <div
      v-show="scripts.length"
      class="menu menu-scripts"
      :class="{expand: activeMenu === 'scripts'}">
      <div class="menu-item menu-area" @click="toggleMenu('scripts')">
        <div class="flex-auto" v-text="i18n('menuMatchedScripts')"></div>
        <icon name="arrow" class="icon-collapse"></icon>
      </div>
      <div class="submenu">
        <div
          v-for="(item, index) in scripts"
          :key="index"
          @mouseenter="message = item.name"
          @mouseleave="message = ''">
          <div
            class="menu-item menu-area"
            :class="{ disabled: !item.data.config.enabled }"
            @click="onToggleScript(item)">
            <icon :name="getSymbolCheck(item.data.config.enabled)"></icon>
            <div class="flex-auto ellipsis" v-text="item.name" />
          </div>
          <div class="submenu-buttons">
            <div class="submenu-button" @click="onEditScript(item)">
              <icon name="code"></icon>
            </div>
          </div>
          <div class="submenu-commands">
            <div
              class="menu-item menu-area"
              v-for="(cap, i) in store.commands[item.data.props.id]"
              :key="i"
              @click="onCommand(item.data.props.id, cap)"
              @mouseenter="message = cap"
              @mouseleave="message = item.name">
              <icon name="command" />
              <div class="flex-auto ellipsis" v-text="cap" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <footer>
      <span @click="onVisitWebsite" v-text="i18n('visitWebsite')" />
    </footer>
    <div class="message" v-if="message">
      <div v-text="message"></div>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import options from '#/common/options';
import { getLocaleString, sendMessage } from '#/common';
import Icon from '#/common/ui/icon';
import { store } from '../utils';

const optionsData = {
  isApplied: options.get('isApplied'),
};
options.hook((changes) => {
  if ('isApplied' in changes) {
    optionsData.isApplied = changes.isApplied;
  }
});

export default {
  components: {
    Icon,
    Tooltip,
  },
  data() {
    return {
      store,
      options: optionsData,
      activeMenu: 'scripts',
      message: null,
    };
  },
  computed: {
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
    onVisitWebsite() {
      browser.tabs.create({
        url: 'https://violentmonkey.github.io/',
      });
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
    onCommand(id, cap) {
      browser.tabs.sendMessage(this.store.currentTab.id, {
        cmd: 'Command',
        data: `${id}:${cap}`,
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
    onCreateScript() {
      const { currentTab, domain } = this.store;
      (domain ? (
        sendMessage({
          cmd: 'CacheNewScript',
          data: {
            url: currentTab.url.split('#')[0].split('?')[0],
          },
        })
      ) : Promise.resolve())
      .then((id) => {
        const path = ['scripts', '_new', id].filter(Boolean).join('/');
        browser.tabs.create({
          url: browser.runtime.getURL(`/options/index.html#${path}`),
        });
        window.close();
      });
    },
  },
};
</script>

<style src="../style.css"></style>
