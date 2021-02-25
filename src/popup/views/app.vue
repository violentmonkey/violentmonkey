<template>
  <div
    class="page-popup"
    @click="activeExtras && toggleExtras(null)"
    @contextmenu="activeExtras && (toggleExtras(null), $event.preventDefault())"
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
      <tooltip v-if="injectionScopes[0] && !options.isApplied"
            :content="i18n('labelAutoReloadCurrentTabDisabled')"
            class="reload-hint" align="start" placement="bottom">
        <icon name="info"/>
      </tooltip>
      <span v-text="failureReasonText"/>
      <code v-text="store.blacklisted" v-if="store.blacklisted" class="ellipsis inline-block"/>
    </div>
    <div
      v-for="scope in injectionScopes"
      class="menu menu-scripts"
      :class="{
        expand: activeMenu === scope.name,
        'block-scroll': activeExtras,
      }"
      :data-type="scope.name"
      :key="scope.name">
      <div class="menu-item menu-area menu-group" @click="toggleMenu(scope.name)">
        <div class="flex-auto" v-text="scope.title" :data-totals="scope.totals" />
        <icon name="arrow" class="icon-collapse"></icon>
      </div>
      <div class="submenu">
        <div
          v-for="(item, index) in scope.list"
          :key="index"
          :class="{
            disabled: !item.data.config.enabled,
            failed: item.data.failed,
            removed: item.data.config.removed,
            'extras-shown': activeExtras === item,
            'excludes-shown': item.excludesValue,
          }"
          class="script"
          @mouseenter="message = item.name"
          @mouseleave="message = ''">
          <div
            class="menu-item menu-area"
            @click="onToggleScript(item)">
            <img class="script-icon" :src="item.data.safeIcon">
            <icon :name="getSymbolCheck(item.data.config.enabled)"></icon>
            <div class="script-name flex-auto ellipsis" v-text="item.name"
                 @click.ctrl.exact.stop="onEditScript(item)"
                 @contextmenu.exact.stop="onEditScript(item)"
                 @mousedown.middle.exact.stop="onEditScript(item)" />
          </div>
          <div class="submenu-buttons">
            <!-- Using a standard tooltip that's shown after a delay to avoid nagging the user -->
            <div class="submenu-button" @click="onEditScript(item)"
                 :title="i18n('buttonEditClickHint')">
              <icon name="code"></icon>
            </div>
            <div class="submenu-button" @click.stop="toggleExtras(item, $event)">
              <icon name="more"/>
            </div>
          </div>
          <div v-if="item.excludesValue != null" class="excludes-menu flex flex-col">
            <textarea v-model="item.excludesValue" spellcheck="false"/>
            <div>
              <button v-text="i18n('buttonOK')" @click="onExcludeSave(item)"/>
              <button v-text="i18n('buttonCancel')" @click="item.excludesValue = null"/>
              <!-- not using tooltip to preserve line breaks -->
              <details>
                <summary><icon name="info"/></summary>
                <small>
                  <span v-text="i18n('menuExcludeHint')"/>
                  <ul class="monospace-font mt-1">
                    <li>https://www.foo.com/path/*bar*</li>
                    <li>*://www.foo.com/*</li>
                    <li>*://*.foo.com/*</li>
                  </ul>
                </small>
              </details>
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
    <div v-if="activeExtras" class="extras-menu" ref="extrasMenu">
      <a v-if="activeExtras.home" :href="activeExtras.home" v-text="i18n('buttonHome')"
         rel="noopener noreferrer" target="_blank"/>
      <div v-text="i18n('menuExclude')" @click="onExclude"/>
      <div v-text="activeExtras.data.config.removed ? i18n('buttonRestore') : i18n('buttonRemove')"
           @click="onRemoveScript(activeExtras)"/>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { INJECT_AUTO } from '#/common/consts';
import options from '#/common/options';
import { getLocaleString, i18n, makePause, sendCmd, sendTabCmd } from '#/common';
import { autofitElementsHeight } from '#/common/ui';
import Icon from '#/common/ui/icon';
import { mutex, store } from '../utils';

const SCRIPT_CLS = '.script';

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
            excludesValue: null,
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
    toggleExtras(item, evt) {
      this.activeExtras = this.activeExtras === item ? null : item;
      if (this.activeExtras) {
        item.el = evt.target.closest(SCRIPT_CLS);
        this.$nextTick(() => {
          const { extrasMenu } = this.$refs;
          extrasMenu.style.top = `${
            Math.min(window.innerHeight - extrasMenu.getBoundingClientRect().height,
              evt.currentTarget.getBoundingClientRect().top + 16)
          }px`;
        });
      }
    },
    getSymbolCheck(bool) {
      return `toggle-${bool ? 'on' : 'off'}`;
    },
    onToggle() {
      options.set('isApplied', optionsData.isApplied = !optionsData.isApplied);
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
    onEditScript(item) {
      sendCmd('OpenEditor', item.data.props.id);
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
      window.close();
    },
    onToggleScript(item) {
      const { data } = item;
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
      if (options.get('autoReload')) {
        browser.tabs.reload(store.currentTab.id);
        store.scriptIds.length = 0;
        store.scripts.length = 0;
        store.frameScripts.length = 0;
        mutex.init();
      }
    },
    async onCreateScript() {
      const { currentTab, domain } = this.store;
      const id = domain && await sendCmd('CacheNewScript', {
        url: currentTab.url.split(/[#?]/)[0],
        name: `- ${domain}`,
      });
      sendCmd('OpenEditor', `_new${id ? `/${id}` : ''}`);
      window.close();
    },
    async onInjectionFailureFix() {
      // TODO: promisify options.set, resolve on storage write, await it instead of makePause
      options.set('defaultInjectInto', INJECT_AUTO);
      await makePause(100);
      await browser.tabs.reload();
      window.close();
    },
    onRemoveScript({ data: { config, props: { id } } }) {
      const removed = +!config.removed;
      config.removed = removed;
      sendCmd('MarkRemoved', { id, removed });
    },
    onExclude() {
      const item = this.activeExtras;
      item.excludesValue = [
        ...item.data.custom.excludeMatch || [],
        `${store.currentTab.url.split('#')[0]}*`,
      ].join('\n');
      this.$nextTick(() => {
        // not using $refs because multiple items may show textareas
        const area = item.el.querySelector('textarea');
        autofitElementsHeight([area]);
        area.focus();
      });
    },
    async onExcludeSave(item) {
      await sendCmd('UpdateScriptInfo', {
        id: item.data.props.id,
        custom: {
          excludeMatch: item.excludesValue.split('\n').map(line => line.trim()).filter(Boolean),
        },
      });
      item.excludesValue = null;
      this.checkReload();
    },
  },
  mounted() {
    // close the extras menu on Escape key
    window.addEventListener('keydown', evt => {
      if (this.activeExtras
      && evt.key === 'Escape' && !evt.shiftKey && !evt.ctrlKey && !evt.altKey && !evt.metaKey) {
        evt.preventDefault();
        this.toggleExtras(null);
      }
    });
  },
};
</script>

<style src="../style.css"></style>
