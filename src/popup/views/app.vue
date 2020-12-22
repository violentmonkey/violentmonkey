<template>
  <div
    class="page-popup"
    :data-failure-reason="failureReason">
    <div class="flex menu-buttons">
      <div class="logo" :class="{disabled:!options.isApplied}">
        <img src="/public/images/icon128.png">
      </div>
      <div
        class="flex-1 ext-name"
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
    <div class="menu" v-if="store.injectable" v-show="store.domain">
      <div class="menu-item menu-area menu-find" @click="onFindSameDomainScripts">
        <icon name="search"></icon>
        <div class="flex-1" v-text="i18n('menuFindScripts')"></div>
      </div>
    </div>
    <div class="failure-reason" v-if="failureReasonText">
      <span v-text="failureReasonText"/>
      <code v-text="store.blacklisted" v-if="store.blacklisted" class="ellipsis inline-block"/>
    </div>
    <div
      v-for="scope in injectionScopes"
      class="menu menu-scripts"
      :class="{ expand: activeMenu === scope.name }"
      :data-type="scope.name"
      :key="scope.name">
      <div class="menu-item menu-area menu-group" @click="toggleMenu(scope.name)">
        <div class="flex-auto" v-text="scope.title" :data-totals="scope.totals" />
        <icon name="arrow" class="icon-collapse"></icon>
      </div>
      <div class="submenu">
        <div
          v-for="({ name, data, home }, index) in scope.list"
          class="script"
          :key="index"
          :class="{
            disabled: !data.config.enabled,
            removed: data.config.removed,
            'extras-shown': activeExtras === data,
          }"
          @mouseenter="message = name"
          @mouseleave="message = ''">
          <div
            class="menu-item menu-area"
            @click="onToggleScript(data)">
            <img class="script-icon" :src="data.safeIcon" @error="scriptIconError">
            <icon :name="getSymbolCheck(data.config.enabled)"></icon>
            <div class="script-name flex-auto ellipsis" v-text="name"
                 :class="{failed: data.failed}"
                 @click.ctrl.exact.stop="onEditScript(data)"
                 @contextmenu.exact.stop="onEditScript(data)"
                 @mousedown.middle.exact.stop="onEditScript(data)" />
          </div>
          <div class="submenu-buttons">
            <!-- Using a standard tooltip that's shown after a delay to avoid nagging the user -->
            <div class="submenu-button" @click="onEditScript(data)"
                 :title="i18n('buttonEditClickHint')">
              <icon name="code"></icon>
            </div>
            <div class="submenu-button" @click="onToggleExtras(data, $event)">
              <icon name="more"/>
            </div>
          </div>
          <div class="extras-menu" @click="onToggleExtras(data, $event)">
            <a v-if="home" :href="home" v-text="i18n('buttonHome')"
               rel="noopener noreferrer" target="_blank"/>
            <div v-text="data.config.removed ? i18n('buttonRestore') : i18n('buttonRemove')"
                 @click="onRemoveScript(data)"/>
          </div>
          <div class="submenu-commands">
            <div
              class="menu-item menu-area"
              v-for="(cap, i) in store.commands[data.props.id]"
              :key="i"
              @click="onCommand(data.props.id, cap)"
              @mouseenter="message = cap"
              @mouseleave="message = name">
              <icon name="command" />
              <div class="flex-auto ellipsis" v-text="cap" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="failure-reason" v-if="store.injectionFailure">
      <div v-text="i18n('menuInjectionFailed')"/>
      <a v-text="i18n('menuInjectionFailedFix')" href="#"
         v-if="store.injectionFailure.fixable"
         @click.prevent="onInjectionFailureFix"/>
    </div>
    <div class="incognito"
       v-if="store.currentTab && store.currentTab.incognito"
       v-text="i18n('msgIncognitoChanges')"/>
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
import { INJECT_AUTO } from '#/common/consts';
import options from '#/common/options';
import { getLocaleString, i18n, makePause, sendCmd, sendTabCmd } from '#/common';
import Icon from '#/common/ui/icon';
import { store } from '../utils';

