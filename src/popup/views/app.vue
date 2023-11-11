<template>
  <div
    class="page-popup flex flex-col"
    @click="extras = topExtras = null"
    @click.capture="onOpenUrl"
    @mouseenter.capture="delegateMouseEnter"
    @mouseleave.capture="delegateMouseLeave"
    @focus.capture="updateMessage"
    :data-is-applied="options.isApplied"
    :class="store.failure">
    <div class="flex menu-buttons">
      <div class="logo">
        <img src="/public/images/icon128.png">
      </div>
      <div class="flex-1 ext-name" v-text="name" />
      <span
        class="menu-area"
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
      <span
        class="menu-area"
        :tabIndex="tabIndex"
        :_item.prop="{}"
        @click="showExtras">
        <icon name="more" />
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
    <div class="failure-reason" v-if="store.failureText">
      <span v-text="store.failureText"/>
      <code v-text="store.blacklisted" v-if="store.blacklisted" class="ellipsis inline-block"/>
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
            'extras-shown': extras === item,
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
                 @click.ctrl.exact.stop="onEditScript(item)"
                 @contextmenu.exact.stop.prevent="onEditScript(item)"
                 @mousedown.middle.exact.stop="onEditScript(item)">
              <sup class="syntax" v-if="item.data.syntax" v-text="i18n('msgSyntaxError')"/>
              {{item.name}}
            </div>
            <div class="upd ellipsis" :title="item.upd" :data-error="item.updError"/>
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
              :_item.prop="item"
              @click="showExtras">
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
              v-for="({ autoClose = true, text, title }, key) in store.commands[item.id]"
              :key="key"
              :tabIndex="tabIndex"
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
    <div class="failure-reason" v-if="store.injectionFailure">
      <div v-text="i18n('menuInjectionFailed')"/>
      <a v-text="i18n('menuInjectionFailedFix')" href="#"
         v-if="store.injectionFailure.fixable"
         @click.prevent="onInjectionFailureFix"/>
    </div>
    <div class="incognito"
       v-if="store.tab?.incognito"
       v-text="i18n('msgIncognitoChanges')"/>
    <footer>
      <a v-if="reloadHint" v-text="reloadHint" :tabIndex="tabIndex" @click="reloadTab" />
      <a v-else target="_blank" :href="'https://' + home" :tabIndex="tabIndex" v-text="home" />
    </footer>
    <div class="message" v-show="message">
      <div v-text="message"></div>
    </div>
    <div v-show="topExtras" ref="topExtras" class="extras-menu">
      <div v-text="i18n('labelSettings')" @click="onManage(1)" tabindex="0"/>
      <div v-text="i18n('updateListedCmd', `${Object.keys(store.updatableScripts).length}`)"
           @click="onUpdateListed" tabindex="0"
           v-if="store.updatableScripts"/>
      <div v-text="i18n('skipScripts')" @click="onSkipTab" tabindex="0"
           v-if="/^(https?|file):/.test(store.tab?.url) /* not reusing `injectable`
           because iframes may run scripts even in non-injectable pages */"/>
    </div>
    <div v-if="extras" ref="extras" class="extras-menu">
      <a v-for="[url, text] in activeLinks"
         :key="url" :href="url" :data-message="url" tabindex="0" v-text="text"
         rel="noopener noreferrer" target="_blank"/>
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

<script>
import { reactive } from 'vue';
import options from '@/common/options';
import {
  getScriptHome, getScriptName, getScriptRunAt, getScriptSupportUrl, getScriptUpdateUrl,
  i18n, makePause, sendCmdDirectly, sendTabCmd,
} from '@/common';
import handlers from '@/common/handlers';
import { objectPick } from '@/common/object';
import { focusMe } from '@/common/ui';
import Icon from '@/common/ui/icon';
import { keyboardService, isInput, handleTabNavigation } from '@/common/keyboard';
import { store } from '../utils';

