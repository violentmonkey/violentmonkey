<template>
  <div class="page-confirm frame flex flex-col h-100">
    <div class="frame-block">
      <div class="flex">
        <div class="image">
          <img src="/public/images/icon128.png">
        </div>
        <div class="info">
          <h1>
            <div v-text="heading"/>
            <div class="ellipsis" v-text="name"/>
          </h1>
          <a class="url ellipsis" v-text="decodedUrl"
             :title="info.url" :href="info.url" @click.prevent />
          <p class="descr" v-text="descr"/>
          <div class="lists flex flex-wrap" :data-collapsed="!listsShown">
            <tooltip :content="i18n('msgShowHide')" placement="top" v-if="lists">
              <div class="toggle" @click="listsShown = !listsShown">
                <icon name="info"/>
              </div>
            </tooltip>
            <dl v-for="(list, name) in lists" :key="name" :hidden="!list.length" tabindex="0">
              <dt v-text="`@${name}`"/>
              <dd v-if="Array.isArray(list)" class="flex flex-col">
                <a v-for="(url, i) in list" :key="name + i" :href="url" v-text="url"
                   rel="noopener noreferrer" target="_blank"/>
              </dd>
              <dd v-else v-text="list" class="ellipsis"/>
            </dl>
          </div>
          <div v-text="message" :title="error"/>
        </div>
      </div>
      <div class="flex">
        <div class="image flex">
          <img :src="safeIcon">
        </div>
        <div class="actions flex flex-wrap">
          <button v-text="i18n('buttonConfirmInstallation')" @click="installScript"
                  :disabled="!installable"/>
          <button v-text="i18n('buttonClose')" @click="close"/>
          <label>
            <setting-check name="closeAfterInstall" @change="checkClose" />
            <span class="ml-1" v-text="i18n('installOptionClose')"/>
          </label>
          <label>
            <setting-check name="trackLocalFile" @change="trackLocalFile"
                           :disabled="closeAfterInstall || !isLocal"/>
            <tooltip :content="trackTooltip" :disabled="!trackTooltip">
              <span class="ml-1" v-text="i18n('installOptionTrack')"/>
            </tooltip>
          </label>
        </div>
      </div>
      <div class="incognito" v-if="info.incognito" v-text="i18n('msgIncognitoChanges')"/>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code class="abs-full" readonly :value="code" :commands="commands" :focus="false" />
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import Icon from '#/common/ui/icon';
import {
  sendCmd, leftpad, request, buffer2string, isRemote, getFullUrl, makePause,
  getLocaleString, trueJoin,
} from '#/common';
import options from '#/common/options';
import initCache from '#/common/cache';
import VmCode from '#/common/ui/code';
import SettingCheck from '#/common/ui/setting-check';
import { loadScriptIcon } from '#/common/load-script-icon';
import { objectPick } from '#/common/object';
import { route } from '#/common/router';
import ua from '#/common/ua';

const cache = initCache({});
/** @type {chrome.runtime.Port} */
let filePort;
/** @type {function()} */
let filePortResolve;
/** @type {boolean} */
let filePortNeeded;

