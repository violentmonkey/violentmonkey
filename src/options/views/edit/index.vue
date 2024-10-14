<template>
  <div class="edit frame flex flex-col abs-full" :class="{frozen}">
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
      <p v-if="frozen && nav === 'code'" v-text="i18n('readonly')"
         class="text-upper text-right text-red"/>
      <div v-else class="edit-hint text-right ellipsis">
        <a :href="externalEditorInfoUrl"
           v-bind="EXTERNAL_LINK_PROPS"
           v-text="i18n('editHowToHint')"/>
      </div>
      <div class="mr-1">
        <button v-text="i18n('buttonSave')" @click="save"
                v-show="canSave || !frozen" :disabled="!canSave"
                :class="{'has-error': $fe = fatal || errors}" :title="$fe"/>
        <button v-text="i18n('buttonSaveClose')" @click="saveClose"
                v-show="canSave || !frozen" :disabled="!canSave"/>
        <button v-text="i18n('buttonClose')" @click="close(true)" title="Esc"/>
      </div>
    </div>

    <div class="frozen-note shelf mr-2c flex flex-wrap" v-if="frozenNote && nav === 'code'">
      <p v-text="i18n('readonlyNote')"/>
      <keep-alive>
        <VMSettingsUpdate class="flex ml-2c" :script/>
      </keep-alive>
    </div>

    <p v-if="fatal" class="shelf fatal">
      <b v-text="fatal[0]"/>
      {{fatal[1]}}
    </p>

    <vm-code
      class="flex-auto"
      :class="{ readonly: frozen }"
      :value="code"
      :readOnly="frozen"
      ref="$code"
      v-show="nav === 'code'"
      :active="nav === 'code'"
      :commands
      @code-dirty="codeDirty = $event"
    />
    <keep-alive ref="$tabBody">
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
      :hotkeys
    />
    </keep-alive>

    <div v-if="errors || hashPattern" class="errors shelf my-1c">
      <locale-group v-if="hashPattern" i18n-key="hashPatternWarning">
        <code v-text="hashPattern"/>
      </locale-group>
      <p v-for="e in errors" :key="e" v-text="e" class="text-red"/>
      <template v-if="errors">
        <p class="my-1" v-for="url in errorsLinks" :key="url">
          <a :href="url" v-bind="EXTERNAL_LINK_PROPS" v-text="url"/>
        </p>
      </template>
    </div>
  </div>
</template>

<script>
import {
  browserWindows,
  debounce, formatByteLength, getScriptName, getScriptUpdateUrl, i18n, isEmpty,
  nullBool2string, sendCmdDirectly, trueJoin,
} from '@/common';
import { ERR_BAD_PATTERN, VM_DOCS_MATCHING, VM_HOME } from '@/common/consts';
import { deepCopy, deepEqual, objectPick } from '@/common/object';
import { externalEditorInfoUrl, focusMe, getActiveElement, showMessage } from '@/common/ui';
import { keyboardService } from '@/common/keyboard';
import options from '@/common/options';
import { getUnloadSentry } from '@/common/router';
import { EXTERNAL_LINK_PROPS } from '@/common/ui';
import {
  kDownloadURL, kExclude, kExcludeMatch, kHomepageURL, kIcon, kInclude, kMatch, kName, kOrigExclude, kOrigExcludeMatch,
  kOrigInclude, kOrigMatch, kUpdateURL,
} from '../../utils';

const CUSTOM_PROPS = {
  [kName]: '',
  [kHomepageURL]: '',
  [kUpdateURL]: '',
  [kDownloadURL]: '',
  [kIcon]: '',
  [kOrigInclude]: true,
  [kOrigExclude]: true,
  [kOrigMatch]: true,
  [kOrigExcludeMatch]: true,
  tags: '',
};
const toProp = val => val !== '' ? val : null; // `null` removes the prop from script object
const CUSTOM_LISTS = [
  kInclude,
  kMatch,
  kExclude,
  kExcludeMatch,
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
const K_PREV_PANEL = 'Alt-PageUp';
const K_NEXT_PANEL = 'Alt-PageDown';
const compareString = (a, b) => (a < b ? -1 : a > b);
/** @param {VMScript.Config} config */
const collectShouldUpdate = ({ shouldUpdate, _editable }) => (
  +shouldUpdate && (shouldUpdate + _editable)
);
const extractLine = (str, pos) => {
  if (pos >= 0) {
    const i = str.lastIndexOf('\n', pos) + 1;
    const j = str.indexOf('\n', pos);
    return str.slice(i, j > 0 ? j : undefined);
  }
};
const reHASH = /#/;
</script>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch } from 'vue';
import VmCode from '@/common/ui/code';
import VmExternals from '@/common/ui/externals';
import LocaleGroup from '@/common/ui/locale-group';
import { inferSaveHotKey, K_SAVE, kStorageSize, store } from '../../utils';
import VmSettings from './settings';
import VMSettingsUpdate from './settings-update';
import VmValues from './values';
import VmHelp from './help';

