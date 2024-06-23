<template>
  <div class="tab-installed" ref="scroller">
    <div v-if="store.canRenderScripts">
      <header class="flex">
        <template v-if="!showRecycle">
          <div class="btn-group">
            <Dropdown
              v-model="state.menuNew"
              :class="{active: state.menuNew}"
              :closeAfterClick="true">
              <Tooltip :content="i18n('buttonNew')" placement="bottom" align="start" :disabled="state.menuNew">
                <a class="btn-ghost" tabindex="0">
                  <Icon name="plus" />
                </a>
              </Tooltip>
              <template #content>
                <a
                  class="dropdown-menu-item"
                  v-text="i18n('buttonNew')"
                  tabindex="0"
                  @click.prevent="handleEditScript('_new')"
                />
                <a class="dropdown-menu-item" v-text="i18n('installFrom', 'OpenUserJS')" href="https://openuserjs.org/" target="_blank" rel="noopener noreferrer"></a>
                <a class="dropdown-menu-item" v-text="i18n('installFrom', 'GreasyFork')" href="https://greasyfork.org/scripts" target="_blank" rel="noopener noreferrer"></a>
                <a
                  class="dropdown-menu-item"
                  v-text="i18n('buttonInstallFromURL')"
                  tabindex="0"
                  @click.prevent="handleInstallFromURL"
                />
              </template>
            </Dropdown>
            <Tooltip :content="i18n('updateScriptsAll')" placement="bottom" align="start">
              <a class="btn-ghost" tabindex="0" @click="handleActionUpdate(null, $event.target)">
                <Icon name="refresh" />
              </a>
            </Tooltip>
          </div>
          <div v-if="state.filteredScripts.length" class="btn-group">
            <a
              v-for="({ icon, num }, key) in batchActions" :key="key"
              class="btn-ghost"
              :class="{
                'has-error': state.batchAction.action === key,
                 disabled: store.batch,
              }"
              :data-batch-action="key"
              tabindex="0"
              @click.prevent="handleBatchAction"
            >
              <Icon :name="icon" />
              <sub v-text="num" v-if="num" />
              <span class="ml-1" v-if="state.batchAction.action === key">❗</span>
            </a>
            <div class="btn-hint subtle" v-text="i18n('hintForBatchAction', `${state.filteredScripts.length}`)"></div>
            <Tooltip :content="i18n('buttonUndo')" placement="bottom" align="start">
              <a v-if="state.batchAction.undo" class="btn-ghost" tabindex="0" @click.prevent="state.batchAction.undo">
                <Icon name="undo" />
              </a>
            </Tooltip>
          </div>
        </template>
        <div v-else class="ml-2" v-text="i18n('headerRecycleBin')" />
        <div class="flex-auto"></div>
        <LocaleGroup i18n-key="labelFilterSort" class="ml-1">
          <select :value="filters.sort" @change="handleOrderChange" class="h-100">
            <option
              v-for="(option, name) in filterOptions.sort"
              v-text="option.title"
              :key="name"
              :value="name">
            </option>
          </select>
        </LocaleGroup>
        <Dropdown align="right" class="filter-sort">
          <Tooltip :content="i18n('labelSettings')" placement="bottom">
            <a class="btn-ghost" tabindex="0">
              <Icon name="cog" />
            </a>
          </Tooltip>
          <template #content>
            <div v-show="currentSortCompare">
              <SettingCheck name="filters.showEnabledFirst"
                :label="i18n('optionShowEnabledFirst')" />
            </div>
            <div>
              <SettingCheck name="filters.showOrder" :label="i18n('labelShowOrder')" />
            </div>
            <div class="mr-2c">
              <SettingCheck name="filters.viewTable" :label="i18n('labelViewTable')" />
              <SettingCheck name="filters.viewSingleColumn" :label="i18n('labelViewSingleColumn')" />
            </div>
          </template>
        </Dropdown>
        <!-- form and id are required for the built-in autocomplete using entered values -->
        <form class="filter-search hidden-xs" @submit.prevent
              :style="{ 'min-width': '10em', 'max-width': 5 + Math.max(20, state.search.value.length) + 'ex' }">
          <label>
            <input
              type="search"
              :class="{'has-error': state.search.error}"
              :title="state.search.error"
              :placeholder="i18n('labelSearchScript')"
              v-model="state.search.value"
              ref="refSearch"
              id="installed-search">
            <Icon name="search" />
          </label>
        </form>
        <Dropdown align="right">
          <a class="btn-ghost" tabindex="0" :class="{'has-error': state.search.error}">
            <Icon name="question"></Icon>
          </a>
          <template #content>
            <div class="filter-search-tooltip">
              <div class="has-error" v-if="state.search.error" v-text="state.search.error" />
              <div v-html="i18n('titleSearchHintV2')" />
            </div>
          </template>
        </Dropdown>
      </header>
      <div v-if="showRecycle" class="hint mx-1 my-1 flex flex-col">
        <span v-text="i18n('hintRecycleBin')"/>
        <a v-if="store.removedScripts.length" v-text="i18n('buttonEmptyRecycleBin')" tabindex="0"
           @click="handleEmptyRecycleBin"/>
      </div>
      <div v-else-if="message" class="hint mx-1 my-1 flex flex-col" v-text="message"></div>
      <div class="scripts"
        v-focus="!state.script"
        ref="refList"
        :style="`--num-columns:${state.numColumns}`"
        :data-columns="state.numColumns"
        :data-show-order="filters.showOrder || null"
        :data-table="filters.viewTable || null">
        <ScriptItem
          v-for="(script, index) in state.sortedScripts"
          v-show="!state.search.rules.length || script.$cache.show !== false"
          :key="script.props.id"
          :focused="selectedScript === script"
          :showHotkeys="state.showHotkeys"
          :script="script"
          :draggable="draggable"
          :visible="index < state.batchRender.limit"
          :viewTable="filters.viewTable"
          :hotkeys="scriptHotkeys"
          :activeTags="activeTags"
          @remove="handleActionRemove"
          @restore="handleActionRestore"
          @toggle="handleActionToggle"
          @update="handleActionUpdate"
          @scrollDelta="handleSmoothScroll"
          @clickTag="handleClickTag"
        />
      </div>
    </div>
    <teleport to="body">
      <!-- KeepAlive must be a direct parent of the component, not of teleport -->
      <KeepAlive :key="store.route.hash" :max="5">
      <edit
        v-if="state.script"
        :initial="state.script"
        :initial-code="state.code"
        :read-only="!!state.script.config.removed"
        @close="handleEditScript()"
      />
      </KeepAlive>
    </teleport>
  </div>