const optionsData = {
  isApplied: options.get('isApplied'),
  filtersPopup: options.get('filtersPopup') || {},
};
options.hook((changes) => {
  if ('isApplied' in changes) {
    optionsData.isApplied = changes.isApplied;
  }
  if ('filtersPopup' in changes) {
    optionsData.filtersPopup = {
      ...optionsData.filtersPopup,
      ...changes.filtersPopup,
    };
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
      activeExtras: null,
      message: null,
    };
  },
  computed: {
    injectionScopes() {
      const { sort, enabledFirst, hideDisabled } = this.options.filtersPopup;
      const isSorted = sort === 'alpha' || enabledFirst;
      return [
        store.injectable && ['scripts', i18n('menuMatchedScripts')],
        ['frameScripts', i18n('menuMatchedFrameScripts')],
      ]
      .filter(Boolean)
      .map(([name, title]) => {
        let list = this.store[name];
        const numTotal = list.length;
        const numEnabled = list.reduce((num, script) => num + script.config.enabled, 0);
        if (hideDisabled) list = list.filter(script => script.config.enabled);
        list = list.map((script, i) => {
          const { config, custom, meta } = script;
          const scriptName = custom.name || getLocaleString(meta, 'name');
          return {
            name: scriptName,
            data: script,
            home: custom.homepageURL || meta.homepageURL || meta.homepage,
            key: isSorted && `${
              enabledFirst && +!config.enabled
            }${
              sort === 'alpha' ? scriptName.toLowerCase() : `${1e6 + i}`.slice(1)
            }`,
          };
        });
        if (isSorted) {
          list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key));
        }
        return numTotal && {
          name,
          title,
          list,
          totals: numEnabled < numTotal
            ? `${numEnabled} / ${numTotal}`
            : `${numTotal}`,
        };
      }).filter(Boolean);
    },
    failureReason() {
      return [
        !store.injectable && 'noninjectable',
        store.blacklisted && 'blacklisted',
        // undefined means the data isn't ready yet
        optionsData.isApplied === false && 'scripts-disabled',
      ].filter(Boolean).join(' ');
    },
    failureReasonText() {
      return (
        !store.injectable && i18n('failureReasonNoninjectable')
        || store.blacklisted && i18n('failureReasonBlacklisted')
        || optionsData.isApplied === false && i18n('menuScriptDisabled')
        || ''
      );
    },
  },
  methods: {
    toggleMenu(name) {
      this.activeMenu = this.activeMenu === name ? null : name;
    },
    getSymbolCheck(bool) {
      return `toggle-${bool ? 'on' : 'off'}`;
    },
    scriptIconError(event) {
      event.target.removeAttribute('src');
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
      sendCmd('TabOpen', {
        url: 'https://violentmonkey.github.io/',
      });
      window.close();
    },
    onEditScript(data) {
      sendCmd('TabOpen', {
        url: `/options/index.html#scripts/${data.props.id}`,
        maybeInWindow: true,
      });
      window.close();
    },
    onFindSameDomainScripts() {
      sendCmd('TabOpen', {
        url: `https://greasyfork.org/scripts/by-site/${encodeURIComponent(this.store.domain)}`,
      });
      window.close();
    },
    onCommand(id, cap) {
      sendTabCmd(store.currentTab.id, 'Command', `${id}:${cap}`);
    },
    onToggleScript(data) {
      const enabled = !data.config.enabled;
      sendCmd('UpdateScriptInfo', {
        id: data.props.id,
        config: { enabled },
      })
      .then(() => {
        data.config.enabled = enabled;
        this.checkReload();
      });
    },
    checkReload() {
      if (options.get('autoReload')) browser.tabs.reload(this.store.currentTab.id);
    },
    async onCreateScript() {
      const { currentTab, domain } = this.store;
      const id = domain && await sendCmd('CacheNewScript', {
        url: currentTab.url.split(/[#?]/)[0],
        name: `- ${domain}`,
      });
      sendCmd('TabOpen', {
        url: `/options/index.html#scripts/_new${id ? `/${id}` : ''}`,
        maybeInWindow: true,
      });
      window.close();
    },
    async onInjectionFailureFix() {
      // TODO: promisify options.set, resolve on storage write, await it instead of makePause
      options.set('defaultInjectInto', INJECT_AUTO);
      await makePause(100);
      await browser.tabs.reload();
      window.close();
    },
    onRemoveScript({ config, props: { id } }) {
      const removed = +!config.removed;
      config.removed = removed;
      sendCmd('MarkRemoved', { id, removed });
    },
    onToggleExtras(data, evt) {
      this.activeExtras = this.activeExtras === data ? null : data;
      if (this.activeExtras) {
        const el = evt.currentTarget;
        const extrasMenu = el.closest('.script').querySelector('.extras-menu');
        const container = el.closest('.submenu');
        this.$nextTick(() => {
          const { top, bottom } = extrasMenu.getBoundingClientRect();
          const spill = top >= 0 && (container.getBoundingClientRect().bottom - bottom);
          if (top < 0 || spill < 0) {
            container.scrollTop += top < 0 ? top : -spill;
          }
        });
      }
    },
  },
};
</script>

<style src="../style.css"></style>
