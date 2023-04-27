<template>
  <div
    class="page-popup flex flex-col"
    @click="activeExtras && toggleExtras(null)"
    @click.capture="onOpenUrl"
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
        v-text="name"
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
      <div class="menu-item menu-area menu-find">
        <template v-for="(url, text, i) in findUrls" :key="url">
          <a target="_blank" :class="{ ellipsis: !i, 'mr-1': !i, 'ml-1': i }"
             :href="url" :data-message="url.split('://')[1]" :tabIndex="tabIndex">
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
      class="menu menu-scripts flex flex-col"
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
      <div class="submenu" ref="scriptList" focusme>
        <div
          v-for="item in scope.list"
          :key="item.id"
          :class="{
            disabled: !item.data.config.enabled,
            failed: item.data.failed,
            removed: item.data.config.removed,
            runs: item.data.runs,
            'extras-shown': activeExtras === item,
            'excludes-shown': item.excludes,
          }"
          class="script">
          <div
            class="menu-item menu-area"
            :tabIndex="tabIndex"
            :data-message="item.name"
            @focus="focusedItem = item"
            @keydown.enter.exact.stop="onEditScript(item)"
            @keydown.space.exact.stop="onToggleScript(item)"
            @click="onToggleScript(item)">
            <img class="script-icon" :src="item.data.safeIcon">
            <icon :name="getSymbolCheck(item.data.config.enabled)"></icon>
            <div class="script-name flex-auto ellipsis"
                 :data-upd="item.upd"
                 @click.ctrl.exact.stop="onEditScript(item)"
                 @contextmenu.exact.stop.prevent="onEditScript(item)"
                 @mousedown.middle.exact.stop="onEditScript(item)">
              <sup class="syntax" v-if="item.data.syntax" v-text="i18n('msgSyntaxError')"/>
              {{item.name}}
            </div>
          </div>
          <div class="submenu-buttons"
               v-show="showButtons(item)">
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
          <div v-if="item.excludes" class="excludes-menu mb-1c mr-1c">
            <button v-for="(val, key) in item.excludes[1]" :key="key"
                    v-text="val" class="ellipsis" :title="`*://${val}/*`"
                    @click="onExcludeSave(item, `*://${val}/*`)"/>
            <input v-model="item.excludes[0]" spellcheck="false"
                   @keypress.enter="onExcludeSave(item)"
                   @keydown.esc.exact.stop.prevent="onExcludeClose(item)"/>
            <!-- Esc interception works in Chrome not in Firefox -->
            <button v-text="i18n('buttonOK')" @click="onExcludeSave(item)"/>
            <button v-text="i18n('buttonCancel')" @click="onExcludeClose(item)"/>
            <!-- not using tooltip to preserve line breaks -->
            <details class="mb-1">
              <summary><icon name="info"/></summary>
              <small>{{i18n('menuExcludeHint')}} {{i18n('labelRelated')}}<a
                v-text="i18n('labelExcludeMatch')" target="_blank"
                href="https://violentmonkey.github.io/api/matching/"/>
              </small>
            </details>
          </div>
          <div class="submenu-commands">
            <div
              class="menu-item menu-area"
              v-for="(cap, i) in store.commands[item.data.props.id]"
              :key="i"
              :tabIndex="tabIndex"
              :CMD.prop="{ id: item.data.props.id, cap }"
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
       v-if="store.currentTab?.incognito"
       v-text="i18n('msgIncognitoChanges')"/>
    <footer>
      <a href="https://violentmonkey.github.io/" target="_blank" :tabIndex="tabIndex" v-text="i18n('visitWebsite')" />
    </footer>
    <div class="message" v-show="message">
      <div v-text="message"></div>
    </div>
    <div v-if="activeExtras" class="extras-menu" ref="extrasMenu">
      <a v-for="[url, text] in activeLinks"
         :key="url" :href="url" :data-message="url" tabindex="0" v-text="text"
         rel="noopener noreferrer" target="_blank"/>
      <div v-text="i18n('menuExclude')" tabindex="0" @click="onExclude"/>
      <div v-text="activeExtras.data.config.removed ? i18n('buttonRestore') : i18n('buttonRemove')"
           tabindex="0"
           @click="onRemoveScript"/>
      <div v-if="!activeExtras.data.config.removed && canUpdate(activeExtras.data)"
           v-text="i18n('buttonUpdate')"
           tabindex="0"
           @click="onUpdateScript"/>
    </div>
  </div>
</template>

<script>
import { reactive } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import options from '@/common/options';
import {
  getScriptHome, getScriptName, getScriptRunAt, getScriptSupportUrl, getScriptUpdateUrl,
  i18n, makePause, sendCmdDirectly, sendTabCmd, trueJoin,
} from '@/common';
import { objectPick } from '@/common/object';
import { focusMe } from '@/common/ui';
import Icon from '@/common/ui/icon';
import { keyboardService, isInput, handleTabNavigation } from '@/common/keyboard';
import { mutex, store } from '../utils';