</template>

<script setup>
import { computed, reactive, nextTick, onMounted, watch, ref, onBeforeUnmount } from 'vue';
import { i18n, sendCmdDirectly, debounce, ensureArray, makePause, trueJoin } from '@/common';
import options from '@/common/options';
import { getActiveElement, isTouch, showConfirmation, showMessage, vFocus } from '@/common/ui';
import hookSetting from '@/common/hook-setting';
import { forEachKey } from '@/common/object';
import { setRoute, lastRoute } from '@/common/router';
import { keyboardService, handleTabNavigation } from '@/common/keyboard';
import { loadData } from '@/options';
import Dropdown from 'vueleton/lib/dropdown';
import Tooltip from 'vueleton/lib/tooltip';
import SettingCheck from '@/common/ui/setting-check';
import Icon from '@/common/ui/icon';
import LocaleGroup from '@/common/ui/locale-group';
import { customCssElem, findStyleSheetRules } from '@/common/ui/style';
import { createSearchRules, markRemove, performSearch, runInBatch, store } from '../utils';
import toggleDragging from '../utils/dragging';
import ScriptItem from './script-item';
import Edit from './edit';

const EDIT = 'edit';
const REMOVE = 'remove';
const RESTORE = 'restore';
const TOGGLE = 'toggle';
const UNDO = 'undo';
const UPDATE = 'update';
const filterOptions = {
  sort: {
    exec: {
      title: i18n('filterExecutionOrder'),
    },
    alpha: {
      title: i18n('filterAlphabeticalOrder'),
      compare: (
        { $cache: { lowerName: a } },
        { $cache: { lowerName: b } },
      ) => (a < b ? -1 : a > b),
    },
    [UPDATE]: {
      title: i18n('filterLastUpdateOrder'),
      compare: (
        { props: { lastUpdated: a } },
        { props: { lastUpdated: b } },
      ) => (+b || 0) - (+a || 0),
    },
    size: {
      title: i18n('filterSize'),
      compare: (a, b) => b.$cache.sizeNum - a.$cache.sizeNum,
    },
  },
};
const filters = reactive({
  searchScope: null,
  showEnabledFirst: null,
  showOrder: null,
  viewSingleColumn: null,
  viewTable: null,
  sort: null,
});
const combinedCompare = cmpFunc => (
  filters.showEnabledFirst
    ? ((a, b) => b.config.enabled - a.config.enabled || cmpFunc(a, b))
    : cmpFunc
);
filters::forEachKey(key => {
  hookSetting(`filters.${key}`, (val) => {
    filters[key] = val;
    if (key === 'sort' && !filterOptions.sort[val]) filters[key] = Object.keys(filterOptions.sort)[0];
  });
});

