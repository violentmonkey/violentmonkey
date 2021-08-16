<template>
  <div class="page-confirm frame flex flex-col h-100" :class="{ reinstall }">
    <div class="frame-block">
      <div class="flex">
        <div class="image flex flex-col self-start mb-2c">
          <img src="/public/images/icon128.png">
          <div class="mr-1c">
            <tooltip v-for="([url, icon, title]) in icons" :key="icon"
                     :content="title" placement="bottom" align="left">
              <a target="_blank" :href="url">
                <icon :name="icon"/>
              </a>
            </tooltip>
          </div>
        </div>
        <div class="info">
          <h1>
            <div>
              <span v-text="heading"/>
              <span v-text="i18n('msgSameCode')" style="font-weight:normal" v-if="sameCode"/>
            </div>
            <div class="ellipsis" v-text="name"/>
          </h1>
          <a class="url ellipsis" v-text="decodedUrl"
             :title="info.url" :href="info.url" @click.prevent />
          <p class="descr" v-text="descr"/>
          <div class="lists flex flex-wrap" :data-collapsed="!listsShown">
            <div class="toggle" @click="listsShown = !listsShown">
              <tooltip :content="i18n('msgShowHide')" placement="bottom" align="left" v-if="lists">
                <icon name="info"/>
              </tooltip>
            </div>
            <dl v-for="(list, name) in lists" :key="name"
                :data-type="name" :hidden="!list.length" tabindex="0">
              <dt v-text="`@${name}`"/>
              <dd v-text="list" class="ellipsis"/>
            </dl>
          </div>
        </div>
      </div>
      <div class="flex">
        <div class="image flex">
          <img :src="safeIcon">
        </div>
        <div class="actions flex flex-wrap mr-2c">
          <button
            id="confirm"
            v-text="reinstall
              ? i18n('buttonConfirmReinstallation')
              : i18n('buttonConfirmInstallation')"
            @click="installScript" :disabled="!installable"/>
          <button v-text="i18n('buttonClose')" @click="close"/>
          <div class="flex flex-col my-1">
            <setting-check name="closeAfterInstall" :label="i18n('installOptionClose')"
                           @change="checkClose" />
            <setting-check name="trackLocalFile" @change="trackLocalFile"
                           :disabled="closeAfterInstall || !isLocal">
              <tooltip :content="trackTooltip" :disabled="!trackTooltip">
                <span v-text="i18n('installOptionTrack')"/>
              </tooltip>
            </setting-check>
          </div>
          <div v-text="message" v-if="message" :title="error" class="status"/>
        </div>
      </div>
      <div class="incognito" v-if="info.incognito" v-text="i18n('msgIncognitoChanges')"/>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-externals
        v-if="script"
        v-model="script"
        class="abs-full"
        :cm-options="cmOptions"
        :commands="commands"
        :install="{ code, deps, url: info.url }"
      />
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import Icon from '#/common/ui/icon';
import {
  sendCmdDirectly, request, isRemote, getFullUrl, makePause,
  getLocaleString, trueJoin,
} from '#/common';
import options from '#/common/options';
import initCache from '#/common/cache';
import storage from '#/common/storage';
import VmExternals from '#/common/ui/externals';
import SettingCheck from '#/common/ui/setting-check';
import { loadScriptIcon } from '#/common/load-script-icon';
import { deepEqual, objectPick } from '#/common/object';
import { route } from '#/common/router';
import ua from '#/common/ua';

