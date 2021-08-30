<template>
  <div
    class="page-popup"
    @click="activeExtras && toggleExtras(null)"
    @contextmenu="activeExtras && (toggleExtras(null), $event.preventDefault())"
    @mouseenter.capture="delegateMouseEnter"
    @mouseleave.capture="delegateMouseLeave"
    @focus.capture="updateMessage"
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
      <span
        class="menu-area"
        :class="{disabled:!options.isApplied}"
        :data-message="options.isApplied ? i18n('menuScriptEnabled') : i18n('menuScriptDisabled')"
        :tabIndex="tabIndex"
        @click="onToggle">
        <icon :name="getSymbolCheck(options.isApplied)"></icon>
      </span>
      <span
        class="menu-area"
        :data-message="i18n('menuDashboard')"
        :tabIndex="tabIndex"
        @click="onManage">
        <icon name="cog"></icon>
      </span>
      <span
        class="menu-area"
        :data-message="i18n('menuNewScript')"
        :tabIndex="tabIndex"
        @click="onCreateScript">
        <icon name="plus"></icon>
      </span>
    </div>
    <div class="menu" v-if="store.injectable" v-show="store.domain">
      <div class="menu-item menu-area menu-find" :tabIndex="tabIndex">
        <template v-for="(url, text, i) in findUrls">
          <a :key="url" target="_blank" :class="{ ellipsis: !i, 'mr-1': !i, 'ml-1': i }"
             :href="url" :data-message="url.split('://')[1]">
            <icon name="search" v-if="!i"/>{{text}}
          </a>
          <template v-if="!i">/</template>
        </template>
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
      <div
        class="menu-item menu-area menu-group"
        :tabIndex="tabIndex"
        @click="toggleMenu(scope.name)">
        <icon name="arrow" class="icon-collapse"></icon>
        <div class="flex-auto" v-text="scope.title" :data-totals="scope.totals" />
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
          class="script">
          <div
            class="menu-item menu-area"
            :tabIndex="tabIndex"
            :data-message="item.name"
            @focus="focusedId = item.id"
            @click="onToggleScript(item)">
            <img class="script-icon" :src="item.data.safeIcon">
            <icon :name="getSymbolCheck(item.data.config.enabled)"></icon>
            <div class="script-name flex-auto ellipsis" v-text="item.name"
                 @click.ctrl.exact.stop="onEditScript(item)"
                 @contextmenu.exact.stop="onEditScript(item)"
                 @mousedown.middle.exact.stop="onEditScript(item)" />
          </div>
          <div class="submenu-buttons" v-show="activeExtras === item || focusedId === item.id">
            <!-- Using a standard tooltip that's shown after a delay to avoid nagging the user -->
            <div class="submenu-button" :tabIndex="tabIndex" @click="onEditScript(item)"
                 :title="i18n('buttonEditClickHint')">
              <icon name="code"></icon>
            </div>
            <div
              class="submenu-button"
              :tabIndex="tabIndex"
              @click.stop="toggleExtras(item, $event)">
              <icon name="more"/>
            </div>
          </div>
          <div v-if="item.excludesValue != null" class="excludes-menu flex flex-col">
            <textarea v-model="item.excludesValue" spellcheck="false"/>
            <div>
              <button v-text="i18n('buttonOK')" @click="onExcludeSave(item)"/>
              <button v-text="i18n('buttonCancel')" @click="onExcludeClose(item)"/>
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
              :tabIndex="tabIndex"
              :data-cmd="`${item.data.props.id}:${cap}`"
              :data-message="cap"
              @mousedown="onCommand"
              @mouseup="onCommand"
              @keydown.enter="onCommand"
              @keydown.space="onCommand">
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
      <a href="https://violentmonkey.github.io/" :tabIndex="tabIndex" @click.prevent="onVisitWebsite" v-text="i18n('visitWebsite')" />
    </footer>
    <div class="message" v-show="message">
      <div v-text="message"></div>
    </div>
    <div v-if="activeExtras" class="extras-menu" ref="extrasMenu">
      <a v-if="activeExtras.home" tabindex="0" :href="activeExtras.home" v-text="i18n('buttonHome')"
         rel="noopener noreferrer" target="_blank"/>
      <div v-text="i18n('menuExclude')" tabindex="0" @click="onExclude"/>
      <div v-text="activeExtras.data.config.removed ? i18n('buttonRestore') : i18n('buttonRemove')"
           tabindex="0"
           @click="onRemoveScript(activeExtras)"/>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { INJECT_AUTO } from '#/common/consts';
import options from '#/common/options';
import { getScriptName, i18n, makePause, sendCmd, sendTabCmd } from '#/common';
import { objectPick } from '#/common/object';
import { autofitElementsHeight } from '#/common/ui';
import Icon from '#/common/ui/icon';
import { keyboardService, isInput } from '#/common/keyboard';
import { mutex, store } from '../utils';

const SCRIPT_CLS = '.script';
let mousedownElement;

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