const conditionAll = 'tabScripts';
const conditionSearch = `${conditionAll} && inputFocus`;
const conditionNotSearch = `${conditionAll} && !inputFocus`;
const conditionScriptFocused = `${conditionNotSearch} && selectedScript && !showRecycle`;
const conditionScriptFocusedRecycle = `${conditionNotSearch} && selectedScript && showRecycle`;
const conditionScriptFocusedWithoutButton = `${conditionNotSearch} && !buttonFocus`;
const conditionHotkeys = `${conditionNotSearch} && selectedScript && showHotkeys`;
const scriptHotkeys = {
  [EDIT]: 'e',
  [TOGGLE]: 'space',
  [UPDATE]: 'r',
  [RESTORE]: 'r',
  [REMOVE]: 'x',
};
const registerHotkey = (callback, items) => items.map(([key, condition, caseSensitive]) => (
  keyboardService.register(key, callback, { condition, caseSensitive })
));

const MAX_BATCH_DURATION = 100;
let step = 0;

let columnsForTableMode = [];
let columnsForCardsMode = [];
/** @type {CSSMediaRule} */
let narrowMediaRules;

const refSearch = ref();
const refList = ref();
const scroller = ref();
const kScrollTop = 'scrollTop';

const state = reactive({
  focusedIndex: -1,
  menuNew: false,
  showHotkeys: false,
  search: store.search = {
    value: '',
    error: null,
    ...createSearchRules(''),
  },
  sortedScripts: [],
  filteredScripts: [],
  script: null,
  code: '',
  numColumns: 1,
  batchRender: {
    limit: step,
  },
  batchAction: {
    action: null,
    [UNDO]: null,
  },
});

const showRecycle = computed(() => store.route.paths[0] === TAB_RECYCLE);
const draggableRaw = computed(() => !showRecycle.value && filters.sort === 'exec');
const draggable = computed(() => isTouch && draggableRaw.value);
const currentSortCompare = computed(() => filterOptions.sort[filters.sort]?.compare);
const selectedScript = computed(() => state.filteredScripts[state.focusedIndex]);
const message = computed(() => {
  if (store.loading) {
    return null;
  }
  if (state.search.rules.length ? !state.sortedScripts.find(s => s.$cache.show !== false) : !state.sortedScripts.length) {
    return i18n('labelNoSearchScripts');
  }
  return null;
});
const searchNeedsCodeIds = computed(() => state.search.rules.some(rule => !rule.scope || rule.scope === 'code')
        && store.scripts.filter(s => s.$cache.code == null).map(s => s.props.id));
