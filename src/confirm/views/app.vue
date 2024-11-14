<template>
  <div class="page-confirm frame flex flex-col h-screen" :class="{ reinstall }">
    <div v-if="info.fs" id="wall">
      <b v-text="info.fs[0]"/>
      <ol>
        <li v-for="(str, i) in info.fs.slice(1)" :key="i" v-text="str" class="mt-1"/>
      </ol>
      <hr>
      <a class="mt-1" :href="externalEditorInfoUrl" v-text="externalEditorInfoUrl"/>
      <hr>
      <setting-check name="helpForLocalFile" :label="i18n('helpForLocalFile')"/>
    </div>
    <template v-else>
    <div class="frame-block">
      <div class="flex">
        <div class="image">
          <img src="/public/images/icon128.png">
        </div>
        <div class="info">
          <h1>
            <div>
              <span v-text="heading"/>
              <span v-text="i18n('msgSameCode')" style="font-weight:normal" v-if="sameCode"/>
            </div>
            <div class="ellipsis" v-text="scriptName"/>
          </h1>
          <div class="flex">
            <tooltip :content="i18n('editNavCode')" class="abs-center" placement="right">
              <icon name="code"/>
            </tooltip>
            <span class="ellipsis" v-text="info.url ? decodeURIComponent(info.url) : '...'"/>
          </div>
          <a v-for="([url, icon, title]) in icons" :key="icon"
             class="flex" target="_blank" :href="url">
            <tooltip :content="title" class="abs-center" placement="right">
              <icon :name="icon"/>
            </tooltip>
            <span class="ellipsis" v-text="decodeURIComponent(url)"/>
          </a>
          <p class="descr" v-text="descr"/>
          <div class="lists flex flex-wrap" :data-collapsed="!listsShown">
            <div class="toggle abs-center" @click="listsShown = !listsShown">
              <tooltip :content="i18n('msgShowHide')" placement="bottom" align="left" v-if="lists">
                <icon name="info"/>
              </tooltip>
            </div>
            <dl v-for="(list, name) in lists" :key="name"
                :data-type="name" :hidden="!list.length" tabindex="0">
              <dt v-text="name ? `@${name}` : i18n('genericError')"/>
              <dd v-text="list" class="ellipsis"/>
            </dl>
          </div>
          <div v-if="!script && message" v-text="message" class="warning"/>
        </div>
      </div>
      <div class="flex" v-if="script">
        <div class="image flex">
          <img :src="safeIcon">
        </div>
        <div class="actions flex flex-wrap ml-1c" ref="$buttons">
          <button
            id="confirm"
            :data-hotkey="hotkey[0]"
            v-text="_verb = reinstall ? i18n('reinstall') : i18n('install')"
            v-bind="_bind = {disabled: !installable, onclick: installScript}"/>
          <button
              id="+close" :data-verb="_verb" :data-hotkey="hotkey.close"
              v-text="i18n('buttonClose')" v-bind="_bind"/>
          <setting-check
              name="closeAfterInstall" ref="$close" class="btn-ghost"
              :class="{dim: hotkey.track || hotkey.edit}"
              :title="labelDefault"/>
          <button
              id="+edit" :data-verb="_verb" :data-hotkey="hotkey.edit"
              v-text="i18n('buttonEdit')" v-bind="_bind"/>
          <setting-check
              name="editAfterInstall" ref="$edit" class="btn-ghost"
              :title="labelDefault" :class="{dim: hotkey.track}"/>
          <template v-if="isLocal">
            <button id="+track" @click="installScript"
                    :data-hotkey="hotkey.track"
                    :disabled="!tracking && !installable && !installed"
                    v-text="tracking ? i18n('stopTracking') : `✚ ${i18n('trackEdits')}`"/>
            <setting-check
                name="trackLocalFile" ref="$track" class="btn-ghost" v-show="!tracking"
                @change="trackLocalFile" :title="labelDefault"/>
            <tooltip :content="i18n('reloadTabTrackHint')" v-show="tracking">
              <label class="setting-check">
                <input type="checkbox" v-model="reloadTab">
                <span v-text="i18n('reloadTab')" />
              </label>
            </tooltip>
          </template>
          <button v-text="i18n('buttonClose')" @click="closeTab"/>
          <div v-text="message" v-if="message" :title="error"
               class="status stretch-self flex center-items ml-2"/>
        </div>
      </div>
      <div class="warning" v-if="info.incognito" v-text="i18n('msgIncognitoChanges')"/>
    </div>
    <div class="frame-block flex-1 pos-rel">
      <vm-externals
        ref="$externals"
        v-if="script"
        :value="script"
        class="abs-full"
        :cm-options="cmOptions"
        :commands
        :install="{ code, deps, url: info.url }"
      />
    </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Tooltip from 'vueleton/lib/tooltip';