let CM;
let $codeComp;
let disposeList;
let savedCopy;
let shouldSavePositionOnSave;
let toggleUnloadSentry;

const emit = defineEmits(['close']);
const props = defineProps({
  /** @type {VMScript} */
  initial: Object,
  initialCode: String,
  readOnly: Boolean,
});

const $code = ref();
const $tabBody = ref();
const nav = ref('code');
const canSave = ref(false);
const script = ref();
const code = ref('');
const codeDirty = ref(false);
const commands = {
  save,
  close,
};
const hotkeys = ref();
const errors = ref();
const errorsLinks = computed(() => {
  let patterns = 0;
  const errorsValue = errors.value;
  for (const e of errorsValue) if (e.startsWith(ERR_BAD_PATTERN)) patterns++;
  return [
    patterns < errorsValue.length && `${VM_HOME}api/metadata-block/`,
    patterns && VM_DOCS_MATCHING,
  ].filter(Boolean);
});
const hashPattern = computed(() => { // eslint-disable-line vue/return-in-computed-property
  for (const sectionKey of ['meta', 'custom']) {
    for (const key of CUSTOM_LISTS) {
      let val = script.value[sectionKey][key];
      if (val && (
        isObject(val)
          ? val = val.find(reHASH.test, reHASH)
          : val = extractLine(val, val.indexOf('#'), 100)
      )) {
        return val.length > 100 ? val.slice(0, 100) + '...' : val;
      }
    }
  }
});
const fatal = ref();
const frozen = ref(false);
const frozenNote = ref(false);

const navItems = computed(() => {
  const { meta, props: { id }, $cache = {} } = script.value;
  const req = meta.require.length && '@require';
  const res = !isEmpty(meta.resources) && '@resource';
  const size = $cache[kStorageSize];
  return {
    code: i18n('editNavCode'),
    settings: i18n('editNavSettings'),
    ...id && {
      values: i18n('editNavValues') + (size ? ` (${formatByteLength(size)})` : ''),
    },
    ...(req || res) && { externals: [req, res]::trueJoin('/') },
    help: '?',
  };
});
const scriptName = computed(() => (store.title = getScriptName(script.value)));

watch(nav, async val => {
  await nextTick();
  if (val === 'code') CM.focus();
  else focusMe($tabBody.value.$el);
}, { immediate: true });
watch(canSave, val => {
  toggleUnloadSentry(val);
  keyboardService.setContext('canSave', val);
});
watch(codeDirty, onDirty);
watch(script, onScript);

{
  // The eslint rule is bugged as this is a block scope, not a global scope.
  const src = props.initial;
  const initialCode = code.value = props.initialCode;
  script.value = deepCopy(src);
  sendCmdDirectly('ParseMetaErrors', initialCode).then(res => {
    errors.value = res;
  });
  watch(() => script.value.config, onChange, { deep: true });
  watch(() => script.value.custom, onChange, { deep: true });
  watch(() => src.error, error => {
    // usually errors for resources
    if (error) showMessage({ text: `${src.message}\n\n${error}` });
  });
  watch(() => src.config.enabled, val => {
    // script was toggled externally in the popup/dashboard/sync
    script.value.config.enabled = val;
    if (savedCopy) savedCopy.config.enabled = val;
  });
}

onMounted(() => {
  $codeComp = $code.value;
  CM = $codeComp.cm;
  toggleUnloadSentry = getUnloadSentry(null, () => CM.focus());
  if (options.get('editorWindow') && global.history.length === 1) {
    browser.windows?.getCurrent({ populate: true }).then(setupSavePosition);
  }
  // hotkeys
  const navLabels = Object.values(navItems.value);
  const hk = hotkeys.value = [
    [K_PREV_PANEL, ` ${navLabels.join(' < ')}`],
    [K_NEXT_PANEL, ` ${navLabels.join(' > ')}`],
    ...Object.entries($codeComp.expandKeyMap())
    .sort((a, b) => compareString(a[1], b[1]) || compareString(a[0], b[0])),
  ];
  if (!K_SAVE) inferSaveHotKey(hk);
});

