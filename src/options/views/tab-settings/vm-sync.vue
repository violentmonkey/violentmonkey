<template>
  <section class="mb-1c">
    <h3 v-text="i18n('labelSync')" :class="{bright: store.isEmpty === 1}"/>
    <div v-if="state" class="flex flex-wrap center-items">
      <span v-text="i18n('labelSyncService')"></span>
      <select class="mx-1" :value="syncConfig.current" @change="onSyncChange">
        <option
          v-for="service in syncServices"
          :key="service.name"
          v-text="service.displayName"
          :value="service.name"
        />
      </select>
      <button v-text="state.label" v-if="service.name && state.authType === 'oauth'"
      :disabled="!state.canAuthorize" @click="onAuthorize"></button>
      <tooltip v-if="service.name" :content="i18n('labelSync')" class="stretch-self flex mr-1">
        <button :disabled="!state.canSync" @click="onSync" class="flex center-items">
          <icon name="refresh"/>
        </button>
      </tooltip>
      <p v-if="state" v-text="state.message"/>
    </div>
    <fieldset class="mt-1c" v-if="state?.authType === 'password'">
      <label class="sync-server-url">
        <span v-text="i18n('labelSyncServerUrl')"></span>
        <input
          type="url"
          v-model="state.userConfig.serverUrl"
          :disabled="!state.canAuthorize"
        />
      </label>
      <div class="mr-2c">
        <label>
          <span v-text="i18n('labelSyncUsername')"></span>
          <input
            type="text"
            v-model="state.userConfig.username"
            :disabled="!state.canAuthorize || state.userConfig.anonymous"
          />
        </label>
        <label class="inline-block">
          <span v-text="i18n('labelSyncPassword')"></span>
          <input
            type="password"
            v-model="state.userConfig.password"
            :disabled="!state.canAuthorize || state.userConfig.anonymous"
          />
        </label>
        <label>
          <input
            type="checkbox"
            v-model="state.userConfig.anonymous"
            :disabled="!state.canAuthorize"
          />
          <span v-text="i18n('labelSyncAnonymous')"></span>
        </label>
      </div>
      <div>
        <button
          v-text="i18n('buttonSave')"
          @click.prevent="onSaveUserConfig"
          :disabled="!state.canAuthorize"
        />
      </div>
    </fieldset>
    <div v-if="service?.name">
      <setting-check name="syncScriptStatus" :label="i18n('labelSyncScriptStatus')" />
    </div>
  </section>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip';
import { sendCmdDirectly } from '@/common';
import options from '@/common/options';
import SettingCheck from '@/common/ui/setting-check';
import hookSetting from '@/common/hook-setting';
import Icon from '@/common/ui/icon';
import { store } from '../../utils';

const SYNC_CURRENT = 'sync.current';
const syncConfig = {
  current: '',
};
hookSetting(SYNC_CURRENT, (value) => {
  syncConfig.current = value || '';
});

export default {
  components: {
    SettingCheck,
    Icon,
    Tooltip,
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
            properties: {},
          },
          ...states,
        ];
      }
      return null;
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
      return null;
    },
    state() {
      const { service } = this;
      if (service) {
        const canAuthorize = ['idle', 'error'].includes(service.syncState)
          && ['no-auth', 'unauthorized', 'error', 'authorized'].includes(service.authState);
        const canSync = canAuthorize && service.authState === 'authorized';
        return {
          message: this.getMessage(),
          label: this.getLabel(),
          canAuthorize,
          canSync,
          authType: service.properties.authType,
          userConfig: service.userConfig || {},
        };
      }
      return null;
    },
  },
  methods: {
    onSaveUserConfig() {
      sendCmdDirectly('SyncSetConfig', this.state.userConfig);
    },
    onSyncChange(e) {
      const { value } = e.target;
      options.set(SYNC_CURRENT, value);
    },
    onAuthorize() {
      const { service } = this;
      if (['authorized'].includes(service.authState)) {
        // revoke
        sendCmdDirectly('SyncRevoke');
      } else if (['no-auth', 'unauthorized', 'error'].includes(service.authState)) {
        // authorize
        sendCmdDirectly('SyncAuthorize');
      }
    },
    onSync() {
      sendCmdDirectly('SyncStart');
    },
    getMessage() {
      const { service } = this;
      if (service.authState === 'initializing') return this.i18n('msgSyncInit');
      if (service.authState === 'no-auth') return this.i18n('msgSyncNoAuthYet');
      if (service.authState === 'error') return this.i18n('msgSyncInitError');
      if (service.authState === 'unauthorized') return this.i18n('msgSyncInitError');
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

<style>
.sync-server-url {
  > input {
    width: 400px;
  }
}
</style>
