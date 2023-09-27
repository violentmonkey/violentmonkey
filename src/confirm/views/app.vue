<template>
  <div class="page-confirm frame flex flex-col h-screen" :class="{ reinstall }">
    <div class="frame-block">
      <div class="flex">
        <div class="image">
          <img src="/public/images/icon128.png">
        </div>
        <div class="info">
          <h1>
            <div>
              <span v-text="heading"/>
              <span v-text="i18n('msgSameCode')" style="font-weight:normal" v-if="sameCode"/>
            </div>
            <div class="ellipsis" v-text="name"/>
          </h1>
          <div class="flex">
            <tooltip :content="i18n('editNavCode')" class="abs-center" placement="right">
              <icon name="code"/>
            </tooltip>
            <span class="ellipsis" v-text="info.url ? decodeURIComponent(info.url) : '...'"/>
          </div>
          <a v-for="([url, icon, title]) in icons" :key="icon"
             class="flex" target="_blank" :href="url">
            <tooltip :content="title" class="abs-center" placement="right">
              <icon :name="icon"/>
            </tooltip>
            <span class="ellipsis" v-text="decodeURIComponent(url)"/>
          </a>
          <p class="descr" v-text="descr"/>
          <div class="lists flex flex-wrap" :data-collapsed="!listsShown">
            <div class="toggle abs-center" @click="listsShown = !listsShown">
              <tooltip :content="i18n('msgShowHide')" placement="bottom" align="left" v-if="lists">
                <icon name="info"/>
              </tooltip>
            </div>
            <dl v-for="(list, name) in lists" :key="name"
                :data-type="name" :hidden="!list.length" tabindex="0">
              <dt v-text="name ? `@${name}` : i18n('genericError')"/>
              <dd v-text="list" class="ellipsis"/>
            </dl>
          </div>
        </div>
      </div>
      <div class="flex">
        <div class="image flex">
          <img :src="safeIcon">
        </div>
        <div class="actions flex flex-wrap">
          <button
            id="confirm"
            ref="confirm"
            class="mr-1"
            :data-hotkey="hotkey[0]"
            v-text="$main = reinstall ? i18n('reinstall') : i18n('install')"
            v-bind="$bind = {disabled: !installable, onclick: installScript}"/>
          <button id="+close" v-bind="$bind" :data-hotkey="hotkey.close"
                  v-text="`${hotkey.close ? $main + ' +' : '✚'} ${i18n('buttonClose')}`"/>
          <setting-check
              name="closeAfterInstall" ref="close" class="btn-ghost"
              :title="$def = i18n('labelRunAtDefault')"
              :disabled="isLocal && $refs.track?.value"/>
          <button id="+edit" v-text="`✚ ${i18n('buttonEdit')}`" v-bind="$bind" class="mx-1"/>
          <template v-if="isLocal">
            <button id="+track" @click="installScript"
                    :data-hotkey="hotkey.track"
                    :disabled="!tracking && !installable && !installed"
                    v-text="tracking ? i18n('stopTracking') : `✚ ${i18n('trackEdits')}`"/>
            <setting-check
                name="trackLocalFile" ref="track" class="btn-ghost" v-show="!tracking"
                @change="trackLocalFile" :title="$def"/>
            <setting-check name="autoReloadTracked" class="ml-1" v-show="tracking">
              <tooltip :content="i18n('reloadTabTrackHint')">
                {{i18n('reloadTab')}}
              </tooltip>
            </setting-check>
          </template>
          <button v-text="i18n('buttonClose')" @click="close" class="ml-1"/>
          <div v-text="message" v-if="message" :title="error"
               class="status stretch-self flex center-items ml-2"/>
        </div>
      </div>
      <div class="incognito" v-if="info.incognito" v-text="i18n('msgIncognitoChanges')"/>
    </div>
    <div class="frame-block flex-1 pos-rel">
      <vm-externals
        ref="externals"
        v-if="script"
        :value="script"
        class="abs-full"
        :cm-options="cmOptions"
        :commands="commands"
        :install="{ code, deps, url: info.url }"
      />
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip';
import Icon from '@/common/ui/icon';
import {
  getFullUrl, getLocaleString, getScriptHome, i18n, isRemote,
  makePause, makeRaw, request, sendCmdDirectly, trueJoin,
} from '@/common';
import { keyboardService, modifiers } from '@/common/keyboard';
import initCache from '@/common/cache';
import VmExternals from '@/common/ui/externals';
import SettingCheck from '@/common/ui/setting-check';
import { loadScriptIcon } from '@/common/load-script-icon';
import { deepEqual, objectPick } from '@/common/object';
import options from '@/common/options';
import { route } from '@/common/router';
import ua from '@/common/ua';

