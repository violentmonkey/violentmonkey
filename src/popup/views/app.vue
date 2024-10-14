<template>
  <div
    class="page-popup flex flex-col"
    @click="extras = topExtras = null"
    @click.capture="onOpenUrl"
    @mouseenter.capture="delegateMouseEnter"
    @mouseleave.capture="delegateMouseLeave"
    @focus.capture="updateMessage"
    :data-is-applied="optionsData.isApplied"
    :style="{'max-height': store.maxHeight}"
    :class="store.failure">
    <div class="flex menu-buttons">
      <div class="logo">
        <img src="/public/images/icon128.png">
      </div>
      <div class="flex-1 ext-name" v-text="NAME" />
      <span
        class="menu-area"
        :data-message="optionsData.isApplied ? i18n('menuScriptEnabled') : i18n('menuScriptDisabled')"
        :tabIndex
        @click="onToggle">
        <icon :name="getSymbolCheck(optionsData.isApplied)"></icon>
      </span>
      <span
        class="menu-area"
        :data-message="i18n('menuDashboard') + '\n' + i18n('popupSettingsHint')"
        :tabIndex
        @contextmenu.prevent="showSettings = !showSettings"
        @auxclick="$event.button !== 2 && onManage($event)"
        @click="onManage">
        <icon name="cog"></icon>
      </span>
      <span
        class="menu-area"
        :data-message="i18n('menuNewScript')"
        :tabIndex
        @click="onCreateScript">
        <icon name="plus"></icon>
      </span>
      <span
        class="menu-area"
        :tabIndex
        :_item.prop="{}"
        @click="showExtras">
        <icon name="more" />
      </span>
    </div>
    <div class="menu" v-if="store.injectable" v-show="store.domain">
      <div class="menu-item menu-area menu-find">
        <template v-for="(url, text, i) in findUrls" :key="url">
          <a target="_blank" :class="{ ellipsis: !i, 'mr-1': !i, 'ml-1': i }"
             :href="url" :data-message="url.split('://')[1]" :tabIndex>
            <icon name="search" v-if="!i"/>{{text}}
          </a>
          <template v-if="!i">/</template>
        </template>
      </div>
    </div>
    <div class="failure-reason" v-if="store.failureText">
      <span v-text="store.failureText"/>
      <code v-text="store.blacklisted" v-if="store.blacklisted" class="ellipsis inline-block"/>
    </div>
    <div v-if="showSettings" class="mb-1c menu settings">
      <settings-popup/>
      <button v-text="i18n('buttonClose')" @click="showSettings = false"/>
    </div>
    <div
      v-for="scope in injectionScopes"
      class="menu menu-scripts flex flex-col"
      :class="{
        expand: activeMenu === scope.name,
        'block-scroll': extras,
      }"
      :data-type="scope.name"
      :key="scope.name">
      <div
        class="menu-item menu-area menu-group"
        :tabIndex
        @click="toggleMenu(scope.name)">
        <icon name="arrow" class="icon-collapse"></icon>
        <div class="flex-auto" v-text="scope.title" :data-totals="scope.totals" />
      </div>
      <div class="submenu">
        <div
          v-for="item in scope.list"
          :key="item.id"
          :class="{
            disabled: !item.data.config.enabled,
            failed: item.data.failed,
            removed: item.data.config.removed,
            runs: item.data.runs,
            'extras-shown': extras === item,
            'excludes-shown': item.excludes,
          }"
          class="script">
          <div
            class="menu-item menu-area"
            :tabIndex
            :data-message="item.name"
            @focus="focusedItem = item"
            @keydown.enter.exact.stop="onEditScript(item)"
            @keydown.space.exact.stop="onToggleScript(item)"
            @click="onToggleScript(item)">
            <img class="script-icon" :src="item.data.safeIcon">
            <icon :name="getSymbolCheck(item.data.config.enabled)"></icon>
            <div class="script-name ellipsis"
                 @click.ctrl.exact.stop="onEditScript(item)"
                 @contextmenu.exact.stop.prevent="onEditScript(item)"
                 @mousedown.middle.exact.stop="onEditScript(item)">
              <sup class="syntax" v-if="item.data.syntax" v-text="i18n('msgSyntaxError')"/>
              {{item.name}}
              <a v-if="!store.failure && item.data.more"
                 class="tardy" tabindex="0" :title="TARDY_MATCH"
                 @click.stop="note = note === TARDY_MATCH ? '' : TARDY_MATCH">
                <Icon name="info"/>
              </a>
            </div>
            <div class="upd ellipsis" :title="item.upd" :data-error="item.updError"/>
          </div>
          <div class="submenu-buttons"
               v-show="showButtons(item)">
            <!-- Using a standard tooltip that's shown after a delay to avoid nagging the user -->
            <div class="submenu-button" :tabIndex @click="onEditScript(item)"
                 :title="i18n('buttonEditClickHint')">
              <icon name="code"></icon>
            </div>
            <div
              class="submenu-button"
              :tabIndex
              :_item.prop="item"
              @click="showExtras">
              <icon name="more"/>
            </div>
          </div>
          <div v-if="item.excludes" class="excludes-menu mb-1c mr-1c">
            <button v-for="(val, key) in item.excludes[1]" :key
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
                :href="VM_DOCS_MATCHING"/>
              </small>
            </details>
          </div>
          <div class="submenu-commands">
            <div
              class="menu-item menu-area"
              v-for="({ autoClose = true, text, title }, key) in store.commands[item.id]"
              :key
              :tabIndex
              :cmd.prop="[item.id, key, autoClose]"
              :data-message="title || text"
              @mousedown="onCommand"
              @mouseup="onCommand"
              @keydown.enter="onCommand"
              @keydown.space="onCommand">
              <icon name="command" />
              <div class="flex-auto ellipsis" v-text="text" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="failure-reason" v-if="note || store.injectionFailure" :class="{note}">
      <div v-text="note || i18n('menuInjectionFailed')"/>
      <a v-text="i18n('menuInjectionFailedFix')" href="#"
         v-if="!note && store.injectionFailure.fixable"
         @click.prevent="onInjectionFailureFix"/>
    </div>
    <div class="incognito"
       v-if="store.tab?.incognito"
       v-text="i18n('msgIncognitoChanges')"/>
    <footer>
      <a v-if="reloadHint" v-text="reloadHint" :tabIndex @click="reloadTab" />
      <a v-else target="_blank" :href="'https://' + HOME" :tabIndex v-text="HOME" />
    </footer>
    <div class="message" v-if="message" v-text="message"/>
    <div v-show="topExtras" ref="$topExtras" class="extras-menu">
      <div v-text="i18n('labelSettings')" @click="onManage(1)" tabindex="0"/>
      <div v-text="i18n('popupSettings')" @click="showSettings = true" tabindex="0"/>
      <div v-text="i18n('updateListedCmd', `${Object.keys(store.updatableScripts).length}`)"
           @click="onUpdateListed" tabindex="0"
           v-if="store.updatableScripts"/>
      <div v-text="i18n('skipScripts')" @click="onSkipTab" tabindex="0"
           v-if="/^(https?|file):/.test(store.tab?.url) /* not reusing `injectable`
           because iframes may run scripts even in non-injectable pages */"/>
    </div>
    <div v-if="extras" ref="$extras" class="extras-menu">
      <a v-for="[url, text] in activeLinks"
         :key="url" :href="url" :data-message="url" tabindex="0" v-text="text"
         v-bind="EXTERNAL_LINK_PROPS"/>
      <div v-text="i18n('menuExclude')" tabindex="0" @click="onExclude"/>
      <div v-text="extras.data.config.removed ? i18n('buttonRestore') : i18n('buttonRemove')"
           tabindex="0"
           @click="onRemoveScript"/>
      <div v-if="'upd' in extras"
           v-text="i18n('buttonUpdate')"
           tabindex="0"
           @click="onUpdateScript"/>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onMounted, reactive, ref } from 'vue';