const activeTags = computed(() => state.search.tokens.filter(token => token.prefix === '#' && !token.negative).map(token => token.parsed));
const getCurrentList = () => showRecycle.value ? store.removedScripts : store.scripts;
const getDataBatchAction = evt => evt.target.closest('[data-batch-action]');
const TOGGLE_ON = 'toggle-on';
const ALL_BATCH_ACTIONS = {
  [TOGGLE]: {
    icon: TOGGLE_ON,
    arg(scripts) {
      const enabled = this.icon === TOGGLE_ON ? 1 : 0;
      return scripts.filter(s => +s.config.enabled !== enabled);
    },
    fn: scripts => Promise.all(scripts.map(handleActionToggle)),
  },
  [UPDATE]: {
    icon: 'refresh',
    fn: handleActionUpdate,
    [UNDO]: false,
  },
  [REMOVE]: {
    icon: 'trash',
    async fn(scripts, el, undo) {
      await Promise.all(scripts.map(s => markRemove(s, !undo)));
      // nuking the ghosts because the user's intent was already confirmed
      if (!undo) store.scripts = [];
    },
  },
};
const batchActions = computed(() => {
  const scripts = state.filteredScripts;
  const num = scripts.length;
  const allShown = num === state.sortedScripts.length;
  let res = ALL_BATCH_ACTIONS;
  let toEnable = 0;
  let toUpdate = 0;
  for (const s of scripts) {
    toEnable += !s.config.enabled;
    if (!allShown) toUpdate += s.$canUpdate > 0;
  }
  res[TOGGLE].icon = toEnable ? TOGGLE_ON : 'toggle-off';
  res[TOGGLE].num = toEnable < num ? toEnable : '';
  if (!toUpdate) ({ [UPDATE]: toUpdate, ...res } = res);
  else res[UPDATE].num = toUpdate < num ? toUpdate : '';
  return res;
});

const debouncedSearch = debounce(scheduleSearch, 100);
const debouncedRender = debounce(renderScripts);

