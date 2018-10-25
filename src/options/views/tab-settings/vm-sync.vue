<template>
  <section>
    <h3 v-text="i18n('labelSync')"></h3>
    <div v-if="state">
      <span v-text="i18n('labelSyncService')"></span>
      <select class="mx-1" :value="syncConfig.current" @change="onSyncChange">
        <option v-for="service in syncServices" v-text="service.displayName" :value="service.name"></option>
      </select>
      <button v-text="state.label" v-if="service.name"
      :disabled="!state.canAuthorize" @click="onAuthorize"></button>
      <button :disabled="!state.canSync" v-if="service.name" @click="onSync">
        <icon name="refresh"></icon>
      </button>
    </div>
    <p v-if="state" class="mt-1" v-text="state.message"></p>
    <div class="mt-1">
      <label>
        <setting-check name="syncScriptStatus" />
        <span v-text="i18n('labelSyncScriptStatus')"></span>
      </label>
    </div>
  </section>
</template>

<script>
import { sendMessage } from '#/common';
import options from '#/common/options';
import SettingCheck from '#/common/ui/setting-check';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import { store } from '../../utils';

const SYNC_CURRENT = 'sync.current';
const syncConfig = {
  current: '',
};
hookSetting(SYNC_CURRENT, value => {
  syncConfig.current = value || '';
});

export default {
  components: {
    SettingCheck,
    Icon,
  },
  data() {
    return {
      syncConfig,
      store,
    };
  },
  computed: {
    syncServices() {
      const states = this.store.sync;
      if (states && states.length) {
        return [
          {
            displayName: this.i18n('labelSyncDisabled'),
            name: '',
          },
          ...states,
        ];
      }
    },
    service() {
      if (this.syncServices) {
        const current = this.syncConfig.current || '';
        let service = this.syncServices.find(item => item.name === current);
        if (!service) {
          console.warn('Invalid current service:', current);
          service = this.syncServices[0];
        }
        return service;
      }
    },
    state() {
      const { service } = this;
      if (service) {
        const canAuthorize = ['unauthorized', 'error', 'authorized'].includes(service.authState)
          && ['idle', 'error'].includes(service.syncState);
        const canSync = canAuthorize && service.authState === 'authorized';
        return {
          message: this.getMessage(),
          label: this.getLabel(),
          canAuthorize,
          canSync,
        };
      }
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
    getMessage() {
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
    getLabel() {
      const { service } = this;
      if (service.authState === 'authorizing') return this.i18n('labelSyncAuthorizing');
      if (service.authState === 'authorized') return this.i18n('labelSyncRevoke');
      return this.i18n('labelSyncAuthorize');
    },
  },
};
</script>
