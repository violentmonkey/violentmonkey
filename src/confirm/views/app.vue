<template>
  <div class="page-confirm frame flex flex-col h-100">
    <div class="frame-block">
      <div class="flex">
        <h1 class="mt-0 hidden-sm">
          <span v-text="i18n('labelInstall')"></span> - <span v-text="i18n('extName')"></span>
        </h1>
        <div class="flex-auto"></div>
        <div class="text-right">
          <dropdown class="confirm-options" align="right">
            <button slot="toggle" v-text="i18n('buttonInstallOptions')"></button>
            <label>
              <setting-check name="closeAfterInstall" @change="checkClose" />
              <span class="ml-1" v-text="i18n('installOptionClose')"></span>
            </label>
            <label>
              <setting-check name="trackLocalFile" :disabled="closeAfterInstall" />
              <tooltip :content="trackTooltip" :disabled="!trackTooltip">
                <span class="ml-1" v-text="i18n('installOptionTrack')"/>
              </tooltip>
            </label>
          </dropdown>
          <button v-text="i18n('buttonConfirmInstallation')"
          :disabled="!installable" @click="installScript"></button>
          <button v-text="i18n('buttonClose')" @click="close"></button>
          <div class="incognito" v-if="info.incognito" v-text="i18n('msgIncognitoChanges')"/>
        </div>
      </div>
      <div class="flex">
        <div class="ellipsis flex-auto mr-2" :title="info.url" v-text="info.url"></div>
        <div v-text="message"></div>
      </div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code class="abs-full" readonly :value="code" :commands="commands" />
    </div>
  </div>
</template>

<script>
import Dropdown from 'vueleton/lib/dropdown/bundle';
import Tooltip from 'vueleton/lib/tooltip/bundle';
import {
  sendCmd, leftpad, request, buffer2string, isRemote, getFullUrl, makePause,
} from '#/common';
import options from '#/common/options';
import initCache from '#/common/cache';
import VmCode from '#/common/ui/code';
import SettingCheck from '#/common/ui/setting-check';
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
    Dropdown,
    VmCode,
    SettingCheck,
    Tooltip,
  },
  data() {
    return {
      installable: false,
      dependencyOK: false,
      closeAfterInstall: options.get('closeAfterInstall'),
      message: '',
      code: '',
      commands: {
        close: this.close,
      },
      info: {},
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
    this.message = this.i18n('msgLoadingData');
    const id = route.paths[0];
    const key = `confirm-${id}`;
    this.info = await sendCmd('CacheLoad', key);
    if (!this.info) {
      this.close();
      return;
    }
    filePortNeeded = ua.isFirefox >= 68 && this.info?.url.startsWith('file:');
    this.guard = setInterval(sendCmd, 5000, 'CacheHit', { key });
    await this.loadData();
    await this.parseMeta();
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
    parseMeta() {
      return sendCmd('ParseMeta', this.code)
      .then((script) => {
        const urls = Object.keys(script.resources)
        .map(key => script.resources[key]);
        const length = script.require.length + urls.length;
        if (!length) return;
        let finished = 0;
        const error = [];
        const updateStatus = () => {
          this.message = this.i18n('msgLoadingDependency', [finished, length]);
        };
        updateStatus();
        this.require = {};
        this.resources = {};
        const promises = script.require.map((url) => {
          const fullUrl = getFullUrl(url, this.info.url);
          return this.getFile(fullUrl, { useCache: true }).then((res) => {
            this.require[fullUrl] = res;
          });
        })
        .concat(urls.map((url) => {
          const fullUrl = getFullUrl(url, this.info.url);
          return this.getFile(fullUrl, { isBlob: true, useCache: true })
          .then((res) => {
            this.resources[fullUrl] = res;
          });
        }))
        .map(promise => promise.then(() => {
          finished += 1;
          updateStatus();
        }, (url) => {
          error.push(url);
        }));
        return Promise.all(promises).then(() => {
          if (error.length) return Promise.reject(error.join('\n'));
          this.dependencyOK = true;
        });
      })
      .then(() => {
        this.message = this.i18n('msgLoadedData');
        this.installable = true;
      }, (err) => {
        this.message = this.i18n('msgErrorLoadingDependency', [err]);
        return Promise.reject();
      });
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
        if (this.closeAfterInstall) this.close();
        else if (this.isLocal) this.trackLocalFile();
      }, (err) => {
        this.message = `${err}`;
        this.installable = true;
      });
    },
    async trackLocalFile() {
      if (this.tracking) return;
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
      filePort?.disconnect();
      filePort = null;
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
.page-confirm {
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