let mousedownElement;
const NAME = `${extensionManifest.name} ${process.env.VM_VER}`;
const SCRIPT_CLS = '.script';
const RUN_AT_ORDER = ['start', 'body', 'end', 'idle'];
const optionsData = reactive({
  isApplied: options.get('isApplied'),
  filtersPopup: options.get('filtersPopup') || {},
});
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
      focusBug: false,
      message: null,
      focusedItem: null,
      name: NAME,
    };
  },
  computed: {
    activeLinks() {
      const script = this.activeExtras.data;
      const support = getScriptSupportUrl(script);
      const home = !support && getScriptHome(script); // not showing homepage if supportURL exists
      return [
        support && [support, i18n('menuFeedback')],
        home && [home, i18n('buttonHome')],
      ].filter(Boolean);
    },
    injectionScopes() {
      const { sort, enabledFirst, groupRunAt, hideDisabled } = this.options.filtersPopup;
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
        list = list.map(script => {
          const scriptName = getScriptName(script);
          return {
            id: script.props.id,
            name: scriptName,
            data: script,
            key: `${
              enabledFirst && +!script.config.enabled
            }${
              sort === 'alpha'
                ? scriptName.toLowerCase()
                : groupRunAt && RUN_AT_ORDER.indexOf(getScriptRunAt(script))
            }${
              1e6 + script.props.position
            }`,
            excludes: null,
            upd: null,
          };
        }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key));
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
      ]::trueJoin(' ');
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
    canUpdate: getScriptUpdateUrl,
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
      sendCmdDirectly('OpenEditor', '').then(close);
    },
    onOpenUrl(e) {
      const el = e.target.closest('a[href][target=_blank]');
      if (!el) return;
      e.preventDefault();
      sendCmdDirectly('TabOpen', { url: el.href }).then(close);
    },
    onEditScript(item) {
      sendCmdDirectly('OpenEditor', item.data.props.id).then(close);
    },
    onCommand(evt) {
      const { type, currentTarget: el } = evt;
      if (type === 'mousedown') {
        mousedownElement = el;
        evt.preventDefault();
      } else if (type === 'keydown' || mousedownElement === el) {
        sendTabCmd(store.currentTab.id, 'Command', {
          ...el.CMD,
          evt: objectPick(evt, ['type', 'button', 'shiftKey', 'altKey', 'ctrlKey', 'metaKey',
            'key', 'keyCode', 'code']),
        }).then(close);
      }
    },
    onToggleScript(item) {
      const { data } = item;
      const enabled = !data.config.enabled;
      sendCmdDirectly('UpdateScriptInfo', {
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
        store.idMap = {};
        store.scripts.length = 0;
        store.frameScripts.length = 0;
        mutex.init();
      }
    },
    async onCreateScript() {
      sendCmdDirectly('OpenEditor').then(close);
    },
    async onInjectionFailureFix() {
      // TODO: promisify options.set, resolve on storage write, await it instead of makePause
      options.set('defaultInjectInto', AUTO);
      await makePause(100);
      await browser.tabs.reload();
      window.close();
    },
    onRemoveScript() {
      const { config, props: { id } } = this.activeExtras.data;
      const removed = +!config.removed;
      config.removed = removed;
      sendCmdDirectly('MarkRemoved', { id, removed });
    },
    async onUpdateScript() {
      const item = this.activeExtras;
      const chk = i18n('msgCheckingForUpdate');
      if (item.upd !== chk) {
        item.upd = chk;
        item.upd = await sendCmdDirectly('CheckUpdate', item.data.props.id)
          ? i18n('msgUpdated')
          : i18n('msgNoUpdate');
      }
    },
    async onExclude() {
      const item = this.activeExtras;
      const { data } = item;
      const url = data.pageUrl;
      const { host, domain } = await sendCmdDirectly('GetTabDomain', url);
      item.excludes = [
        `${url.split('#')[0]}*`,
        { host, group: `*.${domain}` },
      ];
      await makePause(); // $nextTick runs too early
      item.el.querySelector('input').focus(); // not using $refs as multiple items may show inputs
    },
    onExcludeClose(item) {
      item.excludes = null;
      this.focus(item);
    },
    async onExcludeSave(item, btn) {
      await sendCmdDirectly('UpdateScriptInfo', {
        id: item.data.props.id,
        custom: {
          excludeMatch: [
            ...item.data.custom.excludeMatch || [],
            ...[btn || item.excludes[0].trim()].filter(Boolean),
          ],
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
    showButtons(item) {
      return this.activeExtras?.id === item.id || this.focusedItem?.id === item.id || this.focusBug;
    },
  },
  mounted() {
    focusMe(this.$el);
    keyboardService.enable();
    // innerHeight may be bigger than 600px in a mobile browser which displays the popup as a fullscreen page
    this.$el.style.maxHeight = Math.min(Math.max(600, innerHeight), screen.availHeight - window.screenY - 8) + 'px';
    this.disposeList = [
      keyboardService.register('escape', () => {
        const item = this.activeExtras;
        if (item) {
          this.toggleExtras(null);
          this.focus(item);
        } else if (document.activeElement?.value) {
          document.activeElement.blur();
        } else {
          window.close();
        }
      }),
      ...IS_FIREFOX ? [
        keyboardService.register('tab', () => {
          handleTabNavigation(1);
        }),
        keyboardService.register('s-tab', () => {
          handleTabNavigation(-1);
        }),
      ] : [],
      ...['up', 'down', 'left', 'right'].map(key => (
        keyboardService.register(key,
          this.navigate.bind(this, key[0]),
          { condition: '!inputFocus' })
      )),
      keyboardService.register('e', () => {
        this.onEditScript(this.focusedItem);
      }, {
        condition: '!inputFocus',
      }),
    ];
  },
  activated() {
    // issue #1520: Firefox + Wayland doesn't autofocus the popup so CSS hover doesn't work
    this.focusBug = !document.hasFocus();
  },
  beforeUnmount() {
    keyboardService.disable();
    this.disposeList?.forEach(dispose => { dispose(); });
  },
};
</script>

<style src="../style.css"></style>