import Icon from '@/common/ui/icon';
import {
  debounce, getFullUrl, getLocaleString, getScriptHome, i18n, isRemote, makePause, sendCmdDirectly,
  trueJoin,
} from '@/common';
import { keyboardService, modifiers } from '@/common/keyboard';
import initCache from '@/common/cache';
import VmExternals from '@/common/ui/externals';
import SettingCheck from '@/common/ui/setting-check';
import { loadScriptIcon } from '@/common/load-script-icon';
import { deepEqual, objectPick } from '@/common/object';
import { route } from '@/common/router';
import { externalEditorInfoUrl } from '@/common/ui';

const KEEP_INFO_DELAY = 5000;
const RETRY_DELAY = 3000;
const RETRY_COUNT = 2;
const MAX_TITLE_NAME_LEN = 100;
const CONFIRM_HOTKEY = `${modifiers.ctrlcmd === 'm' ? '⌘' : 'Ctrl-'}Enter`;
const DROP_PREFIX = `file:///*drag-n-drop*/`;
const cache = initCache({ lifetime: RETRY_DELAY * (RETRY_COUNT + 1) });
const labelDefault = i18n('labelRunAtDefault');

const $buttons = ref();
const $close = ref();
const $edit = ref();
const $track = ref();
const $externals = ref();

const cmOptions = ref({ lineWrapping: true });
const code = ref('');
const commands = ref({ close: closeTab });
const deps = ref({}); // combines `require` and `resources` i.e. all actually loaded deps
const descr = ref('');
const error = ref();
const heading = ref(i18n('msgLoadingData'));
const info = ref(/** @type {VM.ConfirmCache} */{});
const installable = ref(false);
const installed = ref(false);
const isLocal = computed(() => !isRemote(info.value.url));
const lists = ref();
const listsShown = ref(true);
const message = ref('');
const scriptName = ref('\xA0');
const reinstall = ref(false);
const reloadTab = ref(false);
const safeIcon = ref();
const sameCode = ref(false);
const script = ref();
const tracking = ref(false);

const hotkey = computed(() => ({
  [isLocal.value && $track.value?.value ? 'track'
    : $edit.value?.value ? 'edit'
    : $close.value?.value ? 'close'
    : 0
  ]: CONFIRM_HOTKEY
}));
const icons = computed(() => {
  const scr = script.value;
  const homepageURL = scr && getScriptHome(scr);
  const supportURL = scr?.meta.supportURL;
  return [
    homepageURL && [homepageURL, 'home', i18n('labelHomepage')],
    supportURL && [supportURL, 'question', i18n('buttonSupport')],
  ].filter(Boolean);
});

/** @type {FileSystemFileHandle} */
let fileHandle;
/** @type {FileSystemObserver | false} */
let fso;
/** @type {chrome.runtime.Port} */
let filePort;
let filePortResolve;
/** @type {boolean} */
let filePortNeeded;
let basicTitle;
let cachedCodePromise;
let stopResolve;
let confirmedTime;
let disposeList;
let guard;
/** @type {VM.ConfirmCache} */
let infoVal;
let requireCache, requireUrls;
let resourceCache, resourceUrls;
let trackingPromise;