export default {
  components: {
    Icon,
    VmCode,
    SettingCheck,
    Tooltip,
  },
  data() {
    return {
      installable: false,
      installed: false,
      dependencyOK: false,
      closeAfterInstall: options.get('closeAfterInstall'),
      message: '',
      code: '',
      commands: {
        close: this.close,
      },
      info: {},
      decodedUrl: '...',
      descr: '',
      error: null,
      heading: this.i18n('msgLoadingData'),
      lists: null,
      listsShown: true,
      name: '...',
      safeIcon: null,
    };
  },
  computed: {
    trackTooltip() {
      return ua.isFirefox >= 68 ? this.i18n('installOptionTrackTooltip') : null;
    },
    isLocal() {
      return !isRemote(this.info.url);
    },
  },
  async mounted() {
    const id = route.paths[0];
    const key = `confirm-${id}`;
    this.info = await sendCmd('CacheLoad', key);
    if (!this.info) {
      this.close();
      return;
    }
    const { url } = this.info;
    this.decodedUrl = decodeURIComponent(url);
    filePortNeeded = ua.isFirefox >= 68 && url.startsWith('file:');
    this.guard = setInterval(sendCmd, 5000, 'CacheHit', { key });
    await this.loadData();
    await this.parseMeta();
    this.heading = this.i18n('labelInstall');
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
      try {
        /** @type {VMScriptMeta} */
        const script = await sendCmd('ParseMeta', this.code);
        const urls = Object.values(script.resources);
        const length = script.require.length + urls.length;
        this.name = [getLocaleString(script, 'name'), script.version]::trueJoin(', ');
        this.descr = getLocaleString(script, 'description');
        this.lists = objectPick(script, [
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
        this.lists.require = [...new Set(script.require)];
        this.lists.resource = [...new Set(urls)];
        this.meta = script;
        loadScriptIcon(this);
        this.require = {};
        this.resources = {};
        let finished = 0;
        const updateStatus = () => {
          this.message = this.i18n('msgLoadingDependency', [finished, length]);
        };
        /** @returns {string|undefined} URL in case of error or `undefined` on success */
        const download = async (url, target, isBlob) => {
          const fullUrl = getFullUrl(url, this.info.url);
          try {
            target[fullUrl] = await this.getFile(fullUrl, { isBlob, useCache: true });
            finished += 1;
            updateStatus();
          } catch (e) {
            return url;
          }
        };
        updateStatus();
        const promises = [
          ...script.require.map(url => download(url, this.require, false)),
          ...urls.map(url => download(url, this.resources, true)),
        ];
        const error = (await Promise.all(promises))::trueJoin('\n');
        if (error) throw error;
        this.error = null;
        this.dependencyOK = true;
        this.installable = true;
        this.message = null;
      } catch (err) {
        this.message = this.i18n('msgErrorLoadingDependency');
        this.error = err.message || err;
      }
    },
    close() {
      sendCmd('TabClose');
    },
    getFile(url, { isBlob, useCache } = {}) {
      const cacheKey = isBlob ? `blob+${url}` : `text+${url}`;
      if (useCache && cache.has(cacheKey)) {
        return Promise.resolve(cache.get(cacheKey));
      }
      return request(url, {
        responseType: isBlob ? 'arraybuffer' : null,
      })
      .then(({ data }) => (isBlob ? window.btoa(buffer2string(data)) : data))
      .then((data) => {
        if (useCache) cache.put(cacheKey, data);
        return data;
      });
    },
    async getScript(url) {
      try {
        return await sendCmd('CacheLoad', url) || await this.getFile(url);
      } catch (e) {
        this.message = this.i18n('msgErrorLoadingData');
        throw url;
      }
    },
    getTimeString() {
      const now = new Date();
      return `${leftpad(now.getHours(), 2)}:${leftpad(now.getMinutes(), 2)}:${leftpad(now.getSeconds(), 2)}`;
    },
    installScript() {
      this.installable = false;
      return sendCmd('ParseScript', {
        code: this.code,
        url: this.info.url,
        from: this.info.from,
        require: this.require,
        cache: this.resources,
      })
      .then((result) => {
        this.message = `${result.update.message}[${this.getTimeString()}]`;
        if (this.closeAfterInstall) {
          this.close();
        } else {
          this.installed = true;
          this.trackLocalFile();
        }
      }, (err) => {
        this.message = `${err}`;
        this.installable = true;
      });
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
          await this.installScript();
        } catch (e) { /* NOP */ }
      }
      this.tracking = false;
    },
    checkClose(value) {
      this.closeAfterInstall = value;
      if (value) options.set('trackLocalFile', false);
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
  .image {
    flex: 0 0 $imgSize;
    align-items: center;
    justify-content: center;
    min-height: $imgSize; // reserve the height so it doesn't shift when the icon loads
    padding: 0 $imgGapR 0 .25rem;
    box-sizing: content-box;
    img {
      max-width: 100%;
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
      [data-collapsed] & {
      }
      .icon {
        width: $infoIconSize;
        height: $infoIconSize;
      }
    }
  }
  .lists {
    margin-top: 1rem;
    dl {
      margin: 0 1rem 1rem 0;
    }
    dt {
      font-weight: bold;
    }
    dd {
      white-space: pre;
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
    margin: .5rem 0;
    > * {
      margin-right: 1rem;
    }
    > button:first-of-type:not(:disabled) {
      font-weight: bold;
    }
  }
  .incognito {
    padding: .25em 0;
    color: red;
    @media (prefers-color-scheme: dark) {
      color: orange;
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
</style>
