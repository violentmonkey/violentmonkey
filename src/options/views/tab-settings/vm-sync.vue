<template>
  <section class="mb-1c">
    <h3 v-text="i18n('labelSync')" :class="{ bright: store.isEmpty === 1 }" />
    <div class="flex flex-wrap center-items mr-2c">
      <div class="flex center-items">
        <span class="mr-1" v-text="i18n('labelSyncService')"></span>
        <select
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
      </div>
      <div v-if="rService" class="flex">
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
      </div>
      <div v-if="rService" class="flex">
        <tooltip :content="i18n('labelSync')" class="stretch-self flex">
          <button
            :disabled="!rCanSync"
            @click="onSync(SYNC_MERGE)"
            class="flex center-items"
          >
            <IconSync />
          </button>
        </tooltip>
        <tooltip
          :content="i18n('buttonSyncPushOnce')"
          class="stretch-self flex"
        >
          <button @click="onSync(SYNC_PUSH)" :disabled="!rCanSync">
            <IconCloudUpload />
          </button>
        </tooltip>
        <tooltip
          :content="i18n('buttonSyncPullOnce')"
          class="stretch-self flex"
        >
          <button @click="onSync(SYNC_PULL)" :disabled="!rCanSync">
            <IconCloudDownload />
          </button>
        </tooltip>
      </div>
    </div>
    <p v-if="rMessage">
      <span v-text="rMessage" :class="{ 'text-red': rError }" class="mr-1" />
      <span v-text="rError" />
    </p>
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
    <div class="flex mr-2c">
      <setting-check
        name="syncAutomatically"
        :label="i18n('labelSyncAutomatically')"
      />
      <setting-check
        name="syncScriptStatus"
        :label="i18n('labelSyncScriptStatus')"
      />
    </div>
  </section>
</template>

<script setup>
import IconCloudUpload from '~icons/mdi/cloud-upload';
import IconCloudDownload from '~icons/mdi/cloud-download';
import IconSync from '~icons/mdi/sync';
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
    SYNC_ERROR_AUTH,
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
