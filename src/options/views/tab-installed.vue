<template>
  <div class="tab-installed" ref="scroller">
    <div v-if="state.canRenderScripts">
      <header class="flex">
        <div class="flex-auto" v-if="!showRecycle">
          <Dropdown
            :closeAfterClick="true"
            :class="{active: state.menuNewActive}"
            @stateChange="handleStateChange">
            <Tooltip :content="i18n('buttonNew')" placement="bottom" align="start">
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
          <Tooltip :content="i18n('buttonUpdateAll')" placement="bottom" align="start">
            <a class="btn-ghost" tabindex="0" @click="handleUpdateAll">
              <Icon name="refresh" />
            </a>
          </Tooltip>
        </div>
        <div class="flex-auto" v-else v-text="i18n('headerRecycleBin')" />
        <Dropdown align="right" class="filter-sort">
          <Tooltip :content="i18n('labelSettings')" placement="bottom">
            <a class="btn-ghost" tabindex="0">
              <Icon name="cog" />
            </a>
          </Tooltip>
          <template #content>
            <div>
              <LocaleGroup i18n-key="labelFilterSort">
                <select :value="filters.sort" @change="handleOrderChange">
                  <option
                    v-for="(option, name) in filterOptions.sort"
                    v-text="option.title"
                    :key="name"
                    :value="name">
                  </option>
                </select>
              </LocaleGroup>
            </div>
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
        <form class="filter-search hidden-xs flex" @submit.prevent>
          <Tooltip placement="bottom">
            <label>
              <input
                type="search"
                :class="{'has-error': state.searchError}"
                :placeholder="i18n('labelSearchScript')"
                v-model="state.search"
                ref="refSearch"
                id="installed-search">
              <Icon name="search" />
            </label>
            <template #content>
              <pre
                class="filter-search-tooltip"
                v-text="state.searchError || i18n('titleSearchHint')"
              />
            </template>
          </Tooltip>
          <select v-model="filters.searchScope" @change="handleOnScopeChange">
            <option value="name" v-text="i18n('filterScopeName')"/>
            <option value="code" v-text="i18n('filterScopeCode')"/>
            <option value="all" v-text="i18n('filterScopeAll')"/>
          </select>
        </form>
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
        <script-item
          v-for="(script, index) in state.sortedScripts"
          v-show="!state.search || script.$cache.show !== false"
          :key="script.props.id"
          :focused="selectedScript === script"
          :showHotkeys="state.showHotkeys"
          :script="script"
          :draggable="draggable"
          :visible="index < state.batchRender.limit"
          :viewTable="filters.viewTable"
          :hotkeys="scriptHotkeys"
          @remove="handleActionRemove"
          @restore="handleActionRestore"
          @toggle="handleActionToggle"
          @update="handleActionUpdate"
          @scrollDelta="handleSmoothScroll"
        />
      </div>
    </div>
    <teleport to="body" v-if="state.script">
      <edit
        :initial="state.script"
        :initial-code="state.code"
        :read-only="!!state.script.config.removed"
        @close="handleEditScript()"
      />
    </teleport>
  </div>
</template>

<script>
import { computed, reactive, nextTick, onMounted, watch, ref } from 'vue';
import { i18n, sendCmdDirectly, debounce, makePause, trueJoin } from '@/common';
import options from '@/common/options';
import { showConfirmation, showMessage, vFocus } from '@/common/ui';
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
import { store } from '../utils';
import toggleDragging from '../utils/dragging';
import ScriptItem from './script-item';
import Edit from './edit';

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
    update: {
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
  edit: 'e',
  toggle: 'space',
  update: 'r',
  restore: 'r',
  remove: 'x',
};
const registerHotkey = (callback, items) => items.map(([key, condition, caseSensitive]) => (
  keyboardService.register(key, callback, { condition, caseSensitive })
));

const MAX_BATCH_DURATION = 100;
let step = 0;

let columnsForTableMode = [];
let columnsForCardsMode = [];

const refSearch = ref();
const refList = ref();
const scroller = ref();

const state = reactive({
  focusedIndex: -1,
  menuNewActive: false,
  showHotkeys: false,
  // Speedup and deflicker for initial page load:
  // skip rendering the script list when starting in the editor.
  canRenderScripts: !store.route.paths[1],
  search: '',
  searchError: null,
  sortedScripts: [],
  filteredScripts: [],
  script: null,
  code: '',
  numColumns: 0,
  batchRender: {
    limit: step,
  },
});