const KEEP_INFO_DELAY = 5000;
const RETRY_DELAY = 3000;
const RETRY_COUNT = 2;
const MAX_TITLE_NAME_LEN = 100;
const CONFIRM_HOTKEY = `${modifiers.ctrlcmd === 'm' ? '⌘' : 'Ctrl-'}Enter`;
const cache = initCache({ lifetime: RETRY_DELAY * (RETRY_COUNT + 1) });
/** @type {chrome.runtime.Port} */
let filePort;
/** @type {function()} */
let filePortResolve;
/** @type {boolean} */
let filePortNeeded;
let basicTitle;
let cachedCodePromise;
let stopResolve;

export default {
  components: {
    Icon,
    VmExternals,
    SettingCheck,
    Tooltip,
  },
  data() {
    return {
      installable: false,
      installed: false,
      message: '',
      cmOptions: {
        lineWrapping: true,
      },
      code: '',
      commands: {
        close: this.close,
      },
      /** @type {VM.ConfirmCache} */
      info: {},
      deps: {}, // combines `this.require` and `this.resources` = all actually loaded deps
      descr: '',
      error: null,
      heading: i18n('msgLoadingData'),
      lists: null,
      listsShown: true,
      name: '...',
      reinstall: false,
      safeIcon: null,
      sameCode: false,
      script: null,
      tracking: false,
    };
  },
  computed: {
    hotkey() {
      return this.isLocal && this.$refs.track?.value && { track: CONFIRM_HOTKEY }
        || this.$refs.close?.value && { close: CONFIRM_HOTKEY }
        || [CONFIRM_HOTKEY];
    },
    isLocal() {
      return !isRemote(this.info.url);
    },
    icons() {
      const { script } = this;
      const homepageURL = script && getScriptHome(script);
      const supportURL = script?.meta.supportURL;
      return [
        homepageURL && [homepageURL, 'home', i18n('labelHomepage')],
        supportURL && [supportURL, 'question', i18n('buttonSupport')],
      ].filter(Boolean);
    },
  },
  async mounted() {
    const id = route.paths[0];
    const key = `confirm-${id}`;
    const info = await sendCmdDirectly('CacheLoad', key);
    this.info = info;
    if (!info) {
      this.close();
      return;
    }
    /* sendCmdDirectly makes the page load so fast that the local `ua` is still unverified,
       so we use the background `ua` to check for FF68 that disallows file: scheme in fetch() */
    filePortNeeded = info.ff >= 68 && info.url.startsWith('file:');
    cachedCodePromise = sendCmdDirectly('CachePop', info.url);
    this.guard = setInterval(sendCmdDirectly, KEEP_INFO_DELAY, 'CacheHit', { key });
    await this.loadData();
    await this.parseMeta();
    await Promise.all([
      this.checkSameCode(),
      (async () => {
        let retries = RETRY_COUNT;
        while (!await this.loadDeps() && retries) {
          await makePause(RETRY_DELAY);
          retries -= 1;
        }
      })(),
    ]);
    if (this.installable) {
      this.heading = this.reinstall ? i18n('labelReinstall') : i18n('labelInstall');
    }
    this.disposeList = [
      keyboardService.register('ctrlcmd-enter', () => {
        this.$el.querySelector('[data-hotkey]').click();
      }),
    ];
    keyboardService.enable();
  },
  beforeUnmount() {
    if (this.guard) {
      clearInterval(this.guard);
      this.guard = null;
    }
    this.disposeList?.forEach(dispose => dispose());
  },
  methods: {
    async loadData(changedOnly) {
      this.installable = false;
      const code = filePortNeeded
        ? await new Promise(this.pingFilePort)
        : await this.getScript(this.info.url);
      if (code == null || changedOnly && this.code === code) throw 0;
      this.setCode(code);
    },
    setCode(code) {
      const lines = code.split(/\r?\n/);
      const cm = this.$refs.externals?.$refs.code?.cm;
      let i = -1;
      let isDiff;
      if (cm) {
        cm.eachLine(({ text }) => {
          isDiff = text !== lines[i += 1];
          return isDiff;
        });
      }
      this.code = code;
      if (isDiff || cm && i < lines.length - 1) {
        this.$nextTick(() => {
          cm.setCursor(i);
          cm.scrollIntoView(null, cm.display.lastWrapHeight / 3);
        });
      }
    },
    async parseMeta() {
      const res = await sendCmdDirectly('ParseMeta', this.code);
      const { meta, errors } = res;
      const name = getLocaleString(meta, 'name');
      document.title = `${name.slice(0, MAX_TITLE_NAME_LEN)}${name.length > MAX_TITLE_NAME_LEN ? '...' : ''} - ${
        basicTitle || (basicTitle = document.title)
      }`;
      this.name = [name, meta.version]::trueJoin(', ');
      this.descr = getLocaleString(meta, 'description');
      this.lists = objectPick(meta, [
        'antifeature',
        'grant',
        'match',
        'include',
        'exclude',
        'excludeMatch',
        'compatible',
        'connect',
      ], list => (
        list
        ?.map(s => [s.replace(/^\W+/, '') || s, s])
        .sort(([a], [b]) => (a < b ? -1 : a > b))
        .map(([, s]) => s)
        .join('\n')
        || ''
      ));
      this.lists[''] = errors?.join('\n') || '';
      this.script = { meta, custom: {}, props: {} };
      this.allDeps = [
        [...new Set(meta.require)],
        [...new Set(Object.values(meta.resources))],
      ];
      return res;
    },
    async loadDeps() {
      const { script, allDeps: [require, resource] } = this;
      if (!this.safeIcon) {
        loadScriptIcon(script).then(url => { this.safeIcon = url; });
      }
      if (this.require
          && deepEqual(require.slice().sort(), Object.keys(this.require).sort())
          && deepEqual(resource.slice().sort(), Object.keys(this.resources).sort())) {
        return;
      }
      this.require = {};
      this.resources = {};
      const length = require.length + resource.length;
      let finished = 0;
      // All resources may finish quickly so we delay the status to avoid flicker
      const STATUS_DELAY = 500;
      const startTime = performance.now();
      const updateStatus = () => {
        if (performance.now() - startTime > STATUS_DELAY) {
          this.message = i18n('msgLoadingDependency', [finished, length]);
        }
      };
      /** @returns {string|undefined} URL in case of error or `undefined` on success */
      const download = async (url, target, isBlob) => {
        const fullUrl = getFullUrl(url, this.info.url);
        const depsUrl = `${+isBlob}${url}`; // the same URL may be listed in both categories
        try {
          const file = await this.getFile(fullUrl, { isBlob, useCache: true });
          target[fullUrl] = file;
          this.deps[depsUrl] = file;
          finished += 1;
          updateStatus();
        } catch (e) {
          this.deps[depsUrl] = false;
          return url;
        }
      };
      const delayedStatus = setTimeout(updateStatus, STATUS_DELAY);
      const promises = [
        ...require.map(url => download(url, this.require, false)),
        ...resource.map(url => download(url, this.resources, true)),
      ];
      const error = (await Promise.all(promises))::trueJoin('\n');
      clearTimeout(delayedStatus);
      if (error) {
        this.message = i18n('msgErrorLoadingDependency');
        this.error = error;
      } else {
        this.error = null;
        this.installable = true;
        this.message = null;
        return true;
      }
    },
    close() {
      sendCmdDirectly('TabClose');
    },
    async getFile(url, { isBlob, useCache } = {}) {
      const cacheKey = isBlob ? `blob+${url}` : `text+${url}`;
      if (useCache && cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }
      const response = await request(url, {
        [kResponseType]: isBlob ? 'blob' : null,
      });
      const data = isBlob
        ? await makeRaw(response)
        : response.data;
      if (useCache) cache.put(cacheKey, data);
      return data;
    },
    async getScript(url) {
      try {
        return cachedCodePromise && await cachedCodePromise || await this.getFile(url);
      } catch (e) {
        this.message = i18n('msgErrorLoadingData');
        throw url;
      } finally {
        cachedCodePromise = null;
      }
    },
    async installScript(evt, parsedMeta) {
      const btnId = evt?.target.id;
      const isOk = btnId === 'confirm';
      const isBtnTrack = btnId === '+track';
      if (isBtnTrack && this.tracking) {
        stopResolve?.(true);
        return;
      }
      this.installable = false;
      try {
        const { update } = await sendCmdDirectly('ParseScript', {
          ...parsedMeta,
          code: this.code,
          url: this.info.url,
          from: this.info.from,
          require: this.require,
          cache: this.resources,
          reloadTab: options.get('autoReloadTracked'),
        });
        const time = new Date().toLocaleTimeString(['fr']);
        const time0 = this.confirmedTime || (this.confirmedTime = time);
        this.message = `${update.message} ${time0}${time0 === time ? '' : ` --> ${time}`}`;
        this.installed = true;
        if (isOk ? this.isLocal && this.$refs.track.value : isBtnTrack) {
          this.message = i18n('trackEditsNote')
            + (ua.firefox >= 68 ? ' ' + i18n('installOptionTrackTooltip') : '');
          this.trackLocalFile();
        } else if (btnId === '+edit') {
          location.href = extensionOptionsPage + ROUTE_SCRIPTS + '/' + update.props.id;
        } else if (isOk ? this.$refs.close.value : btnId === '+close') {
          this.close();
        }
      } catch (err) {
        this.message = `${err}`;
        this.installable = true;
      }
    },
    async trackLocalFile(evt) {
      if (this.tracking || !this.isLocal || !this.installed) {
        if (evt === false) stopResolve?.(true);
        return;
      }
      cachedCodePromise = null; // always re-read because the file may have changed since then
      this.tracking = true;
      while (this.tracking && !await Promise.race([
        makePause(500),
        new Promise(cb => { stopResolve = cb; }),
      ])) {
        try {
          await this.loadData(true);
          const parsedMeta = await this.parseMeta();
          await this.loadDeps();
          await this.installScript(null, parsedMeta);
          this.sameCode = false;
        } catch (e) { /* NOP */ }
      }
      this.tracking = false;
    },
    async checkSameCode() {
      const { name, namespace } = this.script.meta || {};
      const old = await sendCmdDirectly('GetScript', { meta: { name, namespace } });
      this.reinstall = !!old;
      this.sameCode = old && this.code === await sendCmdDirectly('GetScriptCode', old.props.id);
    },
    createFilePort() {
      filePort = browser.tabs.connect(this.info.tabId, { name: 'FetchSelf' });
      filePort.onMessage.addListener(filePortResolve);
      filePort.onDisconnect.addListener(() => {
        stopResolve?.(true);
        filePort = null;
      });
    },
    pingFilePort(resolve) {
      filePortResolve = resolve;
      if (!filePort) this.createFilePort();
      filePort.postMessage(null);
    },
  },
};
</script>