function compareBy(...keys) {
  return (a, b) => {
    for (const key of keys) {
      const ka = key(a);
      const kb = key(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
    }
    return 0;
  };
}

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
      focusedId: null,
    };
  },
  computed: {
    injectionScopes() {
      const { sort, enabledFirst, hideDisabled } = this.options.filtersPopup;
      const isSorted = sort === 'alpha' || enabledFirst;
      const { injectable } = store;
      const groupDisabled = hideDisabled === 'group';
      return [
        injectable && ['scripts', i18n('menuMatchedScripts'), groupDisabled || null],
        injectable && groupDisabled && ['disabled', i18n('menuMatchedDisabledScripts'), false],
        ['frameScripts', i18n('menuMatchedFrameScripts')],
      ]
      .filter(Boolean)
      .map(([name, title, groupByEnabled]) => {
        let list = store[name] || store.scripts;
        if (groupByEnabled != null) {
          list = list.filter(script => !script.config.enabled === !groupByEnabled);
        }
        const numTotal = list.length;
        const numEnabled = groupByEnabled == null
          ? list.reduce((num, script) => num + script.config.enabled, 0)
          : numTotal;
        if (hideDisabled === 'hide' || hideDisabled === true) {
          list = list.filter(script => script.config.enabled);
        }
        list = list.map((script, i) => {
          const { config, custom, meta } = script;
          const scriptName = getScriptName(script);
          return {
            id: `${name}/${script.props.id}`,
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
    findUrls() {
      const query = encodeURIComponent(store.domain);
      return {
        [`${i18n('menuFindScripts')} (GF)`]: `https://greasyfork.org/scripts/by-site/${query}`,
        OUJS: `https://openuserjs.org/?q=${query}`,
      };
    },
    tabIndex() {
      return this.activeExtras ? -1 : 0;
    },
  },
  methods: {
    toggleMenu(name) {
      this.activeMenu = this.activeMenu === name ? null : name;
    },
    toggleExtras(item, evt) {
      this.activeExtras = this.activeExtras === item ? null : item;
      keyboardService.setContext('activeExtras', this.activeExtras);
      if (this.activeExtras) {
        item.el = evt.target.closest(SCRIPT_CLS);
        this.$nextTick(() => {
          const { extrasMenu } = this.$refs;
          extrasMenu.style.top = `${
            Math.min(window.innerHeight - extrasMenu.getBoundingClientRect().height,
              (evt.currentTarget || evt.target).getBoundingClientRect().top + 16)
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
    onCommand(evt) {
      const { type, currentTarget: el } = evt;
      if (type === 'mousedown') {
        mousedownElement = el;
        evt.preventDefault();
      } else if (type === 'keydown' || mousedownElement === el) {
        sendTabCmd(store.currentTab.id, 'Command', [
          el.dataset.cmd,
          objectPick(evt, ['type', 'button', 'shiftKey', 'altKey', 'ctrlKey', 'metaKey', 'key', 'keyCode', 'code']),
        ]);
        window.close();
      }
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
      sendCmd('OpenEditor');
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
    onExcludeClose(item) {
      item.excludesValue = null;
      this.focus(item);
    },
    async onExcludeSave(item) {
      await sendCmd('UpdateScriptInfo', {
        id: item.data.props.id,
        custom: {
          excludeMatch: item.excludesValue.split('\n').map(line => line.trim()).filter(Boolean),
        },
      });
      this.onExcludeClose(item);
      this.checkReload();
    },
    navigate(dir) {
      const { activeElement } = document;
      const items = Array.from(this.$el.querySelectorAll('[tabindex="0"]'))
      .map(el => ({
        el,
        rect: el.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width && rect.height);
      items.sort(compareBy(item => item.rect.top, item => item.rect.left));
      let index = items.findIndex(({ el }) => el === activeElement);
      const findItemIndex = (step, test) => {
        for (let i = index + step; i >= 0 && i < items.length; i += step) {
          if (test(items[index], items[i])) return i;
        }
      };
      if (index < 0) {
        index = 0;
      } else if (dir === 'u' || dir === 'd') {
        const step = dir === 'u' ? -1 : 1;
        index = findItemIndex(step, (a, b) => (a.rect.top - b.rect.top) * step < 0);
        if (dir === 'u') {
          while (index > 0 && items[index - 1].rect.top === items[index].rect.top) index -= 1;
        }
      } else {
        const step = dir === 'l' ? -1 : 1;
        index = findItemIndex(step, (a, b) => (a.rect.left - b.rect.left) * step < 0);
      }
      items[index]?.el.focus();
    },
    focus(item) {
      item?.el?.querySelector('.menu-area')?.focus();
    },
    delegateMouseEnter(e) {
      const { target } = e;
      if (target.tabIndex >= 0) target.focus();
    },
    delegateMouseLeave(e) {
      const { target } = e;
      if (target === document.activeElement && !isInput(target)) target.blur();
    },
    updateMessage() {
      this.message = document.activeElement?.dataset.message || '';
    },
  },
  mounted() {
    keyboardService.enable();
    this.disposeList = [
      keyboardService.register('escape', () => {
        const item = this.activeExtras;
        this.toggleExtras(null);
        this.focus(item);
      }, {
        condition: 'activeExtras',
      }),
      keyboardService.register('escape', () => {
        const { body, activeElement } = document;
        if (activeElement !== body && body.contains(activeElement)) {
          activeElement.blur();
        } else {
          window.close();
        }
      }, {
        condition: '!activeExtras',
      }),
      keyboardService.register('up', () => {
        this.navigate('u');
      }, {
        condition: '!inputFocus',
      }),
      keyboardService.register('down', () => {
        this.navigate('d');
      }, {
        condition: '!inputFocus',
      }),
      keyboardService.register('left', () => {
        this.navigate('l');
      }, {
        condition: '!inputFocus',
      }),
      keyboardService.register('right', () => {
        this.navigate('r');
      }, {
        condition: '!inputFocus',
      }),
    ];
  },
  beforeDestroy() {
    keyboardService.disable();
    this.disposeList?.forEach(dispose => { dispose(); });
  },
};
</script>

<style src="../style.css"></style>
