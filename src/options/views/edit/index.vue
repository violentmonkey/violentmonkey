<template>
  <div class="edit frame flex flex-col abs-full" :class="{frozen, readOnly}">
    <div class="edit-header flex mr-1c">
      <nav>
        <div
          v-for="(label, navKey) in navItems" :key="navKey"
          class="edit-nav-item" :class="{active: nav === navKey}"
          v-text="label"
          @click="nav = navKey"
        />
      </nav>
      <div class="edit-name text-center ellipsis flex-1">
        <span class="subtle" v-if="script.config.removed" v-text="i18n('headerRecycleBin') + ' / '"/>
        {{scriptName}}
      </div>
      <p v-if="frozen" class="text-upper text-right text-red" v-text="i18n('readonly')"/>
      <div v-else class="edit-hint text-right ellipsis">
        <a href="https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/"
           target="_blank"
           rel="noopener noreferrer"
           v-text="i18n('editHowToHint')"/>
      </div>
      <div class="mr-1">
        <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"
                :class="{'has-error': fatal || errors}" :title="fatal || errors"/>
        <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"/>
        <button v-text="i18n('buttonClose')" @click="close"/>
      </div>
    </div>

    <div class="frozen-note shelf mr-2c flex flex-wrap" v-if="note && nav === 'code'">
      <p v-text="i18n('readonlyNote')"/>
      <keep-alive>
        <VMSettingsUpdate class="flex ml-2c" :script="script"/>
      </keep-alive>
    </div>

    <p v-if="fatal" class="shelf fatal">
      <b v-text="fatal[0]"/>
      {{fatal[1]}}
    </p>

    <vm-code
      class="flex-auto"
      :value="code"
      :readOnly="frozen"
      :title="frozen ? i18n('readonly') : null"
      ref="code"
      v-show="nav === 'code'"
      :active="nav === 'code'"
      :commands="commands"
      @code-dirty="codeDirty = $event"
    />
    <keep-alive>
    <vm-settings
      class="edit-body"
      v-if="nav === 'settings'"
      v-bind="{readOnly, script}"
    />
    <vm-values
      class="edit-body"
      v-else-if="nav === 'values'"
      v-bind="{readOnly, script}"
    />
    <vm-externals
      class="flex-auto"
      v-else-if="nav === 'externals'"
      :value="script"
    />
    <vm-help
      class="edit-body"
      v-else-if="nav === 'help'"
      :hotkeys="hotkeys"
    />
    </keep-alive>

    <div v-if="errors" class="errors shelf my-1c">
      <p v-for="e in errors" :key="e" v-text="e" class="text-red"/>
      <p class="my-1">
        <a :href="urlMatching" target="_blank" rel="noopener noreferrer" v-text="urlMatching"/>
      </p>
    </div>
  </div>
</template>

<script>
import {
  browserWindows,
  debounce, formatByteLength, getScriptName, getScriptUpdateUrl, i18n, isEmpty,
  sendCmdDirectly, trueJoin,
} from '@/common';
import { deepCopy, deepEqual, objectPick } from '@/common/object';
import { showMessage } from '@/common/ui';
import { keyboardService } from '@/common/keyboard';
import VmCode from '@/common/ui/code';
import VmExternals from '@/common/ui/externals';
import options from '@/common/options';
import { getUnloadSentry } from '@/common/router';
import { store } from '../../utils';
import VmSettings from './settings';
import VMSettingsUpdate from './settings-update';
import VmValues from './values';
import VmHelp from './help';

const CUSTOM_PROPS = {
  name: '',
  homepageURL: '',
  updateURL: '',
  downloadURL: '',
  origInclude: true,
  origExclude: true,
  origMatch: true,
  origExcludeMatch: true,
};
const toProp = val => val !== '' ? val : null; // `null` removes the prop from script object
const CUSTOM_LISTS = [
  'include',
  'match',
  'exclude',
  'excludeMatch',
];
const toList = text => (
  text.trim()
    ? text.split('\n').map(line => line.trim()).filter(Boolean)
    : null // `null` removes the prop from script object
);
const CUSTOM_ENUM = [
  INJECT_INTO,
  RUN_AT,
];
const toEnum = val => val || null; // `null` removes the prop from script object

