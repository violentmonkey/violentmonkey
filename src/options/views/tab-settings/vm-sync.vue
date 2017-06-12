<template>
  <section v-feature="'sync'">
    <h3>
      <span class="feature-text" v-text="i18n('labelSync')"></span>
    </h3>
    <div>
      <span v-text="i18n('labelSyncService')"></span>
      <select :value="syncConfig.current" @change="onSyncChange">
        <option v-for="service in syncServices" v-text="service.displayName" :value="service.name"></option>
      </select>
      <button v-text="labelAuthorize" v-if="service.name"
      :disabled="!canAuthorize" @click="onAuthorize"></button>
      <button :disabled="!canSync" v-if="service.name" @click="onSync">
        <svg class="icon"><use xlink:href="#refresh" /></svg>
      </button>
    </div>
    <p class="mt-1" v-text="message"></p>
    <div class="mt-1">
      <label>
        <setting-check name="syncScriptStatus" />
        <span v-text="i18n('labelSyncScriptStatus')"></span>
      </label>
    </div>
  </section>
</template>

<script>
import { sendMessage } from 'src/common';
import options from 'src/common/options';
import { store } from '../../utils';
import SettingCheck from '../setting-check';

const SYNC_CURRENT = 'sync.current';
const syncConfig = {
  current: '',
};
options.hook((data) => {
  if (SYNC_CURRENT in data) {
    syncConfig.current = data[SYNC_CURRENT] || '';
  }
});

export default {
  components: {
    SettingCheck,
  },
  data() {
    return {
      syncConfig,
      store,
    };
  },
  computed: {
    syncServices() {
      let services = [{
        displayName: this.i18n('labelSyncDisabled'),
        name: '',
      }];
      const states = this.store.sync;
      if (states && states.length) {
        services = services.concat(states);
        this.$nextTick(() => {
          // Set `current` after options are ready
          syncConfig.current = options.get(SYNC_CURRENT);
        });
      }
      return services;
    },
    service() {
      const current = this.syncConfig.current || '';
      let service = this.syncServices.find(item => item.name === current);
      if (!service) {
        console.warn('Invalid current service:', current);
        service = this.syncServices[0];
      }
      return service;
    },
    message() {
      const { service } = this;
      if (service.authState === 'initializing') return this.i18n('msgSyncInit');
      if (service.authState === 'error') return this.i18n('msgSyncInitError');
      if (service.syncState === 'error') return this.i18n('msgSyncError');
      if (service.syncState === 'ready') return this.i18n('msgSyncReady');
      if (service.syncState === 'syncing') {
        let progress = '';
        if (service.progress && service.progress.total) {
          progress = ` (${service.progress.finished}/${service.progress.total})`;
        }
        return this.i18n('msgSyncing') + progress;
      }
      if (service.lastSync) {
        const lastSync = new Date(service.lastSync).toLocaleString();
        return this.i18n('lastSync', lastSync);
      }
    },
    labelAuthorize() {
      const { service } = this;
      if (service.authState === 'authorizing') return this.i18n('labelSyncAuthorizing');
      if (service.authState === 'authorized') return this.i18n('labelSyncRevoke');
      return this.i18n('labelSyncAuthorize');
    },
    canAuthorize() {
      const { service } = this;
      return ['unauthorized', 'error', 'authorized'].includes(service.authState)
      && ['idle', 'error'].includes(service.syncState);
    },
    canSync() {
      const { service } = this;
      return this.canAuthorize && service.authState === 'authorized';
    },
  },
  methods: {
    onSyncChange(e) {
      const { value } = e.target;
      options.set(SYNC_CURRENT, value);
    },
    onAuthorize() {
      const { service } = this;
      if (['authorized'].includes(service.authState)) {
        // revoke
        sendMessage({ cmd: 'SyncRevoke' });
      } else if (['unauthorized', 'error'].includes(service.authState)) {
        // authorize
        sendMessage({ cmd: 'SyncAuthorize' });
      }
    },
    onSync() {
      sendMessage({ cmd: 'SyncStart' });
    },
  },
};
</script>
