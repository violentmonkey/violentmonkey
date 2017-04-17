<template>
  <div class="flex flex-col h-100">
    <div class="frame-block">
      <div class="buttons pull-right">
        <div v-dropdown>
          <button dropdown-toggle v-text="i18n('buttonInstallOptions')"></button>
          <div class="dropdown-menu options-panel" @mousedown.stop>
            <label>
              <input type=checkbox v-setting="'closeAfterInstall'" @change="checkClose">
              <span v-text="i18n('installOptionClose')"></span>
            </label>
            <label>
              <input type=checkbox v-setting="'trackLocalFile'" :disabled="settings.closeAfterInstall">
              <span v-text="i18n('installOptionTrack')"></span>
            </label>
          </div>
        </div>
        <button v-text="i18n('buttonConfirmInstallation')"
        :disabled="!installable" @click="installScript"></button>
        <button v-text="i18n('buttonClose')" @click="close"></button>
      </div>
      <h1><span v-text="i18n('labelInstall')"></span> - <span v-text="i18n('extName')"></span></h1>
      <div class="ellipsis confirm-url" :title="info.url" v-text="info.url"></div>
      <div class="ellipsis confirm-msg" v-text="message"></div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code class="abs-full" readonly :content="code" :commands="commands" />
    </div>
  </div>
</template>

<script>
import { sendMessage, zfill, request } from 'src/common';
import options from 'src/common/options';
import initCache from 'src/common/cache';
import VmCode from './code';
import { store } from '../utils';

const cache = initCache({});

const settings = {
  closeAfterInstall: options.get('closeAfterInstall'),
};

options.hook(changes => {
  if ('closeAfterInstall' in changes) {
    settings.closeAfterInstall = changes.closeAfterInstall;
  }
});

export default {
  components: {
    VmCode,
  },
  data() {
    return {
      store,
      settings,
      installable: false,
      dependencyOK: false,
      message: '',
      code: '',
      commands: {
        cancel: this.close,
      },
      info: {},
    };
  },
  computed: {
    query() {
      return this.store.route.query;
    },
    isLocal() {
      return /^file:\/\/\//.test(this.info.url);
    },
  },
  mounted() {
    this.message = this.i18n('msgLoadingData');
    this.loadInfo()
    .then(() => {
      const id = this.store.route.query.id;
      this.guard = setInterval(() => {
        sendMessage({
          cmd: 'CacheHit',
          data: {
            key: `confirm-${id}`,
          },
        });
      }, 5000);
    }, () => {
      this.close();
      return Promise.reject();
    })
    .then(this.loadData)
    .then(this.parseMeta);
  },
  beforeDestroy() {
    if (this.guard) {
      clearInterval(this.guard);
      this.guard = null;
    }
  },
  methods: {
    loadInfo() {
      const id = this.store.route.query.id;
      return sendMessage({
        cmd: 'CacheLoad',
        data: `confirm-${id}`,
      })
      .then(info => {
        if (!info) return Promise.reject();
        this.info = info;
      });
    },
    loadData(changedOnly) {
      this.installable = false;
      const { code: oldCode } = this;
      return this.getScript(this.info.url)
      .then(code => {
        if (changedOnly && oldCode === code) return Promise.reject();
        this.code = code;
      });
    },
    parseMeta() {
      return sendMessage({
        cmd: 'ParseMeta',
        data: this.code,
      })
      .then(script => {
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
        const promises = script.require.map(url => (
          this.getFile(url, { useCache: true }).then(res => {
            this.require[url] = res;
          })
        ))
        .concat(urls.map(url => this.getFile(url, { isBlob: true, useCache: true }).then((res) => {
          this.resources[url] = res;
        })))
        .map(promise => promise.then(() => {
          finished += 1;
          updateStatus();
        }, url => {
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
      }, err => {
        this.message = this.i18n('msgErrorLoadingDependency', [err]);
        return Promise.reject();
      });
    },
    close() {
      window.close();
    },
    getFile(url, { isBlob, useCache } = {}) {
      const cacheKey = isBlob ? `blob+${url}` : `text+${url}`;
      if (useCache && cache.has(cacheKey)) {
        return Promise.resolve(cache.get(cacheKey));
      }
      return request(url, {
        responseType: isBlob ? 'blob' : null,
      })
      .then(({ data }) => {
        if (!isBlob) return data;
        return new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = function onload() {
            resolve(window.btoa(this.result));
          };
          reader.readAsBinaryString(data);
        });
      })
      .then(data => {
        if (useCache) cache.put(cacheKey, data);
        return data;
      });
    },
    getScript(url) {
      return sendMessage({
        cmd: 'CacheLoad',
        data: url,
      })
      .then(text => text || Promise.reject())
      .catch(() => this.getFile(url))
      .catch(() => {
        this.message = this.i18n('msgErrorLoadingData');
        throw url;
      });
    },
    getTimeString() {
      const now = new Date();
      return `${zfill(now.getHours(), 2)}:${zfill(now.getMinutes(), 2)}:${zfill(now.getSeconds(), 2)}`;
    },
    installScript() {
      this.installable = false;
      sendMessage({
        cmd: 'ParseScript',
        data: {
          code: this.code,
          url: this.info.url,
          from: this.info.from,
          require: this.require,
          resources: this.resources,
        },
      })
      .then(res => {
        this.message = `${res.message}[${this.getTimeString()}]`;
        if (res.code < 0) return;
        if (this.closeAfterInstall) this.close();
        else if (this.isLocal && options.get('trackLocalFile')) this.trackLocalFile();
      });
    },
    trackLocalFile() {
      new Promise((resolve) => {
        setTimeout(resolve, 2000);
      })
      .then(() => this.loadData(true))
      .then(this.parseMeta)
      .then(() => {
        const track = options.get('trackLocalFile');
        if (track) this.installScript();
      }, () => {
        this.trackLocalFile();
      });
    },
    checkClose(e) {
      if (e.target.checked) options.set('trackLocalFile', false);
    },
  },
};
</script>
