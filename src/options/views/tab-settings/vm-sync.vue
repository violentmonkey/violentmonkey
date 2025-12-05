<template>
  <section class="mb-1c">
    <h3 v-text="i18n('labelSync')" :class="{ bright: store.isEmpty === 1 }" />
    <div class="flex flex-wrap center-items">
      <span v-text="i18n('labelSyncService')"></span>
      <select class="mx-1" :value="rCurrentName" @change="onSyncChange">
        <option
          v-for="service in [SYNC_NONE, ...rSyncServices]"
          :key="service.name"
          v-text="service.displayName"
          :value="service.name"
        />
      </select>
      <template v-if="rService">
        <button
          v-text="rLabel"
          v-if="rAuthType === 'oauth'"
          :disabled="!rCanAuthorize"
          @click="onAuthorize"
        />
        <tooltip :content="i18n('labelSync')" class="stretch-self flex mr-1">
          <button
            :disabled="!rCanSync"
            @click="onSync(SYNC_MERGE)"
            class="flex center-items"
          >
            <icon name="refresh" />
          </button>
        </tooltip>
        <p v-if="rMessage">
          <span
            v-text="rMessage"
            :class="{ 'text-red': rError }"
            class="mr-1"
          />
          <span v-text="rError" />
        </p>
      </template>
    </div>
    <fieldset v-if="rService && rAuthType === PASSWORD" class="mt-1c">
      <label class="sync-server-url flex pre">
        <span v-text="i18n('labelSyncServerUrl')"></span>
        <input
          type="url"
          class="flex-1"
          v-model="rUserConfig[SERVER_URL]"
          :disabled="!rCanAuthorize"
        />
      </label>
      <div class="mr-2c">
        <label>
          <span v-text="i18n('labelSyncUsername')"></span>
          <input
            type="text"
            v-model="rUserConfig[USERNAME]"
            :disabled="!rCanAuthorize || rUserConfig[ANONYMOUS]"
          />
        </label>
        <label class="inline-block">
          <span v-text="i18n('labelSyncPassword')"></span>
          <input
            type="password"
            v-model="rUserConfig[PASSWORD]"
            :disabled="!rCanAuthorize || rUserConfig[ANONYMOUS]"
          />
        </label>
        <label>
          <input
            type="checkbox"
            v-model="rUserConfig[ANONYMOUS]"
            :disabled="!rCanAuthorize"
          />
          <span v-text="i18n('labelSyncAnonymous')"></span>
        </label>
      </div>
      <div>
        <button
          v-text="i18n('buttonSave')"
          @click.prevent="onSaveUserConfig"
          :disabled="!rCanAuthorize"
        />
      </div>
    </fieldset>
    <div v-if="rService">
      <setting-check
        class="mr-1"
        name="syncAutomatically"
        :label="i18n('labelSyncAutomatically')"
      />
      <button v-text="i18n('buttonSyncPushOnce')" @click="onSync(SYNC_PUSH)" />
      <button v-text="i18n('buttonSyncPullOnce')" @click="onSync(SYNC_PULL)" />
    </div>
    <div v-if="rService">
      <setting-check
        name="syncScriptStatus"
        :label="i18n('labelSyncScriptStatus')"
      />
    </div>
  </section>
</template>

<script setup>
import { i18n, sendCmdDirectly } from '@/common';
import {
  ANONYMOUS,
  AUTHORIZED,
  AUTHORIZING,
  ERROR,
  IDLE,
  INITIALIZING,
  NO_AUTH,
  PASSWORD,
  READY,
  SERVER_URL,
  SYNC_MERGE,
  SYNC_PULL,
  SYNC_PUSH,
  SYNCING,
  UNAUTHORIZED,
  USER_CONFIG,
  USERNAME,
} from '@/common/consts-sync';
import hookSetting from '@/common/hook-setting';
import options from '@/common/options';
import { ref, watchEffect } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import SettingCheck from '@/common/ui/setting-check';
import Icon from '@/common/ui/icon';
import { store } from '../../utils';

const LABEL_MAP = {
  [AUTHORIZING]: i18n('labelSyncAuthorizing'),
  [AUTHORIZED]: i18n('labelSyncRevoke'),
};
const SYNC_CURRENT = 'sync.current';
const SYNC_NONE = {
  displayName: i18n('labelSyncDisabled'),
  name: '',
  properties: {},
};

//#region refs
const rAuthType = ref();
const rCanAuthorize = ref();
const rCanSync = ref();
const rCurrentName = ref('');
const rError = ref();
const rLabel = ref();
const rMessage = ref();
const rService = ref();
const rSyncServices = ref();
const rUserConfig = ref();
//#endregion
hookSetting(SYNC_CURRENT, (value) => {
  rCurrentName.value = value || '';
});
watchEffect(() => {
  const services = store.sync || [];
  const curName = rCurrentName.value || '';
  const srv = curName && services.find((item) => item.name === curName);
  if (srv) setRefs(srv);
  else if (curName) console.warn('Invalid current service:', curName);
  rService.value = srv;
  rSyncServices.value = services;
});

function onSaveUserConfig() {
  sendCmdDirectly('SyncSetConfig', rUserConfig.value);
}
function onSyncChange(e) {
  const { value } = e.target;
  options.set(SYNC_CURRENT, value);
}
function onAuthorize() {
  const { authState } = rService.value;
  if ([AUTHORIZED].includes(authState)) {
    // revoke
    sendCmdDirectly('SyncRevoke');
  } else if ([NO_AUTH, UNAUTHORIZED, ERROR].includes(authState)) {
    // authorize
    sendCmdDirectly('SyncAuthorize');
  }
}
function onSync(mode) {
  sendCmdDirectly('SyncStart', mode);
}
function setRefs(srv) {
  const { authState, syncState } = srv;
  const canAuth = (rCanAuthorize.value =
    [IDLE, ERROR].includes(syncState) &&
    [NO_AUTH, UNAUTHORIZED, ERROR, AUTHORIZED].includes(authState));
  rAuthType.value = srv.properties.authType;
  rCanSync.value = canAuth && authState === AUTHORIZED;
  rLabel.value = LABEL_MAP[authState] || i18n('labelSyncAuthorize');
  rUserConfig.value = srv[USER_CONFIG] || {};
  // set message and error
  let res, err;
  if (authState === INITIALIZING) res = i18n('msgSyncInit');
  else if (authState === NO_AUTH) res = i18n('msgSyncNoAuthYet');
  else if (authState === ERROR) err = i18n('msgSyncInitError');
  else if (authState === UNAUTHORIZED) err = i18n('msgSyncInitError');
  else if (syncState === ERROR) err = i18n('msgSyncError');
  else if (syncState === READY) res = i18n('msgSyncReady');
  else if (syncState === SYNCING) {
    res = srv.progress;
    res =
      i18n('msgSyncing') +
      (res?.total ? ` (${res.finished}/${res.total})` : '');
  } else if ((res = srv.lastSync)) {
    res = i18n('lastSync', new Date(res).toLocaleString());
  }
  rMessage.value = res || err || '';
  rError.value = (err && srv.error) || '';
}
</script>