let injectionScopes;
let mousedownElement;
const NAME = `${extensionManifest.name} ${process.env.VM_VER}`;
const SCRIPT_CLS = '.script';
const RUN_AT_ORDER = ['start', 'body', 'end', 'idle'];
const kFiltersPopup = 'filtersPopup';
const kUpdateEnabledScriptsOnly = 'updateEnabledScriptsOnly';
const optionsData = reactive({
  [IS_APPLIED]: true,
  [kFiltersPopup]: {},
  [kUpdateEnabledScriptsOnly]: true,
});
options.hook((changes) => {
  for (const key in optionsData) {
    const v = changes[key];
    if (v != null) {
      optionsData[key] = v && isObject(v)
          ? { ...optionsData[key], ...v }
          : v;
    }
  }
});
Object.assign(handlers, {
  async UpdateScript({ update: { error, message }, where: { id } } = {}) {
    for (const { list } of injectionScopes) {
      for (const item of list) {
        if (item.id === id) {
          item.upd = error || message;
          item.updError = error;
          return;
        }
      }
    }
  },
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

function reloadTab() {
  return browser.tabs.reload(store.tab.id);
}

export default {
  components: {
    Icon,
  },
  data() {
    return {
      store,
      home: extensionManifest.homepage_url.split('/')[2],
      options: optionsData,
      activeMenu: 'scripts',
      extras: null,
      focusBug: false,
      focusedItem: null,
      message: null,
      name: NAME,
      needsReload: {},
      topExtras: null,
    };
  },
  computed: {
    activeLinks() {
      const script = this.extras.data;
      const support = getScriptSupportUrl(script);
      const home = !support && getScriptHome(script); // not showing homepage if supportURL exists
      return [
        support && [support, i18n('menuFeedback')],
        home && [home, i18n('buttonHome')],
      ].filter(Boolean);
    },
    injectionScopes() {
      const { sort, enabledFirst, groupRunAt, hideDisabled } = this.options[kFiltersPopup];
      const { injectable } = store;
      const groupDisabled = hideDisabled === 'group';
      const enabledOnly = optionsData[kUpdateEnabledScriptsOnly];
      let updatableScripts;
      injectionScopes = [
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
      return injectionScopes;
    },
    findUrls() {
      const query = encodeURIComponent(store.domain);
      return {
        [`${i18n('menuFindScripts')} (GF)`]: `https://greasyfork.org/scripts/by-site/${query}`,
        OUJS: `https://openuserjs.org/?q=${query}`,
      };
    },
    reloadHint() {
      return (
        store.failure === 'scripts-skipped' ||
        IS_APPLIED in store && store[IS_APPLIED] !== optionsData[IS_APPLIED] ||
        Object.values(this.needsReload).some(Boolean)
      ) && i18n('reloadTab');
    },
    tabIndex() {
      return this.extras ? -1 : 0;
    },
  },
  methods: {
    toggleMenu(name) {
      this.activeMenu = this.activeMenu === name ? null : name;
    },
    async showExtras(evt) {
      const el = evt.currentTarget; // get element with @click, not the inner stuff like icon
      const item = el._item;
      const key = item.data ? 'extras' : 'topExtras';
      if (!this[key]) {
        evt.stopPropagation(); // prevent app's @click from resetting extras and topExtras
        this[key] = item;
        item.el = el.closest(SCRIPT_CLS) || el;
        await this.$nextTick();
        const menu = this.$refs[key];
        const top = Math.min(
          innerHeight - menu.getBoundingClientRect().height,
          el.getBoundingClientRect().bottom);
        menu.style.top = `${top}px`;
      }
    },
    getSymbolCheck(bool) {
      return `toggle-${bool ? 'on' : 'off'}`;
    },
    onSkipTab() {
      sendCmdDirectly(SKIP_SCRIPTS, store.tab);
    },
    onToggle() {
      options.set(IS_APPLIED, optionsData[IS_APPLIED] = !optionsData[IS_APPLIED]);
      this.checkReload();
      this.updateMessage();
    },
    /** @param {number | Event} evt - index of tab to open in src/options/views/app.vue */
    onManage(evt) {
      sendCmdDirectly('OpenDashboard', evt === 1 ? TAB_SETTINGS : '').then(close);
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
        const [id, key, autoClose] = el.cmd;
        sendTabCmd(store.tab.id, 'Command', {
          id,
          key,
          evt: objectPick(evt, ['type', 'button', 'shiftKey', 'altKey', 'ctrlKey', 'metaKey',
            'key', 'keyCode', 'code']),
        }).then(autoClose && close);
      }
    },
    onToggleScript(item) {
      const { data } = item;
      const enabled = !data.config.enabled;
      const { id } = data.props;
      sendCmdDirectly('UpdateScriptInfo', {
        id,
        config: { enabled },
      })
      .then(() => {
        data.config.enabled = enabled;
        if (!this.checkReload()) this.needsReload[id] = enabled !== data.runs;
      });
    },
    checkReload() {
      if (options.get('autoReload')) {
        return reloadTab();
      }
    },
    reloadTab,
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
      const { config, props: { id } } = this.extras.data;
      const removed = +!config.removed;
      config.removed = removed;
      sendCmdDirectly('MarkRemoved', { id, removed });
    },
    onUpdateScript() {
      sendCmdDirectly('CheckUpdate', this.extras.data.props.id);
    },
    onUpdateListed() {
      sendCmdDirectly('CheckUpdate', Object.keys(store.updatableScripts).map(Number));
    },
    async onExclude() {
      const item = this.extras;
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
      const items = this.$el.querySelectorAll('[tabindex="0"]')
      ::[].map(el => ({
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
      if (item && (item = item.el)) {
        (item.querySelector('.menu-area') || item).focus();
      }
    },
    delegateMouseEnter(e) {
      const { target } = e;
      if (target.tabIndex >= 0) target.focus();
      else if (!target.closest('[data-message]')) this.message = '';
    },
    delegateMouseLeave(e) {
      const { target } = e;
      if (target === document.activeElement && !isInput(target)) target.blur();
    },
    updateMessage() {
      this.message = document.activeElement?.dataset.message || '';
    },
    showButtons(item) {
      return this.extras?.id === item.id || this.focusedItem?.id === item.id || this.focusBug;
    },
  },
  mounted() {
    focusMe(this.$el);
    keyboardService.enable();

    // from https://stackoverflow.com/a/11381730
    function mobileCheck() {
      let check = false;
      (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
      return check;
    }; 
    this.$el.style.maxHeight = Math.min(
      // innerHeight may exceed 600px in a mobile browser which displays the popup as a fullscreen page
      // on desktop browsers a global zoom > 100% cause multiple scrollbars
      mobileCheck() ? Math.max(600, innerHeight) : Math.min(600, innerHeight),
      screen.availHeight - screenY - 8
    ) + 'px';
    this.disposeList = [
      keyboardService.register('escape', () => {
        const item = this.extras || this.topExtras;
        if (item) {
          this.extras = this.topExtras = null;
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
