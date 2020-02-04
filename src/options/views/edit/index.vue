<template>
  <div class="edit frame flex flex-col fixed-full">
    <div class="edit-header flex">
      <nav>
        <div
          class="edit-nav-item"
          :class="{active: nav === 'code'}"
          v-text="i18n('editNavCode')"
          @click="nav = 'code'"
        />
        <div
          class="edit-nav-item"
          :class="{active: nav === 'settings'}"
          v-text="i18n('editNavSettings')"
          @click="nav = 'settings'"
        />
        <div
          class="edit-nav-item"
          :class="{active: nav === 'values'}"
          v-if="scriptId"
          v-text="i18n('editNavValues')"
          @click="nav = 'values'"
        />
        <div
          class="edit-nav-item"
          :class="{active: nav === 'help'}"
          @click="nav = 'help'"
        >?</div>
      </nav>
      <div class="edit-name text-center ellipsis flex-1 mr-1" v-text="scriptName"/>
      <div class="edit-hint text-right ellipsis mr-1">
        <a href="https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/"
           target="_blank"
           rel="noopener noreferrer"
           v-text="i18n('editHowToHint')"/>
      </div>
      <div class="edit-buttons mr-1">
        <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"/>
        <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"/>
        <button v-text="i18n('buttonClose')" @click="close"/>
      </div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code
        v-show="nav === 'code'" class="abs-full" ref="code" :editing="nav === 'code'"
        v-model="code" :commands="commands"
      />
      <vm-settings
        v-show="nav === 'settings'" class="abs-full edit-body"
        :value="script" :settings="settings"
      />
      <vm-values
        :show="nav === 'values'" class="abs-full edit-body" :script="script"
      />
      <vm-help
        v-if="nav === 'help'" class="abs-full edit-body"
        :target="this.$refs.code"
      />
    </div>
  </div>
</template>

<script>
import { i18n, noop, sendCmd } from '#/common';
import { deepCopy, deepEqual, objectPick } from '#/common/object';
import VmCode from '#/common/ui/code';
import { route } from '#/common/router';
import { store, showConfirmation, showMessage } from '../../utils';
import VmSettings from './settings';
import VmValues from './values';
import VmHelp from './help';

const EDITOR_RECOVERY = 'editorRecovery';
const EDITOR_RECOVERY_PERIOD = 60e3; // ms
const CUSTOM_PROPS = [
  'name',
  'runAt',
  'homepageURL',
  'updateURL',
  'downloadURL',
  'origInclude',
  'origExclude',
  'origMatch',
  'origExcludeMatch',
];
const CUSTOM_LISTS = [
  'include',
  'match',
  'exclude',
  'excludeMatch',
];
const fromList = list => list?.join('\n') || '';
const toList = text => (
  text.split('\n')
  .map(line => line.trim())
  .filter(Boolean)
);
let saved;
let recoveryTimer;