onMounted(async () => {
  const id = route.paths[0];
  const key = `confirm-${id}`;
  const FSH = 'fsh';
  fileHandle = window[FSH];
  Object.defineProperty(window, FSH, { set: loadNewFileHandle });
  infoVal = info.value = fileHandle
    ? { url: fileHandle._url || DROP_PREFIX + fileHandle.name }
    : await sendCmdDirectly('CacheLoad', key);
  if (!infoVal) {
    closeTab();
    return;
  }
  if (infoVal.fs) {
    info.value.fs = i18n('fileInstallBlocked').split(/<\d+>/);
    return;
  }
  if (!fileHandle) {
    filePortNeeded = infoVal.ff >= 68 && infoVal.url.startsWith('file:');
    cachedCodePromise = sendCmdDirectly('CachePop', infoVal.url);
    guard = setInterval(sendCmdDirectly, KEEP_INFO_DELAY, 'CacheHit', { key });
  }
  await initScript();
  initKeys();
});

async function initScript() {
  await loadData();
  if (!await parseMeta()) return;
  await Promise.all([
    checkSameCode(),
    (async () => {
      let retries = RETRY_COUNT;
      while (!await loadDeps() && retries) {
        await makePause(RETRY_DELAY);
        retries -= 1;
      }
    })(),
  ]);
  if (installable.value) {
    heading.value = reinstall.value ? i18n('labelReinstall') : i18n('labelInstall');
  }
}
function initKeys() {
  disposeList = [
    keyboardService.register('ctrlcmd-enter', () => {
      $buttons.value.querySelector('[data-hotkey]').click();
    }),
  ];
  keyboardService.enable();
}

onBeforeUnmount(() => {
  clearInterval(guard);
  disposeList?.forEach(dispose => dispose());
});