import { VM_DOCS_MATCHING } from '@/common/consts';
import options from '@/common/options';
import optionsDefaults, {
  kFiltersPopup, kPopupWidth, kUpdateEnabledScriptsOnly,
} from '@/common/options-defaults';
import {
  getScriptHome, getScriptName, getScriptRunAt, getScriptSupportUrl, getScriptUpdateUrl,
  i18n, makePause, sendCmdDirectly, sendTabCmd,
} from '@/common';
import handlers from '@/common/handlers';
import { objectPick } from '@/common/object';
import { EXTERNAL_LINK_PROPS, getActiveElement } from '@/common/ui';
import Icon from '@/common/ui/icon';
import SettingsPopup from '@/common/ui/settings-popup.vue';
import { keyboardService, isInput, handleTabNavigation } from '@/common/keyboard';
import { store } from '../utils';

let mousedownElement;
let focusBug;
const HOME = extensionManifest.homepage_url.split('/')[2];
const NAME = `${extensionManifest.name} ${process.env.VM_VER}`;
const TARDY_MATCH = i18n('msgTardyMatch');
const SCRIPT_CLS = '.script';
const RUN_AT_ORDER = ['start', 'body', 'end', 'idle'];
const needsReload = reactive({});

const $extras = ref();
const $topExtras = ref();
const optionsData = reactive(objectPick(optionsDefaults, [
  IS_APPLIED,
  kFiltersPopup,
  kPopupWidth,
  kUpdateEnabledScriptsOnly,
]));
const activeMenu = ref('scripts');
const showSettings = ref();
const extras = ref();
const focusedItem = ref();
const message = ref();
const note = ref();
const topExtras = ref();

