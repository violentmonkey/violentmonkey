<template>
  <section class="mb-1c">
    <h3 v-text="i18n('labelSync')" :class="{ bright: store.isEmpty === 1 }" />
    <div class="flex flex-wrap center-items">
      <span v-text="i18n('labelSyncService')"></span>
      <select
        class="mx-1"
        :value="rCurrentName"
        @change="onSyncChange"
        :disabled="!rCanUpdateConfig"
      >
        <option
          v-for="service in [SYNC_NONE, ...rSyncServices]"
          :key="service.name"
          v-text="service.displayName"
          :value="service.name"
        />
      </select>
      <template v-if="rService">
        <button
          v-text="rLabelAuthorize"
          v-if="rAuthType === 'oauth'"
          :disabled="!rCanAuthorize"
          @click="onAuthorize"
        />
        <button
          v-text="i18n('labelSyncRevoke')"
          v-if="rAuthType === 'oauth'"
          :disabled="!rCanRevoke"
          @click="onRevoke"
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
          :disabled="!rCanUpdateConfig"
        />
      </label>
      <div class="mr-2c">
        <label class="inline-block">
          <span v-text="i18n('labelSyncUsername')"></span>
          <input
            type="text"
            v-model="rUserConfig[USERNAME]"
            :disabled="!rCanUpdateConfig || rUserConfig[ANONYMOUS]"
          />
        </label>
        <label class="inline-block">
          <span v-text="i18n('labelSyncPassword')"></span>
          <input
            type="password"
            v-model="rUserConfig[PASSWORD]"
            :disabled="!rCanUpdateConfig || rUserConfig[ANONYMOUS]"
          />
        </label>
        <label class="inline-block">
          <input
            type="checkbox"
            v-model="rUserConfig[ANONYMOUS]"
            :disabled="!rCanUpdateConfig"
          />
          <span v-text="i18n('labelSyncAnonymous')"></span>
        </label>
      </div>
      <div>
        <button
          v-text="i18n('buttonSave')"
          @click.prevent="onSaveUserConfig"
          :disabled="!rCanUpdateConfig"
        />
      </div>
    </fieldset>
    <div>
      <setting-check
        class="mr-1"
        name="syncAutomatically"
        :label="i18n('labelSyncAutomatically')"
      />
      <button
        v-text="i18n('buttonSyncPushOnce')"
        @click="onSync(SYNC_PUSH)"
        :disabled="!rCanSync"
      />
      <button
        v-text="i18n('buttonSyncPullOnce')"
        @click="onSync(SYNC_PULL)"
        :disabled="!rCanSync"
      />
    </div>
    <div>
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
  PASSWORD,
  SERVER_URL,
  SYNC_MERGE,
  SYNC_PULL,
  SYNC_PUSH,
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
import {
  SYNC_AUTHORIZED,
  SYNC_AUTHORIZING,
  SYNC_ERROR,
  SYNC_ERROR_AUTH,
  SYNC_ERROR_INIT,
  SYNC_IN_PROGRESS,
  SYNC_INITIALIZING,
  SYNC_UNAUTHORIZED,
} from '@/background/sync/state-machine';

const SYNC_CURRENT = 'sync.current';
const SYNC_NONE = {
  displayName: i18n('labelSyncDisabled'),
  name: '',
  properties: {},
};

//#region refs
const rAuthType = ref();
const rCanAuthorize = ref();
const rCanRevoke = ref();
const rCanSync = ref();
const rCanUpdateConfig = ref();
const rCurrentName = ref('');
const rError = ref();
const rLabelAuthorize = ref();
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
  // Also update refs for None
  setRefs(srv);
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
  sendCmdDirectly('SyncAuthorize');
}
function onRevoke() {
  sendCmdDirectly('SyncRevoke');
}
function onSync(mode) {
  sendCmdDirectly('SyncStart', mode);
}
function setRefs(srv) {
  const status = srv?.state?.status;
  const hasAuth = srv?.hasAuth;
  rCanAuthorize.value = [
    SYNC_UNAUTHORIZED,
    SYNC_ERROR,
    SYNC_ERROR_INIT,
  ].includes(status);
  rCanRevoke.value =
    hasAuth &&
    [SYNC_AUTHORIZED, SYNC_ERROR, SYNC_ERROR_INIT, SYNC_ERROR_AUTH].includes(
      status,
    );
  rCanSync.value = [SYNC_AUTHORIZED, SYNC_ERROR, SYNC_ERROR_INIT].includes(
    status,
  );
  rCanUpdateConfig.value = status !== SYNC_IN_PROGRESS;
  rAuthType.value = srv?.properties?.authType;
  rLabelAuthorize.value =
    status === SYNC_AUTHORIZING
      ? i18n('labelSyncAuthorizing')
      : i18n('labelSyncAuthorize');
  rUserConfig.value = srv?.[USER_CONFIG] || {};
  // set message and error
  let res, err;
  if (srv) {
    if (status === SYNC_INITIALIZING) res = i18n('msgSyncInit');
    else if (status === SYNC_UNAUTHORIZED) res = i18n('msgSyncNoAuthYet');
    else if (status === SYNC_ERROR_INIT) err = i18n('msgSyncInitError');
    else if (status === SYNC_ERROR_AUTH) err = i18n('msgSyncInitError');
    else if (status === SYNC_ERROR) err = i18n('msgSyncError');
    else if (status === SYNC_IN_PROGRESS) {
      res = srv.progress;
      res =
        i18n('msgSyncing') +
        (res?.total ? ` (${res.finished}/${res.total})` : '');
    } else if ((res = srv.lastSync)) {
      res = i18n('lastSync', new Date(res).toLocaleString());
    }
  }
  rMessage.value = res || err || '';
  rError.value = (err && srv?.error) || '';
}
</script>