async function loadNewFileHandle(fh) {
  info.value.fs = installable.value = tracking.value = false;
  stopResolve?.();
  await trackingPromise;
  await nextTick();
  fileHandle = fh;
  infoVal = info.value = { url: fh._url || DROP_PREFIX + fh.name };
  error.value = safeIcon.value = message.value = requireCache = resourceCache = null;
  await initScript();
  if (!disposeList) initKeys();
}
async function loadData(changedOnly) {
  installable.value = false;
  const newCode = filePortNeeded
    ? await new Promise(pingFilePort)
    : await getScript(infoVal.url);
  if (newCode == null || changedOnly && code.value === newCode) {
    throw 0;
  }
  const cm = $externals.value?.$code.cm;
  const lines = cm && newCode.split(/\r?\n/);
  let i = -1;
  let isDiff;
  cm?.eachLine(({ text }) => (isDiff = text !== lines[++i]));
  code.value = newCode;
  if (isDiff || cm && i < lines.length - 1) {
    await nextTick();
    cm.setCursor(i);
    cm.scrollIntoView(null, cm.display.lastWrapHeight / 3);
  }
}
async function parseMeta() {
  const res = await sendCmdDirectly('ParseMeta', code.value);
  const { meta, errors } = res;
  const name = getLocaleString(meta, 'name');
  document.title = `${
    name.slice(0, MAX_TITLE_NAME_LEN) || errors[0] // no name error
  }${
    name.length > MAX_TITLE_NAME_LEN ? '...' : ''
  } - ${
    basicTitle || (basicTitle = document.title)
  }`;
  scriptName.value = [name, meta.version]::trueJoin(', ');
  descr.value = getLocaleString(meta, 'description');
  lists.value = Object.assign(
    !meta ? {} : objectPick(meta, [
      'antifeature',
      'grant',
      'match',
      'include',
      'exclude',
      'excludeMatch',
      'compatible',
      'connect',
    ], list => list?.map(s => [s.replace(/^\W+/, '') || s, s])
      .sort(([a], [b]) => (a < b ? -1 : a > b))
      .map(([, s]) => s)
      .join('\n')
      || ''
    ), {
      '': errors?.join('\n') || '',
    });
  // Creating a script even if meta is invalid to show the code to the user.
  script.value = { meta: meta || {}, custom: {}, props: {} };
  if (meta) {
    requireUrls = [...new Set(meta.require)];
    resourceUrls = [...new Set(Object.values(meta.resources))];
  }
  if (!name) heading.value = i18n('msgInvalidScript');
  else return res;
}
async function loadDeps() {
  if (!safeIcon.value) {
    loadScriptIcon(script.value).then(url => { safeIcon.value = url; });
  }
  if (requireCache
  && deepEqual([...requireUrls].sort(), Object.keys(requireCache).sort())
  && deepEqual([...resourceUrls].sort(), Object.keys(resourceCache).sort())) {
    return;
  }
  requireCache = {};
  resourceCache = {};
  let finished = 0;
  const length = requireUrls.length + resourceUrls.length;
  // All resources may finish quickly so we delay the status to avoid flicker
  const STATUS_DELAY = 500;
  const startTime = performance.now();
  const updateStatus = () => {
    if (performance.now() - startTime > STATUS_DELAY) {
      message.value = i18n('msgLoadingDependency', [finished, length]);
    }
  };
  /** @returns {string|undefined} URL in case of error or `undefined` on success */
  const download = async (url, target, isBlob) => {
    const fullUrl = getFullUrl(url, infoVal.url);
    const depsUrl = `${+isBlob}${url}`; // the same URL may be listed in both categories
    try {
      deps.value[depsUrl] = target[fullUrl] = await getFile(fullUrl, { isBlob, useCache: true });
      finished += 1;
      updateStatus();
    } catch (e) {
      deps.value[depsUrl] = false;
      return url;
    }
  };
  const delayedStatus = setTimeout(updateStatus, STATUS_DELAY);
  const promises = [
    ...requireUrls.map(url => download(url, requireCache, false)),
    ...resourceUrls.map(url => download(url, resourceCache, true)),
  ];
  const err = (await Promise.all(promises))::trueJoin('\n');
  clearTimeout(delayedStatus);
  if (err) {
    message.value = i18n('msgErrorLoadingDependency');
    error.value = err;
  } else {
    error.value = null;
    installable.value = true;
    message.value = null;
    return true;
  }
}
function closeTab() {
  sendCmdDirectly('TabClose');
}
async function getFile(url, opts) {
  const { isBlob, useCache } = opts || {};
  const cacheKey = isBlob ? `blob+${url}` : `text+${url}`;
  if (useCache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const { data } = await sendCmdDirectly('Request', {
    url,
    vet: !!opts, // TODO: add a blacklist for installation URLs?
    [kResponseType]: isBlob ? 'blob' : null,
  });
  if (useCache) cache.put(cacheKey, data);
  return data;
}
async function getScript(url) {
  try {
    return fileHandle
      ? await (await fileHandle.getFile()).text()
      : cachedCodePromise && await cachedCodePromise || await getFile(url);
  } catch (e) {
    // eslint-disable-next-line no-ex-assign
    if ((e = e.message)?.startsWith('{')) try { e = 'HTTP ' + JSON.parse(e).status; } catch {/**/}
    message.value = i18n('msgErrorLoadingData') + (e ? '\n' + e : '');
  } finally {
    cachedCodePromise = null;
  }
}
async function installScript(evt, parsedMeta) {
  const btnId = evt?.target.id;
  if (btnId === '+track' && tracking.value) {
    stopResolve?.(true);
    return;
  }
  installable.value = false;
  try {
    const { update } = await sendCmdDirectly('ParseScript', {
      ...parsedMeta,
      code: code.value,
      url: infoVal.url,
      from: infoVal.from,
      require: requireCache,
      cache: resourceCache,
      reloadTab: reloadTab.value,
      reuseDeps: !!confirmedTime,
      bumpDate: true,
    });
    const time = new Date().toLocaleTimeString(['fr']);
    const time0 = confirmedTime || (confirmedTime = time);
    message.value = `${update.message} ${time0}${time0 === time ? '' : ` --> ${time}`}`;
    installed.value = true;
    if (btnId === '+track') {
      message.value = i18n('trackEditsNote')
        + (infoVal.ff >= 68 ? ' ' + i18n('installOptionTrackTooltip') : '');
      trackLocalFile();
    } else if (btnId === '+edit') {
      location.href = extensionOptionsPage + ROUTE_SCRIPTS + '/' + update.props.id;
    } else if (btnId === '+close') {
      closeTab();
    }
  } catch (err) {
    message.value = `${err}`;
    installable.value = true;
  }
}
async function trackLocalFile() {
  if (tracking.value || !isLocal.value || !installed.value) {
    return;
  }
  cachedCodePromise = null; // always re-read because the file may have changed since then
  tracking.value = true;
  if (fileHandle && fso == null && (fso = global.FileSystemObserver || false)) {
    fso = new fso(debounce(onFileChanged, 20)); // one write to a file produces several calls
  }
  if (fso) {
    try {
      await fso.observe(fileHandle);
    } catch (err) {
      fso = null;
    }
  }
  while (tracking.value) {
    trackingPromise = new Promise(cb => { stopResolve = cb; });
    if (await (fso ? trackingPromise : Promise.race([makePause(500), trackingPromise]))) {
      break;
    }
    await onFileChanged();
    stopResolve();
  }
  if (fso) fso.disconnect();
  trackingPromise = tracking.value = false;
}
async function onFileChanged() {
  try {
    await loadData(true);
    const parsedMeta = await parseMeta();
    await loadDeps();
    await installScript(null, parsedMeta);
    sameCode.value = false;
  } catch (e) { /* NOP */ }
}
async function checkSameCode() {
  const { name, namespace } = script.value.meta || {};
  const old = await sendCmdDirectly('GetScript', { meta: { name, namespace } });
  reinstall.value = !!old;
  sameCode.value = old && code.value === await sendCmdDirectly('GetScriptCode', old.props.id);
}
function createFilePort() {
  filePort = browser.tabs.connect(infoVal.tabId, { name: 'FetchSelf' });
  // DANGER! Don't use filePortResolve directly as it perpetually changes
  filePort.onMessage.addListener(val => filePortResolve(val));
  filePort.onDisconnect.addListener(() => {
    stopResolve?.(true);
    filePort = null;
  });
}
function pingFilePort(resolve) {
  filePortResolve = resolve;
  if (!filePort) createFilePort();
  filePort.postMessage(null);
}
</script>

<style>
$imgSize: 48px;
$imgGapR: 14px;
$infoIconSize: 18px;
// TODO: fix PostCSS calc() which doesn't work here
$vertLayoutThreshold: 1801px;
$vertLayoutThresholdMinus1: 1800px;

.page-confirm {
  --btn-bg: #d4e2d4;
  --btn: darkgreen;
  --btn-border: #75a775;
  --btn-border-hover: #488148;
  h1 {
    line-height: 1.3;
    margin: .25rem 0;
  }
  a:not(:hover) {
    color: unset;
    text-decoration: none;
  }
  p {
    margin-top: 1rem;
  }
  .self-start {
    align-self: flex-start;
  }
  .image {
    flex: 0 0 $imgSize;
    align-items: center;
    justify-content: center;
    height: $imgSize; // reserve the height so it doesn't shift when the icon loads
    padding: 0 $imgGapR 0 .25rem;
    box-sizing: content-box;
    img {
      max-width: 100%;
      max-height: 100%;
    }
  }
  .info {
    overflow: hidden;
    .descr {
      max-height: 4rem;
      overflow-y: auto;
    }
    .abs-center {
      position: absolute;
      margin-left: calc(-1 * $imgSize / 2 - $infoIconSize / 2 - $imgGapR);
      cursor: pointer;
    }
  }
  .icon {
    width: $infoIconSize;
    height: $infoIconSize;
  }
  .lists {
    margin-top: 1rem;
    dl {
      margin: 0 1rem 1rem 0;
      &[data-type="antifeature"] dd {
        border: 1px solid rgba(255, 0, 0, .5);
        background: rgba(255, 0, 0, .05);
        padding: 2px 6px;
        max-width: 25em;
      }
      &[data-type=""] {
        color: red;
      }
    }
    dt {
      font-weight: bold;
    }
    dd {
      white-space: pre-wrap;
      min-width: 5rem;
      max-height: 10vh;
      min-height: 1.5rem;
      overflow-y: auto;
      overflow-wrap: anywhere;
    }
  }
  [data-collapsed="true"] {
    dd {
      display: none;
    }
    @media (max-width: $vertLayoutThresholdMinus1) {
      dl:focus dd {
        display: flex;
        position: absolute;
        max-height: 50vh;
        z-index: 100;
        background: var(--fill-0-5);
        box-shadow: 1px 3px 9px rgba(128, 128, 128, .5);
        padding: .5rem;
      }
    }
    dt {
      cursor: pointer;
    }
    .toggle {
      opacity: .3;
    }
  }
  .dim {
    opacity: .4
  }
  .actions {
    align-items: center;
    label {
      align-items: center;
    }
    .status {
      border-left: 5px solid darkorange;
      padding: 0 .5em;
      color: #d33a00;
      animation: fade-in .5s 1 both;
    }
    .btn-ghost {
      display: block;
      padding: 0 2px 0 4px;
      accent-color: var(--btn);
      border-color: var(--btn-border);
      background: var(--btn-bg);
      margin-left: -1px;
      input {
        cursor: pointer;
        position: relative;
        &:not(:checked) {
          opacity: .6;
        }
        @supports not (-moz-appearance: none) { /* Chrome */
          top: 1px;
        }
      }
    }
  }
  .warning {
    white-space: pre-line;
    padding: .25em 0;
    color: red;
  }
  button[id] {
    background: var(--btn-bg);
    border-color: var(--btn-border);
    color: var(--btn);
    &:hover {
      border-color: var(--btn-border-hover);
    }
  }
  [data-verb]:not([data-hotkey])::before {
    content: "✚ ";
  }
  [data-hotkey] {
    font-weight: bold;
    &[data-verb]::before {
      content: attr(data-verb) " + ";
    }
    &::after {
      content: "\a0(" attr(data-hotkey) ")";
      opacity: .75;
      font-weight: normal;
    }
  }
  &.reinstall {
    --btn-bg: #d1e0ea;
    --btn-border: #6699ce;
    --btn: #004fc5;
    --btn-border-hover: #35699f;
  }
  @media (prefers-color-scheme: dark) {
    .warning {
      color: orange;
    }
    &:not(.reinstall) {
      --btn-bg: #3a5d3a;
      --btn-border: #598059;
      --btn: #9cd89c;
      --btn-border-hover: #80a980;
    }
    &.reinstall {
      --btn-bg: #224a73;
      --btn-border: #3d6996;
      --btn: #9fcdfd;
      --btn-border-hover: #608cb8;
    }
    .actions {
      .status {
        color: darkorange;
      }
    }
  }
  .edit-externals .select {
    resize: vertical;
    &[style] {
      max-height: 80%;
    }
  }
  #wall {
    padding: 2rem;
  }
  @media (max-width: 1599px) {
    >:first-child {
      min-height: 5em;
      max-height: 80vh;
      width: auto !important; // resetting the inline style attribute if the user resized it
      resize: vertical;
      overflow-y: auto;
    }
  }
  @media (min-width: $vertLayoutThreshold) {
    flex-direction: row;
    >:first-child {
      min-width: 30em;
      max-width: 80%;
      width: 40%;
      height: auto !important; // resetting the inline style attribute if the user resized it
      resize: horizontal;
      overflow: hidden;
    }
    .info .descr {
      max-height: 20vh;
    }
    .lists {
      overflow-y: auto;
      max-height: 75vh;
    }
    .lists dd {
      max-height: 30vh;
      display: block;
    }
    .edit-externals {
      border-top: none;
      border-left: var(--border);
    }
  }
}
.confirm-options {
  label {
    display: block;
  }
  .vl-dropdown-menu {
    width: 13rem;
  }
}
.vl-tooltip-bottom {
  > i {
    margin-left: 10px;
  }
  &.vl-tooltip-align-left {
    margin-left: -13px;
  }
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