let shouldSavePositionOnSave;
/** @param {chrome.windows.Window} [wnd] */
const savePosition = async wnd => {
  if (options.get('editorWindow')) {
    if (!wnd) wnd = await browserWindows?.getCurrent() || {};
    /* chrome.windows API can't set both the state and coords, so we have to choose:
     * either we save the min/max state and lose the coords on restore,
     * or we lose the min/max state and save the normal coords.
     * Let's assume those who use a window prefer it at a certain position most of the time,
     * and occasionally minimize/maximize it, but wouldn't want to save the state. */
    if (wnd.state === 'normal') {
      options.set('editorWindowPos', objectPick(wnd, ['left', 'top', 'width', 'height']));
    }
  }
};
/** @param {chrome.windows.Window} _ */
const setupSavePosition = ({ id: curWndId, tabs }) => {
  if (tabs.length === 1) {
    const { onBoundsChanged } = chrome.windows;
    if (onBoundsChanged) {
      // triggered on moving/resizing, Chrome 86+
      onBoundsChanged.addListener(wnd => {
        if (wnd.id === curWndId) savePosition(wnd);
      });
    } else {
      // triggered on resizing only
      addEventListener('resize', debounce(savePosition, 100));
      shouldSavePositionOnSave = true;
    }
  }
};

let K_SAVE; // deduced from the current CodeMirror keymap
const K_PREV_PANEL = 'Alt-PageUp';
const K_NEXT_PANEL = 'Alt-PageDown';
const compareString = (a, b) => (a < b ? -1 : a > b);
/** @param {VMScript.Config} config */
const collectShouldUpdate = ({ shouldUpdate, _editable }) => (
  +shouldUpdate && (shouldUpdate + _editable)
);
const deepWatchScript = { handler: 'onChange', deep: true };

