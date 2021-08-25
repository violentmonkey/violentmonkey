<template>
  <div class="edit frame flex flex-col fixed-full">
    <div class="edit-header flex mr-1 mr-1c">
      <nav>
        <div
          v-for="(label, navKey) in navItems" :key="navKey"
          class="edit-nav-item" :class="{active: nav === navKey}"
          v-text="label"
          @click="nav = navKey"
        />
      </nav>
      <div class="edit-name text-center ellipsis flex-1" v-text="scriptName"/>
      <div class="edit-hint text-right ellipsis">
        <a href="https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/"
           target="_blank"
           rel="noopener noreferrer"
           v-text="i18n('editHowToHint')"/>
      </div>
      <div class="edit-buttons">
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
        @code-dirty="codeDirty = $event"
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
      <vm-externals
        class="abs-full"
        v-if="nav === 'externals'"
        v-model="script"
      />
      <vm-help
        class="abs-full edit-body"
        v-show="nav === 'help'"
        :hotkeys="hotkeys"
      />
    </div>
  </div>
</template>

<script>
import { debounce, getScriptName, i18n, isEmpty, sendCmd, trueJoin } from '#/common';
import { deepCopy, deepEqual, objectPick } from '#/common/object';
import { showMessage } from '#/common/ui';
import { keyboardService } from '#/common/keyboard';
import VmCode from '#/common/ui/code';
import options from '#/common/options';
import { route, getUnloadSentry } from '#/common/router';
import { store } from '../../utils';
import VmSettings from './settings';
import VmValues from './values';
import VmExternals from '#/common/ui/externals';
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
const fromList = list => (
  list
    // Adding a new row so the user can click it and type, just like in an empty textarea.
    ? `${list.join('\n')}\n`
    : ''
);
const toList = text => (
  text.split('\n')
  .map(line => line.trim())
  .filter(Boolean)
);
let savedSettings;

let shouldSavePositionOnSave;
const savePosition = () => {
  if (options.get('editorWindow')) {
    options.set('editorWindowPos', {
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    });
  }
};
/** @param {chrome.windows.Window} _ */
const setupSavePosition = ({ id: curWndId, tabs }) => {
  if (tabs.length === 1) {
    const { onBoundsChanged } = global.chrome.windows;
    if (onBoundsChanged) {
      // triggered on moving/resizing, Chrome 86+
      onBoundsChanged.addListener(wnd => {
        if (wnd.id === curWndId) savePosition();
      });
    } else {
      // triggered on resizing only
      window.addEventListener('resize', debounce(savePosition, 100));
      shouldSavePositionOnSave = true;
    }
  }
};

let K_SAVE; // deduced from the current CodeMirror keymap
const K_PREV_PANEL = 'Alt-PageUp';
const K_NEXT_PANEL = 'Alt-PageDown';
const compareString = (a, b) => (a < b ? -1 : a > b);