export default {
  props: ['initial'],
  components: {
    VmCode,
    VmSettings,
    VmValues,
    VmHelp,
  },
  data() {
    return {
      nav: 'code',
      canSave: false,
      script: null,
      code: '',
      settings: {},
      commands: {
        save: this.save,
        close: () => this.close({ fromCM: true }),
        showHelp: () => {
          this.nav = 'help';
        },
      },
    };
  },
  computed: {
    scriptName() {
      const { custom, meta } = this.script || {};
      const scriptName = custom && custom.name || meta && meta.name;
      store.title = scriptName;
      return scriptName;
    },
    scriptId() {
      return this.script?.props?.id;
    },
  },
  watch: {
    canSave(val) {
      this.toggleUnloadSentry(val);
    },
    nav() {
      setTimeout(() => this.nav === 'code' && this.$refs.code.cm.focus());
    },
  },
  created() {
    this.script = this.initial;
  },
  async mounted() {
    const id = this.script?.props?.id;
    const [
      dbData,
      { [EDITOR_RECOVERY]: rec },
    ] = await Promise.all([
      sendCmd(id ? 'GetScriptCode' : 'NewScript', id || route.paths[2]),
      browser.storage.local.get(EDITOR_RECOVERY),
    ]);
    if (!id) this.script = dbData.script;
    const { custom, config } = this.script;
    const dbCode = id ? dbData : dbData.code;
    const dbSettings = {
      config: {
        notifyUpdates: `${config.notifyUpdates ?? ''}`,
        shouldUpdate: config.shouldUpdate,
      },
      custom: {
        ...objectPick(custom, CUSTOM_PROPS),
        ...objectPick(custom, CUSTOM_LISTS, fromList),
        runAt: custom.runAt || '',
      },
    };
    const hasRec = rec?.id === id && rec.settings?.config && typeof rec.code === 'string';
    const hasRecCode = hasRec && dbCode !== rec.code;
    const hasRecSettings = hasRec && !deepEqual(dbSettings, rec.settings);
    this.code = hasRecCode ? rec.code : dbCode;
    this.settings = hasRecSettings ? rec.settings : dbSettings;
    this.canSave = hasRecCode || hasRecSettings;
    saved = { code: dbCode, settings: deepCopy(dbSettings) };
    if (hasRec && !this.canSave) this.removeRecovery();
    this.$watch('code', this.onChange);
    this.$watch('settings', this.onChange, { deep: true });
  },
  methods: {
    async save() {
      const { code, settings } = this;
      const { config, custom } = settings;
      const { notifyUpdates } = config;
      try {
        const id = this.script?.props?.id;
        const res = await sendCmd('ParseScript', {
          id,
          code,
          config: {
            ...config,
            notifyUpdates: notifyUpdates ? +notifyUpdates : null,
          },
          custom: {
            ...objectPick(custom, CUSTOM_PROPS),
            ...objectPick(custom, CUSTOM_LISTS, toList),
          },
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts,
          // otherwise the script with same namespace will be overridden
          isNew: !id,
          message: '',
        });
        saved = deepCopy({ code, settings });
        this.canSave = false;
        this.removeRecovery();
        if (res?.where?.id) this.script = res.update;
      } catch (err) {
        showMessage({ text: err });
      }
    },
    async close({ fromCM } = {}) {
      if (fromCM && this.nav !== 'code') {
        this.nav = 'code';
        return;
      }
      try {
        if (this.canSave) await showConfirmation(i18n('confirmNotSaved'));
        this.$emit('close');
      } catch (e) { /* NOP */ }
    },
    removeRecovery() {
      browser.storage.local.remove(EDITOR_RECOVERY);
    },
    saveClose() {
      this.save().then(this.close);
    },
    saveRecovery() {
      if (this.canSave) {
        browser.storage.local.set({
          [EDITOR_RECOVERY]: {
            id: this.script.props.id,
            // need to clone reactive objects
            ...objectPick(this, ['code', 'settings'], deepCopy),
          },
        });
      }
    },
    toggleUnloadSentry(state) {
      const onOff = `${state ? 'add' : 'remove'}EventListener`;
      window[onOff]('beforeunload', this.onUnload);
      window[onOff]('popstate', this.onUnload);
      clearInterval(recoveryTimer);
      if (state) recoveryTimer = setInterval(this.saveRecovery, EDITOR_RECOVERY_PERIOD);
    },
    onChange() {
      this.canSave = this.code !== saved.code
        || !deepEqual(this.settings, saved.settings);
    },
    /** @param {Event} e */
    onUnload(e) {
      // modern browser show their own message text
      e.returnValue = i18n('confirmNotSaved');
      // saving regardless of whether the user reloads the page, just in case
      if (this.canSave) {
        this.saveRecovery();
      }
      // popstate cannot be prevented
      if (e.type === 'popstate') {
        showConfirmation(i18n('msgNotSaved'), { cancel: false }).catch(noop);
      }
    },
  },
  beforeDestroy() {
    store.title = null;
    this.toggleUnloadSentry(false);
  },
};
</script>

<style>
.edit {
  z-index: 2000;
  &-header {
    align-items: center;
    justify-content: space-between;
  }
  &-name {
    font-weight: bold;
  }
  &-body {
    padding: .5rem 1rem;
    overflow: auto;
    background: var(--bg);
  }
  &-nav-item {
    display: inline-block;
    padding: 8px 16px;
    cursor: pointer;
    &.active {
      background: var(--bg);
      box-shadow: 0 -1px 1px var(--fill-7);
    }
    &:not(.active):hover {
      background: var(--fill-0-5);
      box-shadow: 0 -1px 1px var(--fill-4);
    }
  }
}

@media (max-width: 767px) {
  .edit-hint {
    display: none;
  }
}

@media (max-width: 500px) {
  .edit-name {
    display: none;
  }
}
</style>