<style>
$imgSize: 48px;
$imgGapR: 14px;
$infoIconSize: 18px;
// TODO: fix PostCSS calc() which doesn't work here
$vertLayoutThreshold: 1801px;
$vertLayoutThresholdMinus1: 1800px;

.page-confirm {
  --btn-bg: #d4e2d4;
  --btn: darkgreen;
  --btn-border: #75a775;
  --btn-border-hover: #488148;
  h1 {
    line-height: 1.3;
    margin: .25rem 0;
  }
  a:not(:hover) {
    color: unset;
    text-decoration: none;
  }
  p {
    margin-top: 1rem;
  }
  .self-start {
    align-self: flex-start;
  }
  .image {
    flex: 0 0 $imgSize;
    align-items: center;
    justify-content: center;
    height: $imgSize; // reserve the height so it doesn't shift when the icon loads
    padding: 0 $imgGapR 0 .25rem;
    box-sizing: content-box;
    img {
      max-width: 100%;
      max-height: 100%;
    }
  }
  .info {
    overflow: hidden;
    .descr {
      max-height: 4rem;
      overflow-y: auto;
    }
    .abs-center {
      position: absolute;
      margin-left: calc(-1 * $imgSize / 2 - $infoIconSize / 2 - $imgGapR);
      cursor: pointer;
    }
  }
  .icon {
    width: $infoIconSize;
    height: $infoIconSize;
  }
  .lists {
    margin-top: 1rem;
    dl {
      margin: 0 1rem 1rem 0;
      &[data-type="antifeature"] dd {
        border: 1px solid rgba(255, 0, 0, .5);
        background: rgba(255, 0, 0, .05);
        padding: 2px 6px;
        max-width: 25em;
      }
      &[data-type=""] {
        color: red;
      }
    }
    dt {
      font-weight: bold;
    }
    dd {
      white-space: pre-wrap;
      min-width: 5rem;
      max-height: 10vh;
      min-height: 1.5rem;
      overflow-y: auto;
      overflow-wrap: anywhere;
    }
  }
  [data-collapsed="true"] {
    dd {
      display: none;
    }
    @media (max-width: $vertLayoutThresholdMinus1) {
      dl:focus dd {
        display: flex;
        position: absolute;
        max-height: 50vh;
        z-index: 100;
        background: var(--fill-0-5);
        box-shadow: 1px 3px 9px rgba(128, 128, 128, .5);
        padding: .5rem;
      }
    }
    dt {
      cursor: pointer;
    }
    .toggle {
      opacity: .3;
    }
  }
  [data-disabled="true"] {
    opacity: .4
  }
  .actions {
    align-items: center;
    label {
      align-items: center;
    }
    .status {
      border-left: 5px solid darkorange;
      padding: 0 .5em;
      color: #d33a00;
      animation: fade-in .5s 1 both;
    }
    .btn-ghost {
      display: block;
      padding: 0 2px 0 4px;
      cursor: default;
    }
  }
  .incognito {
    padding: .25em 0;
    color: red;
  }
  button[id] {
    background: var(--btn-bg);
    border-color: var(--btn-border);
    color: var(--btn);
    &:hover {
      border-color: var(--btn-border-hover);
    }
  }
  [data-hotkey] {
    font-weight: bold;
    &::after {
      content: " (" attr(data-hotkey) ")";
      opacity: .75;
      font-weight: normal;
    }
  }
  &.reinstall {
    --btn-bg: #d1e0ea;
    --btn-border: #6699ce;
    --btn: #004fc5;
    --btn-border-hover: #35699f;
  }
  @media (prefers-color-scheme: dark) {
    .incognito {
      color: orange;
    }
    &:not(.reinstall) {
      --btn-bg: #3a5d3a;
      --btn-border: #598059;
      --btn: #9cd89c;
      --btn-border-hover: #80a980;
    }
    &.reinstall {
      --btn-bg: #224a73;
      --btn-border: #3d6996;
      --btn: #9fcdfd;
      --btn-border-hover: #608cb8;
    }
    .actions {
      .status {
        color: darkorange;
      }
    }
  }
  .edit-externals .select {
    resize: vertical;
    &[style] {
      max-height: 80%;
    }
  }
  @media (max-width: 1599px) {
    >:first-child {
      min-height: 5em;
      max-height: 80vh;
      width: auto !important; // resetting the inline style attribute if the user resized it
      resize: vertical;
      overflow-y: auto;
    }
  }
  @media (min-width: $vertLayoutThreshold) {
    flex-direction: row;
    >:first-child {
      min-width: 30em;
      max-width: 80%;
      width: 40%;
      height: auto !important; // resetting the inline style attribute if the user resized it
      resize: horizontal;
      overflow: hidden;
    }
    .info .descr {
      max-height: 20vh;
    }
    .lists {
      overflow-y: auto;
      max-height: 75vh;
    }
    .lists dd {
      max-height: 30vh;
      display: block;
    }
    .edit-externals {
      border-top: none;
      border-left: var(--border);
    }
  }
}
.confirm-options {
  label {
    display: block;
  }
  .vl-dropdown-menu {
    width: 13rem;
  }
}
.vl-tooltip-bottom {
  > i {
    margin-left: 10px;
  }
  &.vl-tooltip-align-left {
    margin-left: -13px;
  }
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