const KEEP_INFO_DELAY = 5000;
const RETRY_DELAY = 3000;
const RETRY_COUNT = 2;
const cache = initCache({ lifetime: RETRY_DELAY * (RETRY_COUNT + 1) });
/** @type {chrome.runtime.Port} */
let filePort;
/** @type {function()} */
let filePortResolve;
/** @type {boolean} */
let filePortNeeded;

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
      closeAfterInstall: options.get('closeAfterInstall'),
      message: '',
      cmOptions: {
        lineWrapping: true,
      },
      code: '',
      commands: {
        close: this.close,
      },
      info: {},
      decodedUrl: '...',
      deps: {}, // combines `this.require` and `this.resources` = all loaded deps
      descr: '',
      error: null,
      heading: this.i18n('msgLoadingData'),
      lists: null,
      listsShown: true,
      name: '...',
      reinstall: false,
      safeIcon: null,
      sameCode: false,
      script: null,
    };
  },
  computed: {
    trackTooltip() {
      return ua.isFirefox >= 68 ? this.i18n('installOptionTrackTooltip') : null;
    },
    isLocal() {
      return !isRemote(this.info.url);
    },
    icons() {
      const { homepageURL, supportURL } = this.script?.meta || {};
      return [
        homepageURL && [homepageURL, 'home', this.i18n('labelHomepage')],
        supportURL && [supportURL, 'question', this.i18n('buttonSupport')],
      ].filter(Boolean);
    },
  },
  async mounted() {
    const id = route.paths[0];
    const key = `confirm-${id}`;
    this.info = await sendCmdDirectly('CacheLoad', key);
    if (!this.info) {
      this.close();
      return;
    }
    const { url } = this.info;
    this.decodedUrl = decodeURIComponent(url);
    filePortNeeded = ua.isFirefox >= 68 && url.startsWith('file:');
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
      this.heading = this.reinstall ? this.i18n('labelReinstall') : this.i18n('labelInstall');
    }
  },
  beforeDestroy() {
    if (this.guard) {
      clearInterval(this.guard);
      this.guard = null;
    }
  },
  methods: {
    async loadData(changedOnly) {
      this.installable = false;
      const code = filePortNeeded
        ? await new Promise(this.pingFilePort)
        : await this.getScript(this.info.url);
      if (code == null || changedOnly && this.code === code) throw 0;
      this.code = code;
    },
    async parseMeta() {
      /** @type {VMScriptMeta} */
      const meta = await sendCmdDirectly('ParseMeta', this.code);
      this.name = [getLocaleString(meta, 'name'), meta.version]::trueJoin(', ');
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
      this.script = { meta, custom: {}, props: {} };
      this.allDeps = [
        [...new Set(meta.require)],
        [...new Set(Object.values(meta.resources))],
      ];
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
          this.message = this.i18n('msgLoadingDependency', [finished, length]);
        }
      };
      /** @returns {string|undefined} URL in case of error or `undefined` on success */
      const download = async (url, target, isBlob) => {
        const fullUrl = getFullUrl(url, this.info.url);
        try {
          const file = await this.getFile(fullUrl, { isBlob, useCache: true });
          target[fullUrl] = file;
          this.deps[url] = file;
          finished += 1;
          updateStatus();
        } catch (e) {
          this.deps[url] = false;
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
        this.message = this.i18n('msgErrorLoadingDependency');
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
        responseType: isBlob ? 'blob' : null,
      });
      const data = isBlob
        ? await storage.cache.makeRaw(response)
        : response.data;
      if (useCache) cache.put(cacheKey, data);
      return data;
    },
    async getScript(url) {
      try {
        return await sendCmdDirectly('CacheLoad', url) || await this.getFile(url);
      } catch (e) {
        this.message = this.i18n('msgErrorLoadingData');
        throw url;
      }
    },
    async installScript() {
      this.installable = false;
      try {
        const { update } = await sendCmdDirectly('ParseScript', {
          code: this.code,
          url: this.info.url,
          from: this.info.from,
          require: this.require,
          cache: this.resources,
        });
        const time = new Date().toLocaleTimeString(['fr']);
        const time0 = this.confirmedTime || (this.confirmedTime = time);
        this.message = `${update.message} ${time0}${time0 === time ? '' : ` --> ${time}`}`;
        if (this.closeAfterInstall) {
          this.close();
        } else {
          this.installed = true;
          this.trackLocalFile();
        }
      } catch (err) {
        this.message = `${err}`;
        this.installable = true;
      }
    },
    async trackLocalFile() {
      if (this.tracking || !this.isLocal || !this.installed) {
        return;
      }
      this.tracking = true;
      while (options.get('trackLocalFile') && this.tracking !== 'stop') {
        await makePause(500);
        try {
          await this.loadData(true);
          await this.parseMeta();
          await this.loadDeps();
          await this.installScript();
          this.sameCode = false;
        } catch (e) { /* NOP */ }
      }
      this.tracking = false;
    },
    checkClose(value) {
      this.closeAfterInstall = value;
      if (value) options.set('trackLocalFile', false);
    },
    async checkSameCode() {
      const { name, namespace } = this.script.meta || {};
      const old = await sendCmdDirectly('GetScript', { meta: { name, namespace } });
      this.reinstall = !!old;
      this.sameCode = old && this.code === await sendCmdDirectly('GetScriptCode', old.props.id);
    },
    createFilePort() {
      filePort = browser.tabs.connect(this.info.tabId, { name: 'FetchSelf' });
      filePort.onMessage.addListener(code => { filePortResolve(code); });
      filePort.onDisconnect.addListener(() => { this.tracking = 'stop'; });
    },
    pingFilePort(resolve) {
      if (!filePort) this.createFilePort();
      filePortResolve = resolve;
      filePort.postMessage(null);
    },
  },
};
</script>

<style>
$imgSize: 48px;
$imgGapR: 14px;
$infoIconSize: 18px;

.page-confirm {
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
    .toggle {
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
      &[data-type="antifeature"] {
        border: 1px solid rgba(255, 0, 0, .5);
        background: rgba(255, 0, 0, .05);
        margin-top: -3px;
        padding: 2px 6px;
        max-width: 25em;
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
    }
  }
  [data-collapsed] {
    dd {
      display: none;
    }
    dl:focus dd {
      display: flex;
      position: absolute;
      max-height: 50vh;
      z-index: 100;
      background: var(--fill-0-5);
      box-shadow: 1px 3px 9px rgba(128, 128, 128, .5);
      padding: .5rem;
    }
    dt {
      cursor: pointer;
    }
    .toggle {
      opacity: .3;
    }
  }
  .actions {
    align-items: center;
    label {
      align-items: center;
    }
    .status {
      border-left: 5px solid darkorange;
      padding: .5em;
      color: #d33a00;
      animation: fade-in .5s 1 both;
    }
  }
  .incognito {
    padding: .25em 0;
    color: red;
  }
  #confirm {
    font-weight: bold;
    background: #d4e2d4;
    border-color: #75a775;
    color: darkgreen;
    &:hover {
      border-color: #488148;
    }
  }
  &.reinstall #confirm {
    background: #d1e0ea;
    border-color: #6699ce;
    color: #004fc5;
    &:hover {
      border-color: #35699f;
    }
  }
  @media (prefers-color-scheme: dark) {
    .incognito {
      color: orange;
    }
    #confirm {
      background: #3a5d3a;
      border-color: #598059;
      color: #9cd89c;
      &:hover {
        border-color: #80a980;
      }
    }
    &.reinstall #confirm {
      background: #224a73;
      border-color: #3d6996;
      color: #9fcdfd;
      &:hover {
        border-color: #608cb8;
      }
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