onActivated(() => {
  document.body.classList.add('edit-open');
  disposeList = [
    keyboardService.register('a-pageup', switchPrevPanel),
    keyboardService.register('a-pagedown', switchNextPanel),
    keyboardService.register(K_SAVE.replace(/(?:Ctrl|Cmd)-/i, 'ctrlcmd-'), save),
    keyboardService.register('escape', close),
    keyboardService.register('f1', () => { nav.value = 'help'; }),
  ];
  store.title = scriptName.value;
});

onDeactivated(() => {
  document.body.classList.remove('edit-open');
  store.title = null;
  toggleUnloadSentry(false);
  disposeList?.forEach(dispose => dispose());
});

async function save() {
  if (!canSave.value) return;
  if (shouldSavePositionOnSave) savePosition();
  const scr = script.value;
  const { config, custom } = scr;
  const { notifyUpdates } = config;
  const { noframes } = custom;
  try {
    const id = scr.props.id;
    const res = await sendCmdDirectly('ParseScript', {
      id,
      code: $codeComp.getRealContent(),
      config: {
        enabled: +config.enabled,
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
      bumpDate: true,
    });
    const newId = res?.where?.id;
    CM.markClean();
    codeDirty.value = false; // triggers onDirty which sets canSave
    canSave.value = false; // ...and set it explicitly in case codeDirty was false
    frozenNote.value = false;
    errors.value = res.errors;
    script.value = res.update; // triggers onScript+onChange to handle the new `meta` and `props`
    if (newId && !id) history.replaceState(null, scriptName.value, `${ROUTE_SCRIPTS}/${newId}`);
    fatal.value = null;
  } catch (err) {
    fatal.value = err.message.split('\n');
  }
}
function close(entirely) {
  if (!entirely && nav.value !== 'code') {
    nav.value = 'code';
  } else {
    emit('close');
    // FF doesn't emit `blur` when CodeMirror's textarea is removed
    if (IS_FIREFOX) getActiveElement()?.blur();
  }
}
async function saveClose() {
  await save();
  close(true);
}
function switchPanel(step) {
  const keys = Object.keys(navItems.value);
  nav.value = keys[(keys.indexOf(nav.value) + step + keys.length) % keys.length];
}
function switchPrevPanel() {
  switchPanel(-1);
}
function switchNextPanel() {
  switchPanel(1);
}
function onChange(evt) {
  const scr = script.value;
  const { config } = scr;
  const { removed } = config;
  const remote = scr._remote = !!getScriptUpdateUrl(scr);
  const remoteMode = remote && collectShouldUpdate(config);
  const fz = !!(removed || remoteMode === 1 || props.readOnly);
  frozen.value = fz;
  frozenNote.value = !removed && (fz || remoteMode >= 1);
  if (!removed && evt) onDirty();
}
function onDirty() {
  canSave.value = codeDirty.value || !deepEqual(script.value, savedCopy);
}
function onScript(scr) {
  const { custom, config } = scr;
  const { shouldUpdate } = config;
  // Matching Vue model types, so deepEqual can work properly
  config._editable = shouldUpdate === 2;
  config.enabled = !!config.enabled;
  config.shouldUpdate = !!shouldUpdate;
  config.notifyUpdates = nullBool2string(config.notifyUpdates);
  custom.noframes = nullBool2string(custom.noframes);
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
  onChange();
  if (!config.removed) savedCopy = deepCopy(scr);
}
/** @param {chrome.windows.Window} [wnd] */
async function savePosition(wnd) {
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
}

/** @param {chrome.windows.Window} _ */
function setupSavePosition({ id: curWndId, tabs }) {
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
}
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
    background: var(--bg);
    flex: 1;
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
  .readonly {
    opacity: .75; /* opacity plays well with custom editor colors */
  }
}

.touch body {
  position: relative;
  /*
   * Set height to 1px larger than screen height to force overflow so that the toolbar can be hidden in Firefox Android.
   * Use `100vh` (largest possible viewport) to avoid flashing caused by URL bar resizing.
   * See https://developer.chrome.com/blog/url-bar-resizing
   */
  min-height: calc(100vh + 1px);
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