function resetList() {
  if (!showRecycle.value && store.needRefresh) {
    // Filter removed scripts when reload installed list
    store.scripts = store.scripts.filter(script => !script.config.removed);
    store.needRefresh = false;
  }
  state.focusedIndex = -1;
  onUpdate();
}
async function refreshUI() {
  const ids = searchNeedsCodeIds.value;
  if (ids?.length) await getCodeFromStorage(ids);
  onUpdate();
  onHashChange();
}
function onUpdate() {
  const scripts = [...getCurrentList()];
  const rules = state.search.rules;
  const numFound = rules.length ? performSearch(scripts, rules) : scripts.length;
  const cmp = currentSortCompare.value;
  if (cmp) scripts.sort(combinedCompare(cmp));
  state.sortedScripts = scripts;
  state.filteredScripts = rules.length ? scripts.filter(({ $cache }) => $cache.show) : scripts;
  selectScript(state.focusedIndex);
  if (!step || numFound < step) renderScripts();
  else debouncedRender();
}
async function handleInstallFromURL() {
  try {
    let url = await showConfirmation(i18n('hintInputURL'), {
      input: '',
      ok: { type: 'submit' },
    });
    url = url?.trim();
    if (url) {
      if (!url.includes('://')) url = `https://${url}`;
      // test if URL is valid
      new URL(url);
      await sendCmdDirectly('ConfirmInstall', { url });
    }
  } catch (err) {
    showMessage({ text: err.message || err });
  }
}
async function moveScript(from, to) {
  if (from === to) return;
  const scripts = state.filteredScripts;
  const allScripts = store.scripts;
  const script = scripts[from];
  const aFrom = allScripts.indexOf(script);
  const aTo = allScripts.indexOf(scripts[to]);
  const { id } = script.props;
  if (await sendCmdDirectly('Move', { id, offset: aTo - aFrom })) {
    allScripts.splice(aFrom, 1);
    allScripts.splice(aTo, 0, script);
    allScripts.forEach((scr, i) => { scr.props.position = i + 1; });
    onUpdate();
  }
}
function handleOrderChange(e) {
  options.set('filters.sort', e.target.value);
}
function handleEditScript(id) {
  const pathname = [showRecycle.value ? TAB_RECYCLE : SCRIPTS, id]::trueJoin('/');
  if (!id && pathname === lastRoute().pathname) {
    window.history.back();
  } else {
    setRoute(pathname);
  }
}
async function onHashChange() {
  const [tab, id, cacheId] = store.route.paths;
  const newData = id === '_new' && await sendCmdDirectly('NewScript', +cacheId);
  const script = newData ? newData.script : +id && getCurrentList().find(s => s.props.id === +id);
  if (script) {
    state.code = newData ? newData.code : await sendCmdDirectly('GetScriptCode', id);
    state.script = script;
    return;
  }
  // Strip the invalid id from the URL so |App| can render the aside,
  // which was hidden to avoid flicker on initial page load directly into the editor.
  if (id) setRoute(tab, true);
  // First time showing the list we need to tell v-if to keep it forever
  if (!store.canRenderScripts) {
    store.canRenderScripts = true;
    loadData();
  }
  renderScripts();
  state.script = null;
  // Workaround for bug in Chrome, not suppressible via overflow-anchor:none
  if (!IS_FIREFOX) {
    const el = scroller.value;
    const el2 = document.scrollingElement; // for compact layout
    const pos = el[kScrollTop];
    const pos2 = el2[kScrollTop];
    nextTick(() => {
      el[kScrollTop] = pos;
      el2[kScrollTop] = pos2;
    });
  }
}
async function renderScripts() {
  if (!store.canRenderScripts) return;
  const { length } = state.sortedScripts;
  let limit = 9;
  const batchRender = reactive({ limit });
  state.batchRender = batchRender;
  const startTime = performance.now();
  // If we entered a new loop of rendering, state.batchRender will no longer be batchRender
  while (limit < length && batchRender === state.batchRender) {
    if (step && state.search.rules.length) {
      // Only visible items contribute to the batch size
      for (let vis = 0; vis < step && limit < length; limit += 1) {
        vis += state.sortedScripts[limit].$cache.show ? 1 : 0;
      }
    } else {
      limit += step || 1;
    }
    batchRender.limit = limit;
    await new Promise(resolve => nextTick(resolve));
    if (!step && performance.now() - startTime >= MAX_BATCH_DURATION) {
      step = limit * 2; // the first batch is slow to render because it has more work to do
    }
    if (step && limit < length) await makePause();
  }
}
function scheduleSearch() {
  try {
    state.search = store.search = {
      ...state.search,
      ...createSearchRules(state.search.value),
    };
    state.search.error = null;
  } catch (err) {
    state.search.error = err.message;
  }
  const ids = searchNeedsCodeIds.value;
  if (ids?.length) getCodeFromStorage(ids);
  onUpdate();
}
async function getCodeFromStorage(ids) {
  const data = await sendCmdDirectly('GetScriptCode', ids);
  store.scripts.forEach(({ $cache, props: { id } }) => {
    if (id in data) $cache.code = data[id];
  });
  onUpdate();
}
async function handleEmptyRecycleBin() {
  if (await showConfirmation(i18n('buttonEmptyRecycleBin'))) {
    sendCmdDirectly('CheckRemove', { force: true });
    store.removedScripts = [];
  }
}
function adjustNarrowWidth(val) {
  adjustScriptWidth();
  if (val && !narrowMediaRules) {
    narrowMediaRules = findStyleSheetRules('-width: 76'); // max-width: 767px, min-width: 768px
    for (const r of narrowMediaRules) r._orig = r.conditionText;
  }
  if (narrowMediaRules) {
    for (const r of narrowMediaRules) {
      const orig = r._orig;
      r.media.mediaText = val ? orig.replace(/\d+/g, s => +s + 90 / devicePixelRatio) : orig;
    }
  }
}
function adjustScriptWidth() {
  const widths = filters.viewTable ? columnsForTableMode : columnsForCardsMode;
  state.numColumns = filters.viewSingleColumn ? 1
    : widths.findIndex(w => window.innerWidth < w) + 1 || widths.length + 1;
}
function selectScript(index) {
  index = Math.min(index, state.filteredScripts.length - 1);
  index = Math.max(index, -1);
  if (index !== state.focusedIndex) {
    state.focusedIndex = index;
  }
}
function handleActionRemove(script) {
  if (!script.config.removed) {
    markRemove(script, 1);
  } else {
    sendCmdDirectly('RemoveScripts', [script.props.id]);
  }
}
async function handleActionRestore(script) {
  try {
    await markRemove(script, 0);
  } catch (err) {
    showConfirmation(`\
${err.message || err}

@namespace ${script.meta.namespace}
@name ${script.meta.name}`, {
      cancel: false,
    });
  }
}
function handleActionToggle(script) {
  return sendCmdDirectly('UpdateScriptInfo', {
    id: script.props.id,
    config: {
      enabled: script.config.enabled ? 0 : 1,
    },
  });
}
/**
 * @param {VMScript|VMScript[]} [what]
 * @param {Element} [el]
 */