export default {
  props: ['initial', 'initialCode', 'readOnly'],
  components: {
    VmCode,
    VmSettings,
    VMSettingsUpdate,
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
      commands: {
        save: this.save,
        close: this.close,
        showHelp: () => {
          this.nav = 'help';
        },
      },
      hotkeys: null,
      errors: null,
      fatal: null,
      frozen: false,
      note: false,
      urlMatching: 'https://violentmonkey.github.io/api/matching/',
    };
  },
  computed: {
    navItems() {
      const { meta, props } = this.script;
      const req = meta.require.length && '@require';
      const res = !isEmpty(meta.resources) && '@resource';
      const size = store.storageSize;
      return {
        code: i18n('editNavCode'),
        settings: i18n('editNavSettings'),
        ...props.id && {
          values: i18n('editNavValues') + (size ? ` (${formatByteLength(size)})` : ''),
        },
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
      if (val === 'code') {
        this.$nextTick(() => {
          this.$refs.code.cm.focus();
        });
      }
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
    codeDirty: 'onDirty',
    script: 'onScript',
    'script.config': deepWatchScript,
    'script.custom': deepWatchScript,
  },
  created() {
    this.script = deepCopy(this.initial);
    this.toggleUnloadSentry = getUnloadSentry(null, () => {
      this.$refs.code.cm.focus();
    });
    if (options.get('editorWindow') && global.history.length === 1) {
      browser.windows?.getCurrent({ populate: true }).then(setupSavePosition);
    }
  },
  async mounted() {
    document.body.classList.add('edit-open');
    store.storageSize = 0;
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
      keyboardService.register(K_SAVE.replace(/(?:Ctrl|Cmd)-/i, 'ctrlcmd-'), this.save),
      keyboardService.register('escape', () => { this.nav = 'code'; }, {
        condition: '!tabCode',
      }),
    ];
    this.code = this.initialCode;
  },
  methods: {
    async save() {
      if (!this.canSave) return;
      if (shouldSavePositionOnSave) savePosition();
      const script = this.script;
      const { config, custom } = script;
      const { notifyUpdates } = config;
      const { noframes } = custom;
      let fatal;
      try {
        const codeComponent = this.$refs.code;
        const id = script.props.id;
        const res = await sendCmdDirectly('ParseScript', {
          id,
          code: codeComponent.getRealContent(),
          config: {
            notifyUpdates: notifyUpdates ? +notifyUpdates : null, // 0, 1, null
            shouldUpdate: collectShouldUpdate(config), // 0, 1, 2
          },
          custom: {
            ...objectPick(custom, Object.keys(CUSTOM_PROPS), toProp),
            ...objectPick(custom, CUSTOM_LISTS, toList),
            ...objectPick(custom, CUSTOM_ENUM, toEnum),
            noframes: noframes ? +noframes : null,
          },
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts,
          // otherwise the script with same namespace will be overridden
          isNew: !id,
          message: '',
        });
        const newId = res?.where?.id;
        codeComponent.cm.markClean();
        this.codeDirty = false; // triggers onDirty which sets canSave
        this.canSave = false; // ...and set it explicitly in case codeDirty was false
        this.note = false;
        this.errors = res.errors;
        this.script = res.update; // triggers onScript+onChange to handle the new `meta` and `props`
        if (newId && !id) history.replaceState(null, this.scriptName, `${ROUTE_SCRIPTS}/${newId}`);
      } catch (err) {
        fatal = err.message.split('\n');
      }
      this.fatal = fatal;
    },
    close(cm) {
      if (cm && this.nav !== 'code') {
        this.nav = 'code';
      } else {
        this.$emit('close');
        // FF doesn't emit `blur` when CodeMirror's textarea is removed
        if (IS_FIREFOX) document.activeElement?.blur();
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
    onChange(evt) {
      const { script } = this;
      const { config } = script;
      const { removed } = config;
      const remote = script._remote = !!getScriptUpdateUrl(script);
      const remoteMode = remote && collectShouldUpdate(config);
      const frozen = !!(removed || remoteMode === 1 || this.readOnly);
      this.frozen = frozen;
      this.note = !removed && (frozen || remoteMode >= 1);
      if (!removed && evt) this.onDirty();
    },
    onDirty() {
      this.canSave = this.codeDirty || !deepEqual(this.script, this.saved);
    },
    onScript(script) {
      const { custom, config } = script;
      const { shouldUpdate } = config;
      const { noframes } = custom;
      // Matching Vue model types, so deepEqual can work properly
      config._editable = shouldUpdate === 2;
      config.notifyUpdates == `${config.notifyUpdates ?? ''}`;
      config.shouldUpdate = !!shouldUpdate;
      custom.noframes = noframes == null ? '' : +noframes; // it was boolean in old VM
      // Adding placeholders for any missing values so deepEqual can work properly
      for (const key in CUSTOM_PROPS) {
        if (custom[key] == null) custom[key] = CUSTOM_PROPS[key];
      }
      for (const key of CUSTOM_ENUM) {
        if (!custom[key]) custom[key] = '';
      }
      for (const key of CUSTOM_LISTS) {
        const val = custom[key];
        // Adding a new row so the user can click it and type, just like in an empty textarea.
        custom[key] = val ? `${val.join('\n')}${val.length ? '\n' : ''}` : '';
      }
      this.onChange();
      if (!config.removed) this.saved = deepCopy(script);
    }
  },
  beforeUnmount() {
    document.body.classList.remove('edit-open');
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
  --border: 1px solid var(--fill-3);
  z-index: 2000;
  &-header {
    position: sticky;
    top: 0;
    z-index: 1;
    align-items: center;
    justify-content: space-between;
    border-bottom: var(--border);
    background: inherit;
  }
  &-name {
    font-weight: bold;
  }
  &-body {
    padding: .5rem 1rem;
    // overflow: auto;
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
  .edit-externals {
    --border: 0;
    .select {
      padding-top: 0.5em;
      @media (max-width: 1599px) {
        resize: vertical;
        &[style*=height] {
          max-height: 80%;
        }
        &[style*=width] {
          width: auto !important;
        }
      }
    }
    @media (min-width: 1600px) {
      flex-direction: row;
      .select {
        resize: horizontal;
        min-width: 15em;
        width: 30%;
        max-height: none;
        border-bottom: none;
        &[style*=height] {
          height: auto !important;
        }
        &[style*=width] {
          max-width: 80%;
        }
      }
    }
  }
  .errors {
    --border: none;
    border-top: 2px solid red;
  }
  .fatal {
    background: firebrick;
    color: white;
  }
  .frozen-note {
    background: var(--bg);
  }
  .shelf {
    padding: .5em 1em;
    border-bottom: var(--border);
  }
  &.readOnly &-header button:nth-last-child(n + 2) {
    display: none;
  }
  &.frozen .CodeMirror {
    background: var(--fill-0-5);
  }
}

@media (max-width: 767px) {
  .edit-hint {
    display: none;
  }
  .edit {
    // fixed/absolute doesn't work well with scroll in Firefox Android
    position: static;
    // larger than 100vh to force overflow so that the toolbar can be hidden in Firefox Android
    min-height: calc(100vh + 1px);
  }
}

@media (max-width: 500px) {
  .edit-name {
    display: none;
  }
}
</style>