const showRecycle = computed(() => store.route.paths[0] === 'recycleBin');
const draggable = computed(() => !showRecycle.value && filters.sort === 'exec');
const currentSortCompare = computed(() => filterOptions.sort[filters.sort]?.compare);
const selectedScript = computed(() => state.filteredScripts[state.focusedIndex]);
const message = computed(() => {
  if (store.loading) {
    return null;
  }
  if (state.search ? !state.sortedScripts.find(s => s.$cache.show !== false) : !state.sortedScripts.length) {
    return i18n('labelNoSearchScripts');
  }
  return null;
});
const searchNeedsCodeIds = computed(() => state.search
        && ['code', 'all'].includes(filters.searchScope)
        && store.scripts.filter(s => s.$cache.code == null).map(s => s.props.id));
const getCurrentList = () => showRecycle.value ? store.removedScripts : store.scripts;

const debouncedUpdate = debounce(onUpdate, 100);
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
  const numFound = state.search ? performSearch(scripts) : scripts.length;
  const cmp = currentSortCompare.value;
  if (cmp) scripts.sort(combinedCompare(cmp));
  state.sortedScripts = scripts;
  state.filteredScripts = state.search ? scripts.filter(({ $cache }) => $cache.show) : scripts;
  selectScript(state.focusedIndex);
  if (!step || numFound < step) renderScripts();
  else debouncedRender();
}
function handleUpdateAll() {
  sendCmdDirectly('CheckUpdate');
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
    if (err) showMessage({ text: err });
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
function handleOnScopeChange(e) {
  if (state.search) scheduleSearch();
  options.set('filters.searchScope', e.target.value);
}
function handleStateChange(active) {
  state.menuNewActive = active;
}
function handleEditScript(id) {
  const pathname = [showRecycle.value ? 'recycleBin' : 'scripts', id]::trueJoin('/');
  if (!id && pathname === lastRoute().pathname) {
    window.history.back();
  } else {
    setRoute(pathname);
  }
}
async function onHashChange() {
  const [tab, id, cacheId] = store.route.paths;
  const newData = id === '_new' && await sendCmdDirectly('NewScript', cacheId);
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
  if (!state.canRenderScripts) {
    state.canRenderScripts = true;
    loadData();
  }
  renderScripts();
  state.script = null;
  // Workaround for bug in Chrome, not suppressible via overflow-anchor:none
  if (!IS_FIREFOX) {
    const el = scroller.value;
    const pos = el.scrollTop;
    nextTick(() => { el.scrollTop = pos; });
  }
}
async function renderScripts() {
  if (!state.canRenderScripts) return;
  const { length } = state.sortedScripts;
  let limit = 9;
  const batchRender = reactive({ limit });
  state.batchRender = batchRender;
  const startTime = performance.now();
  // If we entered a new loop of rendering, state.batchRender will no longer be batchRender
  while (limit < length && batchRender === state.batchRender) {
    if (step && state.search) {
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
function performSearch(scripts) {
  let searchRE;
  let count = 0;
  const [,
  expr = state.search.replace(/[.+^*$?|\\()[\]{}]/g, '\\$&'),
  flags = 'i',
] = state.search.match(/^\/(.+?)\/(\w*)$|$/);
  const scope = filters.searchScope;
  const scopeName = scope === 'name' || scope === 'all';
  const scopeCode = scope === 'code' || scope === 'all';
  try {
    searchRE = expr && new RegExp(expr, flags);
    scripts.forEach(({ $cache }) => {
      $cache.show = !expr
        || scopeName && searchRE.test($cache.search)
        || scopeCode && searchRE.test($cache.code);
      count += $cache.show;
    });
    state.searchError = null;
  } catch (err) {
    state.searchError = err.message;
  }
  return count;
}
async function scheduleSearch() {
  const ids = searchNeedsCodeIds.value;
  if (ids?.length) await getCodeFromStorage(ids);
  debouncedUpdate();
}
async function getCodeFromStorage(ids) {
  const data = await sendCmdDirectly('GetScriptCode', ids);
  store.scripts.forEach(({ $cache, props: { id } }) => {
    if (id in data) $cache.code = data[id];
  });
}
async function handleEmptyRecycleBin() {
  if (await showConfirmation(i18n('buttonEmptyRecycleBin'))) {
    sendCmdDirectly('CheckRemove', { force: true });
    store.removedScripts = [];
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
function markRemove(script, removed) {
  return sendCmdDirectly('MarkRemoved', {
    id: script.props.id,
    removed,
  });
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
  sendCmdDirectly('UpdateScriptInfo', {
    id: script.props.id,
    config: {
      enabled: script.config.enabled ? 0 : 1,
    },
  });
}
function handleActionUpdate(script) {
  sendCmdDirectly('CheckUpdate', script.props.id);
}
function handleSmoothScroll(delta) {
  if (!delta) return;
  const el = refList.value;
  el.scroll({
    top: el.scrollTop + delta,
    behavior: 'smooth',
  });
}
function bindKeys() {
  const handleFocus = () => {
    keyboardService.setContext('buttonFocus', document.activeElement?.tabIndex >= 0);
  };
  document.addEventListener('focus', handleFocus, true);
  const disposeList = [
    () => document.removeEventListener('focus', handleFocus, true),
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
        [scriptHotkeys.edit, conditionScriptFocused, true],
        // Enter should only work when no button is focused
        ['enter', conditionScriptFocusedWithoutButton],
      ]),
    ...registerHotkey(() => {
      handleActionRemove(selectedScript.value);
    }, [
        ['delete', conditionScriptFocused],
        [scriptHotkeys.remove, conditionScriptFocused, true],
      ]),
    ...registerHotkey(() => {
      handleActionUpdate(selectedScript.value);
    }, [
        [scriptHotkeys.update, conditionScriptFocused, true],
      ]),
    ...registerHotkey(() => {
      handleActionToggle(selectedScript.value);
    }, [
        [scriptHotkeys.toggle, conditionScriptFocused, true],
      ]),
    ...registerHotkey(() => {
      handleActionRestore(selectedScript.value);
    }, [
        [scriptHotkeys.restore, conditionScriptFocusedRecycle, true],
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

export default {
  components: {
    Dropdown,
    Tooltip,
    SettingCheck,
    Icon,
    LocaleGroup,
    ScriptItem,
    Edit,
  },
  directives: {
    focus: vFocus,
  },
  setup() {
    resetList();
    watch(showRecycle, resetList);
    watch(draggable, state => toggleDragging(refList.value, moveScript, state));
    watch(() => state.search, scheduleSearch);
    watch(() => [filters.sort, filters.showEnabledFirst], debouncedUpdate);
    watch(() => [filters.viewSingleColumn, filters.viewTable], adjustScriptWidth);
    watch(getCurrentList, refreshUI);
    watch(() => store.route.paths[1], onHashChange);
    watch(selectedScript, script => {
      keyboardService.setContext('selectedScript', script);
    });
    watch(() => state.showHotkeys, value => {
      keyboardService.setContext('showHotkeys', value);
    });

    onMounted(() => {
      // Ensure the correct UI is shown when mounted:
      // * on subsequent navigation via history back/forward;
      // * on first initialization in some weird case the scripts got loaded early.
      if (!store.loading) refreshUI();
      // Extract --columns-cards and --columns-table from `:root` or `html` selector. CustomCSS may override it.
      if (!columnsForCardsMode.length) {
        const style = getComputedStyle(document.documentElement);
        [columnsForCardsMode, columnsForTableMode] = ['cards', 'table']
          .map(type => style.getPropertyValue(`--columns-${type}`)?.split(',').map(Number).filter(Boolean) || []);
        global.addEventListener('resize', adjustScriptWidth);
      }
      adjustScriptWidth();
      return bindKeys();
    });

    return {
      // Refs
      refSearch,
      refList,
      scroller,

      // Values
      store,
      state,
      filters,
      filterOptions,
      currentSortCompare,
      selectedScript,
      draggable,
      scriptHotkeys,
      showRecycle,
      message,

      // Methods
      handleStateChange,
      handleOrderChange,
      handleEditScript,
      handleEmptyRecycleBin,
      handleInstallFromURL,
      handleUpdateAll,
      handleOnScopeChange,
      handleActionRemove,
      handleActionRestore,
      handleActionToggle,
      handleActionUpdate,
      handleSmoothScroll,
    };
  },
};
</script>

<style>
:root {
  --columns-cards: 1300, 1900, 2500; // 1366x768, 1920x1080, 2560x1440
  --columns-table: 1600, 2500, 3400; // 1680x1050, 2560x1440, 3440x1440
}
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
    padding: 0 1rem;
    line-height: 1;
    border-bottom: 1px solid var(--fill-5);
  }
  .vl-dropdown-menu {
    white-space: nowrap;
  }
  .vl-dropdown.active .vl-tooltip-wrap {
    display: none;
  }
  @media (max-width: 500px) { // same size as `hidden-sm` in @/common/ui/style/style.css
    .vl-dropdown-right .vl-dropdown-menu {
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
.scripts {
  overflow-y: auto;
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
  height: 2rem;
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
    width: 14rem;
    max-width: calc(100vw - 16rem);
    padding-left: .5rem;
    padding-right: 2rem;
    height: 100%;
  }
  &-tooltip {
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

.trash-button {
  position: relative;
  b {
    position: absolute;
    font-size: 10px;
    line-height: 1;
    text-align: center;
    left: 0;
    right: 0;
    bottom: -4px;
  }
  &.active b {
    display: none;
  }
}

.hint {
  line-height: 1.5;
  color: var(--fill-6);
  place-items: center;
}

.trash-animate {
  animation: .5s linear rotate;
}

@keyframes rotate {
  0% {
    transform: scale(1.2) rotate(0);
  }
  100% {
    transform: scale(1.2) rotate(360deg);
  }
}
</style>