export default {
  props: ['initial'],
  components: {
    VmCode,
    VmSettings,
    VmValues,
    VmExternals,
    VmHelp,
  },
  data() {
    return {
      nav: 'code',
      canSave: false,
      script: null,
      code: '',
      codeDirty: false,
      settings: {},
      commands: {
        save: this.save,
        close: this.close,
        showHelp: () => {
          this.nav = 'help';
        },
      },
      hotkeys: null,
    };
  },
  computed: {
    navItems() {
      const { meta, props } = this.script || {};
      const req = meta?.require.length && '@require';
      const res = !isEmpty(meta?.resources) && '@resource';
      return {
        code: i18n('editNavCode'),
        settings: i18n('editNavSettings'),
        ...props?.id && { values: i18n('editNavValues') },
        ...(req || res) && { externals: [req, res]::trueJoin('/') },
        help: '?',
      };
    },
    scriptName() {
      const { script } = this;
      const scriptName = script?.meta && getScriptName(script);
      store.title = scriptName;
      return scriptName;
    },
  },
  watch: {
    nav(val) {
      keyboardService.setContext('tabCode', val === 'code');
    },
    canSave(val) {
      this.toggleUnloadSentry(val);
      keyboardService.setContext('canSave', val);
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
    this.toggleUnloadSentry = getUnloadSentry(null, () => {
      this.$refs.code.cm.focus();
    });
    if (options.get('editorWindow') && global.history.length === 1) {
      browser.windows?.getCurrent({ populate: true }).then(setupSavePosition);
    }
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
    const { noframes } = custom;
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
        noframes: noframes == null ? '' : +noframes, // it was boolean in old VM
      },
    };
    savedSettings = deepCopy(this.settings);
    this.$watch('codeDirty', this.onChange);
    this.$watch('settings', this.onChange, { deep: true });
    // hotkeys
    {
      const navLabels = Object.values(this.navItems);
      const hotkeys = [
        [K_PREV_PANEL, ` ${navLabels.join(' < ')}`],
        [K_NEXT_PANEL, ` ${navLabels.join(' > ')}`],
        ...Object.entries(this.$refs.code.expandKeyMap())
        .sort((a, b) => compareString(a[1], b[1]) || compareString(a[0], b[0])),
      ];
      K_SAVE = hotkeys.find(([, cmd]) => cmd === 'save')?.[0];
      if (!K_SAVE) {
        K_SAVE = 'Ctrl-S';
        hotkeys.unshift([K_SAVE, 'save']);
      }
      this.hotkeys = hotkeys;
    }
    this.disposeList = [
      keyboardService.register('a-pageup', this.switchPrevPanel),
      keyboardService.register('a-pagedown', this.switchNextPanel),
      keyboardService.register(K_SAVE.replace('Ctrl-', 'ctrlcmd-'), this.save),
      keyboardService.register('escape', () => { this.nav = 'code'; }, {
        condition: '!tabCode',
      }),
    ];
  },
  methods: {
    async save() {
      if (!this.canSave) return;
      if (shouldSavePositionOnSave) savePosition();
      const { settings } = this;
      const { config, custom } = settings;
      const { notifyUpdates } = config;
      const { noframes } = custom;
      try {
        const codeComponent = this.$refs.code;
        const id = this.script?.props?.id;
        const res = await sendCmd('ParseScript', {
          id,
          code: codeComponent.getRealContent(),
          config: {
            ...config,
            notifyUpdates: notifyUpdates ? +notifyUpdates : null,
          },
          custom: {
            ...objectPick(custom, Object.keys(CUSTOM_PROPS)),
            ...objectPick(custom, CUSTOM_LISTS, toList),
            noframes: noframes ? +noframes : null,
          },
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts,
          // otherwise the script with same namespace will be overridden
          isNew: !id,
          message: '',
        });
        savedSettings = deepCopy(settings);
        codeComponent.cm.markClean();
        this.codeDirty = false; // triggers onChange which sets canSave
        this.canSave = false; // ...and set it explicitly in case codeDirty was false
        if (res?.where?.id) this.script = res.update;
      } catch (err) {
        showMessage({ text: err });
      }
    },
    close(cm) {
      if (cm && this.nav !== 'code') {
        this.nav = 'code';
      } else {
        this.$emit('close');
      }
    },
    saveClose() {
      this.save().then(this.close);
    },
    switchPanel(step) {
      const keys = Object.keys(this.navItems);
      this.nav = keys[(keys.indexOf(this.nav) + step + keys.length) % keys.length];
    },
    switchPrevPanel() {
      this.switchPanel(-1);
    },
    switchNextPanel() {
      this.switchPanel(1);
    },
    onChange() {
      this.canSave = this.codeDirty || !deepEqual(this.settings, savedSettings);
    },
  },
  beforeDestroy() {
    store.title = null;
    this.toggleUnloadSentry(false);
    this.disposeList?.forEach(dispose => {
      dispose();
    });
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