async function handleActionUpdate(what, el) {
  if (el) (el = (el.querySelector('svg') || el).classList).add('rotate');
  await sendCmdDirectly('CheckUpdate', what && ensureArray(what).map(s => s.props.id));
  el?.remove('rotate');
}
function handleClickTag(tag) {
  if (activeTags.value.includes(tag)) {
    // remove tag
    const tokens = state.search.tokens.filter(token => !(token.prefix === '#' && token.parsed === tag));
    state.search.value = tokens.map(token => `${token.prefix}${token.raw}`).join(' ');
  } else {
    // add tag
    state.search.value = [state.search.value.trim(), `#${tag} `].filter(Boolean).join(' ');
  }
}
function handleSmoothScroll(delta) {
  if (!delta) return;
  const el = refList.value;
  el.scroll({
    top: el.scrollTop + delta,
    behavior: 'smooth',
  });
}
function handleBatchAction(e) {
  if (store.batch) return;
  const button = getDataBatchAction(e);
  const stateBA = state.batchAction;
  let action = button?.dataset.batchAction;
  if (stateBA.action === action) {
    // Confirmed
    const baVal = batchActions.value[action] || {};
    const scripts = state.filteredScripts;
    const arg = baVal.arg?.(scripts) || scripts;
    const fn = baVal.fn;
    const batchArgs = [fn, arg, button];
    if (fn) runInBatch(...batchArgs);
    stateBA[UNDO] = fn && baVal[UNDO] !== false && (() => {
      runInBatch(...batchArgs, UNDO);
      stateBA[UNDO] = null;
    });
    action = '';
    button.blur();
  }
  stateBA.action = action;
}
function bindKeys() {
  const handleFocus = () => {
    keyboardService.setContext('buttonFocus', getActiveElement()?.tabIndex >= 0);
  };
  addEventListener('focus', handleFocus, true);
  const disposeList = [
    () => removeEventListener('focus', handleFocus, true),
    ...IS_FIREFOX ? [
      keyboardService.register('tab', () => {
        handleTabNavigation(1);
      }),
      keyboardService.register('s-tab', () => {
        handleTabNavigation(-1);
      }),
    ] : [],
    ...registerHotkey(() => {
      refSearch.value?.focus();
    }, [
        ['ctrlcmd-f', conditionAll],
        ['/', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      refSearch.value?.blur();
    }, [
        ['enter', conditionSearch],
      ]),
    ...registerHotkey(() => {
      state.showHotkeys = false;
    }, [
        ['escape', conditionHotkeys],
        ['q', conditionHotkeys, true],
      ]),
    ...registerHotkey(() => {
      let index = state.focusedIndex;
      if (index < 0) index = 0;
      else index += state.numColumns;
      if (index < state.filteredScripts.length) {
        selectScript(index);
      }
    }, [
        ['ctrlcmd-down', conditionAll],
        ['down', conditionAll],
        ['j', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      const index = state.focusedIndex - state.numColumns;
      if (index >= 0) {
        selectScript(index);
      }
    }, [
        ['ctrlcmd-up', conditionAll],
        ['up', conditionAll],
        ['k', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      selectScript(state.focusedIndex - 1);
    }, [
        ['ctrlcmd-left', conditionAll],
        ['left', conditionNotSearch],
        ['h', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      selectScript(state.focusedIndex + 1);
    }, [
        ['ctrlcmd-right', conditionAll],
        ['right', conditionNotSearch],
        ['l', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      selectScript(0);
    }, [
        ['ctrlcmd-home', conditionAll],
        ['g g', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      selectScript(state.filteredScripts.length - 1);
    }, [
        ['ctrlcmd-end', conditionAll],
        ['G', conditionNotSearch, true],
      ]),
    ...registerHotkey(() => {
      handleEditScript(selectedScript.value.props.id);
    }, [
        [scriptHotkeys[EDIT], conditionScriptFocused, true],
        // Enter should only work when no button is focused
        ['enter', conditionScriptFocusedWithoutButton],
      ]),
    ...registerHotkey(() => {
      handleActionRemove(selectedScript.value);
    }, [
        ['delete', conditionScriptFocused],
        [scriptHotkeys[REMOVE], conditionScriptFocused, true],
      ]),
    ...registerHotkey(() => {
      handleActionUpdate(selectedScript.value);
    }, [
        [scriptHotkeys[UPDATE], conditionScriptFocused, true],
      ]),
    ...registerHotkey(() => {
      handleActionToggle(selectedScript.value);
    }, [
        [scriptHotkeys[TOGGLE], conditionScriptFocused, true],
      ]),
    ...registerHotkey(() => {
      handleActionRestore(selectedScript.value);
    }, [
        [scriptHotkeys[RESTORE], conditionScriptFocusedRecycle, true],
      ]),
    ...registerHotkey(() => {
      state.showHotkeys = !state.showHotkeys;
    }, [
        ['?', conditionNotSearch, true],
      ]),
  ];

  return () => disposeList.forEach(dispose => {
    dispose();
  });
}

function handleCancelBatchAction(e) {
  if (!getDataBatchAction(e)) {
    state.batchAction.action = null;
  }
}

resetList();
watch(showRecycle, resetList);
watch(() => store.canRenderScripts && refList.value && draggableRaw.value,
  dr => toggleDragging(refList.value, moveScript, dr));
watch(() => state.search.value, debouncedSearch);
watch(() => [filters.sort, filters.showEnabledFirst], debouncedSearch);
if (screen.availWidth > 767) {
  watch(() => filters.viewSingleColumn, adjustScriptWidth);
  watch(() => filters.viewTable, adjustNarrowWidth);
}
watch(getCurrentList, refreshUI);
watch(() => store.route.paths[1], onHashChange);
watch(selectedScript, script => {
  keyboardService.setContext('selectedScript', script);
});
watch(() => state.showHotkeys, value => {
  keyboardService.setContext('showHotkeys', value);
});

const disposables = [];

onMounted(() => {
  // Ensure the correct UI is shown when mounted:
  // * on subsequent navigation via history back/forward;
  // * on first initialization in some weird case the scripts got loaded early.
  if (!store.loading) refreshUI();
  // Extract --columns-cards and --columns-table from `:root` or `html` selector. CustomCSS may override it.
  if (!columnsForCardsMode.length) {
    const style = customCssElem?.textContent.match(/--columns-(cards|table)\b/)
      && getComputedStyle(document.documentElement);
    if (style) {
      for (const [type, arr] of [
        ['cards', columnsForCardsMode],
        ['table', columnsForTableMode],
      ]) {
        const val = style.getPropertyValue(`--columns-${type}`);
        if (val) arr.push(...val.split(',').map(Number).filter(Boolean));
      }
    } else {
      columnsForCardsMode.push(1300, 1900, 2500); // 1366x768, 1920x1080, 2560x1440
      columnsForTableMode.push(1600, 2500, 3400); // 1680x1050, 2560x1440, 3440x1440
    }
    addEventListener('resize', adjustScriptWidth);
  }
  adjustScriptWidth();
  disposables.push(bindKeys());

  document.addEventListener('mousedown', handleCancelBatchAction);
  disposables.push(() => document.removeEventListener('mousedown', handleCancelBatchAction));
});

onBeforeUnmount(() => {
  disposables.forEach(dispose => dispose());
});
</script>

<style>
$iconSize: 2rem; // from .icon in ui/style.css
.tab.tab-installed {
  height: 100vh;
  padding: 0;
  overflow: auto;
  header {
    position: sticky;
    top: 0;
    z-index: 1000;
    background: var(--fill-0-5);
    height: 4rem;
    align-items: center;
    line-height: 1;
    border-bottom: 1px solid var(--fill-5);
    .btn-ghost, select {
      height: $iconSize;
    }
  }
  .vl-dropdown-menu {
    white-space: nowrap;
  }
  @media (max-width: 550px) { // same size as `hidden-sm` in @/common/ui/style/style.css
    /* The header bar must be set to scrollable and the dropdown fixed simultaneously. */
    header {
      overflow-x: auto;
      overflow-y: hidden;
    }
    .vl-dropdown-menu {
      position: fixed;
      top: auto;
      left: 0;
      right: auto;
    }
  }
  @media (max-width: 767px) {
    height: auto;
    overflow: visible;
  }
}
.backdrop {
  text-align: center;
  color: var(--fill-8);
}
.backdrop > *,
.backdrop::after {
  display: inline-block;
  vertical-align: middle;
  font-size: 2rem;
}
.backdrop::after {
  content: ' ';
  width: 0;
  height: 100%;
}
.mask {
  background: rgba(0,0,0,.08);
  /*transition: opacity 1s;*/
}
.dropdown-menu-item {
  display: block;
  width: 100%;
  padding: .5rem;
  text-decoration: none;
  color: var(--fill-9);
  cursor: pointer;
  &:focus,
  &:hover {
    color: inherit;
    background: var(--fill-0-5);
  }
}
.filter-search {
  flex-grow: 10;
  label {
    position: relative;
  }
  .icon {
    position: absolute;
    height: 100%;
    top: 0;
    right: .5rem;
  }
  input {
    width: 100%;
    height: 2rem;
    padding-left: .5rem;
    padding-right: 2rem;
  }
  &-tooltip {
    width: 24rem;
    max-width: 100vw;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
}
.filter-sort {
  .vl-dropdown-menu {
    padding: 1rem;
    > :nth-last-child(n + 2) {
      margin-bottom: .5rem;
    }
  }
}

.btn-group {
  display: flex;
  height: 100%;
  align-items: center;
  border-right: 1px solid var(--fill-5);
  padding: 0 0.5rem;
  sub {
    position: absolute;
    color: var(--fill-7);
    margin-top: 1.5rem;
    font-size: x-small;
    text-align: center;
    width: 1rem;
  }
}
.btn-hint {
  margin: 0 0.5rem;
  cursor: default;
}

.hint {
  line-height: 1.5;
  color: var(--fill-6);
  place-items: center;
  & + .scripts {
    border-top: 1px solid var(--fill-5);
  }
}

.rotate {
  animation: 4s linear infinite rotate;
}

@keyframes rotate {
  to {
    transform: rotate(1turn);
  }
}
</style>