const activeLinks = computed(makeActiveLinks);
const injectionScopes = computed(makeInjectionScopes);
const findUrls = computed(makeFindUrls);
const reloadHint = computed(makeReloadHint);
const tabIndex = computed(() => extras.value ? -1 : 0);

options.hook((changes) => {
  for (const key in optionsData) {
    const v = changes[key];
    if (v != null) {
      optionsData[key] = v && isObject(v)
        ? { ...optionsData[key], ...v }
        : v;
      if (key === kPopupWidth) document.body.style.width = v + 'px';
    }
  }
});
Object.assign(handlers, {
  async UpdateScript({ update: { error, message: msg }, where: { id } } = {}) {
    for (const { list } of injectionScopes.value) {
      for (const item of list) {
        if (item.id === id) {
          item.upd = error || msg;
          item.updError = error;
          return;
        }
      }
    }
  },
});

function compareByCoord({ rect: a }, { rect: b }) {
  return a.top - b.top || a.left - b.left;
}
function reloadTab() {
  return browser.tabs.reload(store.tab.id);
}
function makeActiveLinks() {
  const script = extras.value.data;
  const support = getScriptSupportUrl(script);
  const home = !support && getScriptHome(script); // not showing homepage if supportURL exists
  return [
    support && [support, i18n('menuFeedback')],
    home && [home, i18n('buttonHome')],
  ].filter(Boolean);
}
function makeInjectionScopes() {
  const { sort, enabledFirst, groupRunAt, hideDisabled } = optionsData[kFiltersPopup];
  const { injectable } = store;
  const groupDisabled = hideDisabled === 'group';
  const enabledOnly = optionsData[kUpdateEnabledScriptsOnly];
  let updatableScripts;
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
      const { id } = script.props;
      const { enabled, removed, shouldUpdate } = script.config;
      const upd = !removed && getScriptUpdateUrl(script, { enabledOnly });
      const item = {
        id,
        name: scriptName,
        data: script,
        key: `${
          enabledFirst && +!enabled
        }${
          sort === 'alpha'
            ? scriptName.toLowerCase()
            : groupRunAt && RUN_AT_ORDER.indexOf(getScriptRunAt(script))
        }${
          1e6 + script.props.position
        }`,
        excludes: null,
      };
      if (upd) item.upd = null;
      if (upd && shouldUpdate) {
        if (!updatableScripts) updatableScripts = store.updatableScripts = {};
        updatableScripts[id] = item;
      }
      return item;
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
}
function makeFindUrls() {
  const query = encodeURIComponent(store.domain);
  return {
    [`${i18n('menuFindScripts')} (GF)`]: `https://greasyfork.org/scripts/by-site/${query}`,
    OUJS: `https://openuserjs.org/?q=${query}`,
  };
}
function makeReloadHint() {
  return (
      store.failure === 'scripts-skipped' ||
      IS_APPLIED in store && store[IS_APPLIED] !== optionsData[IS_APPLIED] ||
      Object.values(needsReload).some(Boolean)
  ) && i18n('reloadTab');
}
function toggleMenu(name) {
  activeMenu.value = activeMenu.value === name ? null : name;
}
async function showExtras(evt) {
  const el = evt.currentTarget; // get element with @click, not the inner stuff like icon
  const item = el._item;
  const isPerItem = item.data;
  const what = isPerItem ? extras : topExtras;
  if (!what.value) {
    evt.stopPropagation(); // prevent app's @click from resetting extras and topExtras
    what.value = item;
    item.el = el.closest(SCRIPT_CLS) || el;
    await nextTick();
    const menu = (isPerItem ? $extras : $topExtras).value;
    const top = Math.min(
      innerHeight - menu.getBoundingClientRect().height,
      el.getBoundingClientRect().bottom);
    menu.style.top = `${top}px`;
  }
}
function getSymbolCheck(bool) {
  return `toggle-${bool ? 'on' : 'off'}`;
}
function onSkipTab() {
  sendCmdDirectly(SKIP_SCRIPTS, store.tab);
}
function onToggle() {
  options.set(IS_APPLIED, optionsData[IS_APPLIED] = !optionsData[IS_APPLIED]);
  checkReload();
  updateMessage();
}
/** @param {number | MouseEvent} evt - index of tab to open in src/options/views/app.vue */
function onManage(evt) {
  sendCmdDirectly('OpenDashboard',
    evt === 1 || evt.button === 1 || evt.ctrlKey ? TAB_SETTINGS : '')
  .then(close);
}
function onOpenUrl(e) {
  const el = e.target.closest('a[href][target=_blank]');
  if (!el) return;
  e.preventDefault();
  sendCmdDirectly('TabOpen', { url: el.href }).then(close);
}
function onEditScript(item) {
  sendCmdDirectly('OpenEditor', item.data.props.id).then(close);
}
function onCommand(evt) {
  const { type, currentTarget: el } = evt;
  if (type === 'mousedown') {
    mousedownElement = el;
    evt.preventDefault();
  } else if (type === 'keydown' || mousedownElement === el) {
    const [id, key, autoClose] = el.cmd;
    const idMap = store.idMap;
    const frameId = +Object.keys(idMap).find(frameIdStr => id in idMap[frameIdStr]);
    sendTabCmd(store.tab.id, 'Command', {
      id,
      key,
      evt: objectPick(evt, ['type', 'button', 'shiftKey', 'altKey', 'ctrlKey', 'metaKey',
        'key', 'keyCode', 'code']),
    }, { [kFrameId]: frameId }).then(autoClose && close);
  }
}
function onToggleScript(item) {
  const { data } = item;
  const enabled = !data.config.enabled;
  const { id } = data.props;
  sendCmdDirectly('UpdateScriptInfo', {
    id,
    config: { enabled },
  })
  .then(() => {
    data.config.enabled = enabled;
    if (!checkReload()) needsReload[id] = enabled !== data.runs;
  });
}
function checkReload() {
  if (options.get('autoReload')) {
    return reloadTab();
  }
}
function onCreateScript() {
  sendCmdDirectly('OpenEditor').then(close);
}
async function onInjectionFailureFix() {
  // TODO: promisify options.set, resolve on storage write, await it instead of makePause
  options.set('defaultInjectInto', AUTO);
  await makePause(100);
  await browser.tabs.reload();
  window.close();
}
function onRemoveScript() {
  const { config, props: { id } } = extras.value.data;
  const removed = +!config.removed;
  config.removed = removed;
  sendCmdDirectly('MarkRemoved', { id, removed });
}
function onUpdateScript() {
  sendCmdDirectly('CheckUpdate', extras.value.data.props.id);
}
function onUpdateListed() {
  sendCmdDirectly('CheckUpdate', Object.keys(store.updatableScripts).map(Number));
}
async function onExclude() {
  const item = extras.value;
  const { data } = item;
  const url = data.pageUrl;
  const { host, domain } = await sendCmdDirectly('GetTabDomain', url);
  item.excludes = [
    `${url.split('#')[0]}*`,
    { host, group: `*.${domain}` },
  ];
  await makePause(); // $nextTick runs too early
  item.el.querySelector('input').focus(); // not using $refs as multiple items may show inputs
}
function onExcludeClose(item) {
  item.excludes = null;
  focus(item);
}
async function onExcludeSave(item, btn) {
  await sendCmdDirectly('UpdateScriptInfo', {
    id: item.data.props.id,
    custom: {
      excludeMatch: [
        ...item.data.custom.excludeMatch || [],
        ...[btn || item.excludes[0].trim()].filter(Boolean),
      ],
    },
  });
  onExcludeClose(item);
  checkReload();
}
function navigate(dir) {
  const elems = [];
  for (const el of document.querySelectorAll('[tabindex="0"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.height) {
      el.rect = rect;
      elems.push(el);
    }
  }
  elems.sort(compareByCoord);
  let index = elems.indexOf(getActiveElement());
  let found;
  if (index < 0) {
    index = 0;
  } else {
    const up = dir === 'u';
    const step = up || dir === 'l' ? -1 : 1;
    const key = up || dir === 'd' ? 'top': 'left';
    const cur = elems[index].rect[key];
    for (let i = index + step; i >= 0 && i < elems.length; i += step) {
      if ((cur - elems[i].rect[key]) * step < 0) {
        index = i;
        found = true;
        break;
      }
    }
    if (!found) return;
    if (up) {
      while (index > 0 && elems[index - 1].rect.top === elems[index].rect.top) index -= 1;
    }
  }
  elems[index]?.focus();
}
function focus(item) {
  if (item && (item = item.el)) {
    (item.querySelector('.menu-area') || item).focus();
  }
}
function delegateMouseEnter({ target }) {
  if (target.tabIndex >= 0) target.focus();
  else if (!target.closest('[data-message]')) message.value = '';
}
function delegateMouseLeave({ target }) {
  if (target === getActiveElement() && !isInput(target)) target.blur();
}
function updateMessage() {
  message.value = getActiveElement()?.dataset.message || '';
}
function showButtons(item) {
  return extras.value?.id === item.id || focusedItem.value?.id === item.id || focusBug;
}

onMounted(() => {
  keyboardService.enable();
  keyboardService.register('escape', () => {
    const item = extras.value || topExtras.value;
    if (item) {
      extras.value = topExtras.value = null;
      focus(item);
    } else if (getActiveElement()?.value) {
      getActiveElement().blur();
    } else {
      window.close();
    }
  });
  if (IS_FIREFOX) {
    keyboardService.register('tab', () => handleTabNavigation(1));
    keyboardService.register('s-tab', () => handleTabNavigation(-1));
  }
  for (const key of ['up', 'down', 'left', 'right']) {
    keyboardService.register(key,
      navigate.bind(null, key[0]),
      { condition: '!inputFocus' });
  }
  keyboardService.register('e', () => {
    onEditScript(focusedItem.value);
  }, {
    condition: '!inputFocus',
  });
});

onActivated(() => {
  // issue #1520: Firefox + Wayland doesn't autofocus the popup so CSS hover doesn't work
  focusBug = !document.hasFocus();
});
</script>

<style src="../style.css"></style>
