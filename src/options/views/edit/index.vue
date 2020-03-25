<template>
  <div class="edit frame flex flex-col fixed-full">
    <div class="edit-header flex">
      <nav>
        <div
          v-for="(label, navKey) in navItems" :key="navKey"
          class="edit-nav-item" :class="{active: nav === navKey}"
          v-text="label"
          @click="nav = navKey"
        />
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
        class="abs-full"
        v-model="code"
        ref="code"
        v-show="nav === 'code'"
        :active="nav === 'code'"
        :commands="commands"
      />
      <vm-settings
        class="abs-full edit-body"
        v-show="nav === 'settings'"
        :active="nav === 'settings'"
        :settings="settings"
        :value="script"
      />
      <vm-values
        class="abs-full edit-body"
        v-show="nav === 'values'"
        :active="nav === 'values'"
        :script="script"
      />
      <vm-help
        class="abs-full edit-body"
        v-show="nav === 'help'"
        :active="nav === 'help'"
        :navLabels="Object.values(navItems)"
        :target="this.$refs.code"
      />
    </div>
  </div>
</template>

<script>
import { i18n, sendCmd } from '#/common';
import { deepCopy, deepEqual, objectPick } from '#/common/object';
import VmCode from '#/common/ui/code';
import { route } from '#/common/router';
import { store, showConfirmation, showMessage } from '../../utils';
import VmSettings from './settings';
import VmValues from './values';
import VmHelp from './help';

const CUSTOM_PROPS = {
  name: '',
  runAt: '',
  homepageURL: '',
  updateURL: '',
  downloadURL: '',
  origInclude: true,
  origExclude: true,
  origMatch: true,
  origExcludeMatch: true,
};
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
let showingConfirmation;

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
      nav: '',
      canSave: false,
      script: null,
      code: '',
      settings: {},
      commands: {
        save: this.save,
        close: this.close,
        showHelp: () => {
          this.nav = 'help';
        },
      },
    };
  },
  computed: {
    navItems: () => ({
      code: i18n('editNavCode'),
      settings: i18n('editNavSettings'),
      values: i18n('editNavValues'),
      help: '?',
    }),
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
    // usually errors for resources
    'initial.error'(error) {
      if (error) {
        showMessage({ text: `${this.initial.message}\n\n${error}` });
      }
    },
  },
  created() {
    this.script = this.initial;
    document.addEventListener('keydown', this.switchPanel);
  },
  async mounted() {
    this.nav = 'code';
    const id = this.script?.props?.id;
    if (id) {
      this.code = await sendCmd('GetScriptCode', id);
    } else {
      const { script, code } = await sendCmd('NewScript', route.paths[2]);
      this.script = script;
      this.code = code;
    }
    const { custom, config } = this.script;
    this.settings = {
      config: {
        notifyUpdates: `${config.notifyUpdates ?? ''}`,
        // Needs to match Vue model type so deepEqual can work properly
        shouldUpdate: Boolean(config.shouldUpdate),
      },
      custom: {
        // Adding placeholders for any missing values so deepEqual can work properly
        ...CUSTOM_PROPS,
        ...objectPick(custom, Object.keys(CUSTOM_PROPS)),
        ...objectPick(custom, CUSTOM_LISTS, fromList),
        runAt: custom.runAt || '',
      },
    };
    saved = objectPick(this, ['code', 'settings'], deepCopy);
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
            ...objectPick(custom, Object.keys(CUSTOM_PROPS)),
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
        if (res?.where?.id) this.script = res.update;
      } catch (err) {
        showMessage({ text: err });
      }
    },
    async close() {
      try {
        if (this.canSave) {
          showingConfirmation = true;
          await showConfirmation(i18n('confirmNotSaved'));
          store.route.pinned = false;
        }
        this.$emit('close');
      } catch (e) {
        this.setFocusToCode();
      } finally {
        showingConfirmation = false;
      }
    },
    saveClose() {
      this.save().then(this.close);
    },
    switchPanel(e) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.altKey) {
          const dir = e.code === 'PageDown' && 1 || e.code === 'PageUp' && -1;
          if (dir) {
            const keys = Object.keys(this.navItems);
            this.nav = keys[(keys.indexOf(this.nav) + dir + keys.length) % keys.length];
          }
        } else if (e.code === 'Escape') {
          this.nav = 'code';
        }
      }
    },
    toggleUnloadSentry(state) {
      const onOff = `${state ? 'add' : 'remove'}EventListener`;
      global[onOff]('beforeunload', this.onUnload);
      global[onOff]('popstate', this.onUnload);
      store.route.pinned = state;
    },
    onChange() {
      this.canSave = this.code !== saved.code
        || !deepEqual(this.settings, saved.settings);
    },
    /** @param {Event} e */
    onUnload(e) {
      // modern browser show their own message text
      e.returnValue = i18n('confirmNotSaved');
      // popstate cannot be prevented so we pin current `route` and display a confirmation
      if (e.type === 'popstate' && !showingConfirmation) {
        this.close();
      }
    },
  },
  beforeDestroy() {
    store.title = null;
    this.toggleUnloadSentry(false);
    document.removeEventListener('keydown', this.switchPanel);
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
