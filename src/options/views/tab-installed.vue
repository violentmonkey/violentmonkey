<template>
  <div class="tab-installed flex flex-col">
    <div class="flex flex-col flex-auto" v-if="canRenderScripts">
      <header class="flex">
        <div class="flex-auto" v-if="!showRecycle">
          <dropdown
            :closeAfterClick="true"
            :class="{active: menuNewActive}"
            @stateChange="onStateChange">
            <tooltip :content="i18n('buttonNew')" placement="bottom" align="start" slot="toggle">
              <a class="btn-ghost" tabindex="0">
                <icon name="plus"></icon>
              </a>
            </tooltip>
            <a
              class="dropdown-menu-item"
              v-text="i18n('buttonNew')"
              tabindex="0"
              @click.prevent="editScript('_new')"
            />
            <a class="dropdown-menu-item" v-text="i18n('installFrom', 'OpenUserJS')" href="https://openuserjs.org/" target="_blank" rel="noopener noreferrer"></a>
            <a class="dropdown-menu-item" v-text="i18n('installFrom', 'GreasyFork')" href="https://greasyfork.org/scripts" target="_blank" rel="noopener noreferrer"></a>
            <a
              class="dropdown-menu-item"
              v-text="i18n('buttonInstallFromURL')"
              tabindex="0"
              @click.prevent="installFromURL"
            />
          </dropdown>
          <tooltip :content="i18n('buttonUpdateAll')" placement="bottom" align="start">
            <a class="btn-ghost" tabindex="0" @click="updateAll">
              <icon name="refresh"></icon>
            </a>
          </tooltip>
        </div>
        <div class="flex-auto" v-else
             v-text="`${i18n('headerRecycleBin')}${trash.length ? ` (${trash.length})` : ''}`" />
        <tooltip :content="i18n('buttonRecycleBin')" placement="bottom">
          <a
            class="btn-ghost trash-button"
            :class="{ active: showRecycle, filled: trash.length }"
            @click="showRecycle = !showRecycle"
            tabindex="0"
          >
            <icon name="trash" :class="{ 'trash-animate': removing }"></icon>
            <b v-if="trash.length" v-text="trash.length"/>
          </a>
        </tooltip>
        <dropdown align="right" class="filter-sort">
          <tooltip :content="i18n('labelSettings')" placement="bottom" slot="toggle">
            <a class="btn-ghost" tabindex="0">
              <icon name="cog"/>
            </a>
          </tooltip>
          <div>
            <locale-group i18n-key="labelFilterSort">
              <select :value="filters.sort.value" @change="onOrderChange">
                <option
                  v-for="(option, name) in filterOptions.sort"
                  v-text="option.title"
                  :key="name"
                  :value="name">
                </option>
              </select>
            </locale-group>
          </div>
          <div v-show="currentSortCompare">
            <setting-check name="filters.showEnabledFirst"
                           :label="i18n('optionShowEnabledFirst')" />
          </div>
          <div>
            <setting-check name="filters.showOrder" :label="i18n('labelShowOrder')" />
          </div>
          <div class="mr-2c">
            <setting-check name="filters.viewTable" :label="i18n('labelViewTable')" />
            <setting-check name="filters.viewSingleColumn" :label="i18n('labelViewSingleColumn')" />
          </div>
        </dropdown>
        <!-- form and id are required for the built-in autocomplete using entered values -->
        <form class="filter-search hidden-xs flex" @submit.prevent>
          <tooltip placement="bottom">
            <label>
              <input
                type="search"
                :class="{'has-error': searchError}"
                :placeholder="i18n('labelSearchScript')"
                v-model="search"
                ref="search"
                id="installed-search">
              <icon name="search"></icon>
            </label>
            <pre
              class="filter-search-tooltip"
              slot="content"
              v-text="searchError || i18n('titleSearchHint')">
            </pre>
          </tooltip>
          <select v-model="filters.searchScope" @change="onScopeChange">
            <option value="name" v-text="i18n('filterScopeName')"/>
            <option value="code" v-text="i18n('filterScopeCode')"/>
            <option value="all" v-text="i18n('filterScopeAll')"/>
          </select>
        </form>
      </header>
      <div v-if="showRecycle" class="trash-hint mx-1 my-1 flex flex-col">
        <span v-text="i18n('hintRecycleBin')"/>
        <a v-if="trash.length" v-text="i18n('buttonEmptyRecycleBin')" href="#"
           @click.prevent="emptyRecycleBin"/>
      </div>
      <div class="scripts flex-auto"
           ref="scriptList"
           :style="`--num-columns:${numColumns}`"
           :data-columns="numColumns"
           :data-show-order="filters.showOrder"
           :data-table="filters.viewTable">
        <script-item
          v-for="(script, index) in sortedScripts"
          v-show="!search || script.$cache.show !== false"
          :key="script.props.id"
          :focused="selectedScript === script"
          :showHotkeys="showHotkeys"
          :script="script"
          :draggable="filters.sort.value === 'exec' && !script.config.removed"
          :visible="index < batchRender.limit"
          :nameClickable="filters.viewTable"
          :hotkeys="scriptHotkeys"
          @edit="handleActionEdit"
          @remove="handleActionRemove"
          @restore="handleActionRestore"
          @toggle="handleActionToggle"
          @update="handleActionUpdate"
          @move="moveScript"
          @scrollDelta="handleSmoothScroll"
          @tiptoggle.native="showHotkeys = !showHotkeys"
        />
      </div>
    </div>
    <edit v-if="script" :initial="script" @close="editScript()"></edit>
  </div>
</template>

<script>
import Dropdown from 'vueleton/lib/dropdown/bundle';
import Tooltip from 'vueleton/lib/tooltip/bundle';
import {
  i18n, sendCmd, debounce, makePause,
} from '#/common';
import options from '#/common/options';
import { showConfirmation, showMessage } from '#/common/ui';
import SettingCheck from '#/common/ui/setting-check';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import LocaleGroup from '#/common/ui/locale-group';
import { forEachKey } from '#/common/object';
import { setRoute, lastRoute } from '#/common/router';
import storage from '#/common/storage';
import { keyboardService, handleTabNavigation } from '#/common/keyboard';
import ua from '#/common/ua';
import { loadData } from '#/options';
import ScriptItem from './script-item';
import Edit from './edit';
import { store } from '../utils';

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
  },
};
const filtersSort = {
  value: null,
  title: null,
};
const filters = {
  searchScope: null,
  showEnabledFirst: null,
  showOrder: null,
  viewSingleColumn: null,
  viewTable: null,
  get sort() {
    return filtersSort;
  },
  set sort(value) {
    const option = filterOptions.sort[value];
    if (option) {
      filtersSort.value = value;
      filtersSort.title = option.title;
    } else {
      filters.sort = Object.keys(filterOptions.sort)[0];
    }
  },
};
const combinedCompare = cmpFunc => (
  filters.showEnabledFirst
    ? ((a, b) => b.config.enabled - a.config.enabled || cmpFunc(a, b))
    : cmpFunc
);
filters::forEachKey(key => {
  hookSetting(`filters.${key}`, (val) => {
    filters[key] = val;
  });
});

const MAX_BATCH_DURATION = 100;
let step = 0;

let columnsForTableMode = [];
let columnsForCardsMode = [];

const conditionAll = 'tabScripts';
const conditionSearch = `${conditionAll} && inputFocus`;
const conditionNotSearch = `${conditionAll} && !inputFocus`;
const conditionScriptFocused = `${conditionNotSearch} && selectedScript && !showRecycle`;
const conditionScriptFocusedRecycle = `${conditionNotSearch} && selectedScript && showRecycle`;
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

export default {
  components: {
    ScriptItem,
    Edit,
    Tooltip,
    SettingCheck,
    LocaleGroup,
    Dropdown,
    Icon,
  },
  data() {
    return {
      scriptHotkeys,
      store,
      filterOptions,
      filters,
      filteredScripts: [],
      focusedIndex: -1,
      script: null,
      search: null,
      searchError: null,
      modal: null,
      menuNewActive: false,
      showRecycle: false,
      sortedScripts: [],
      removing: false,
      showHotkeys: false,
      // Speedup and deflicker for initial page load:
      // skip rendering the script list when starting in the editor.
      canRenderScripts: !store.route.paths[1],
      batchRender: {
        limit: step,
      },
      numColumns: null,
    };
  },
  watch: {
    search: 'scheduleSearch',
    'filters.sort.value': 'updateLater',
    'filters.showEnabledFirst': 'updateLater',
    'filters.viewSingleColumn': 'adjustScriptWidth',
    'filters.viewTable': 'adjustScriptWidth',
    showRecycle(value) {
      keyboardService.setContext('showRecycle', value);
      this.focusedIndex = -1;
      this.onUpdate();
    },
    scripts: 'refreshUI',
    'store.route.paths.1': 'onHashChange',
    selectedScript(script) {
      keyboardService.setContext('selectedScript', script);
    },
    showHotkeys(value) {
      keyboardService.setContext('showHotkeys', value);
    },
  },
  computed: {
    currentSortCompare() {
      return filterOptions.sort[filters.sort.value]?.compare;
    },
    selectedScript() {
      return this.filteredScripts[this.focusedIndex];
    },
    message() {
      if (this.store.loading) {
        return null;
      }
      const scripts = this.sortedScripts;
      if (this.search ? !scripts.find(s => s.$cache.show !== false) : !scripts.length) {
        return i18n('labelNoSearchScripts');
      }
      return null;
    },
    scripts() {
      return this.store.installedScripts;
    },
    searchNeedsCodeIds() {
      return this.search
        && ['code', 'all'].includes(filters.searchScope)
        && this.store.scripts.filter(s => s.$cache.code == null).map(s => s.props.id);
    },
    trash() {
      return this.store.removedScripts;
    },
  },
  methods: {
    async refreshUI() {
      const ids = this.searchNeedsCodeIds;
      if (ids?.length) await this.getCodeFromStorage(ids);
      this.onUpdate();
      this.onHashChange();
    },
    onUpdate() {
      const scripts = [...this.showRecycle ? this.trash : this.scripts];
      const numFound = this.search ? this.performSearch(scripts) : scripts.length;
      const cmp = this.currentSortCompare;
      if (cmp) scripts.sort(combinedCompare(cmp));
      this.sortedScripts = scripts;
      this.filteredScripts = this.search ? scripts.filter(({ $cache }) => $cache.show) : scripts;
      this.selectScript(this.focusedIndex);
      if (!step || numFound < step) this.renderScripts();
      else this.debouncedRender();
    },
    updateLater() {
      this.debouncedUpdate();
    },
    updateAll() {
      sendCmd('CheckUpdateAll');
    },
    async installFromURL() {
      try {
        let url = await showConfirmation(i18n('hintInputURL'), {
          input: '',
          ok: { type: 'submit' },
        });
        url = url?.trim();
        if (url) {
          if (!url.includes('://')) url = `https://${url}`;
          if (new URL(url)) await sendCmd('ConfirmInstall', { url });
        }
      } catch (err) {
        if (err) showMessage({ text: err });
      }
    },
    moveScript(data) {
      if (data.from === data.to) return;
      sendCmd('Move', {
        id: this.scripts[data.from].props.id,
        offset: data.to - data.from,
      })
      .then(() => {
        const { scripts } = this;
        const i = Math.min(data.from, data.to);
        const j = Math.max(data.from, data.to);
        const seq = [
          scripts.slice(0, i),
          scripts.slice(i, j + 1),
          scripts.slice(j + 1),
        ];
        if (i === data.to) {
          seq[1].unshift(seq[1].pop());
        } else {
          seq[1].push(seq[1].shift());
        }
        this.store.scripts = [...seq.flat(), ...this.trash];
      });
    },
    onOrderChange(e) {
      options.set('filters.sort', e.target.value);
    },
    onScopeChange(e) {
      if (this.search) this.scheduleSearch();
      options.set('filters.searchScope', e.target.value);
    },
    onStateChange(active) {
      this.menuNewActive = active;
    },
    editScript(id) {
      const pathname = ['scripts', id].filter(Boolean).join('/');
      if (!id && pathname === lastRoute().pathname) {
        window.history.back();
      } else {
        setRoute(pathname);
      }
    },
    onHashChange() {
      const [tab, id] = this.store.route.paths;
      if (id === '_new') {
        this.script = {};
      } else {
        const nid = id && +id || null;
        this.script = nid && this.scripts.find(script => script.props.id === nid);
        if (!this.script) {
          // First time showing the list we need to tell v-if to keep it forever
          if (!this.canRenderScripts) {
            loadData();
            this.canRenderScripts = true;
          }
          this.debouncedRender();
          // Strip the invalid id from the URL so |App| can render the aside,
          // which was hidden to avoid flicker on initial page load directly into the editor.
          if (id) setRoute(tab, true);
        }
      }
    },
    async renderScripts() {
      if (!this.canRenderScripts) return;
      const { length } = this.sortedScripts;
      let limit = 9;
      const batchRender = { limit };
      this.batchRender = batchRender;
      const startTime = performance.now();
      // If we entered a new loop of rendering, this.batchRender will no longer be batchRender
      while (limit < length && batchRender === this.batchRender) {
        if (step && this.search) {
          // Only visible items contribute to the batch size
          for (let vis = 0; vis < step && limit < length; limit += 1) {
            vis += this.sortedScripts[limit].$cache.show ? 1 : 0;
          }
        } else {
          limit += step || 1;
        }
        batchRender.limit = limit;
        await new Promise(resolve => this.$nextTick(resolve));
        if (!step && performance.now() - startTime >= MAX_BATCH_DURATION) {
          step = limit * 2; // the first batch is slow to render because it has more work to do
        }
        if (step && limit < length) await makePause();
      }
    },
    performSearch(scripts) {
      let searchRE;
      let count = 0;
      const [,
        expr = this.search.replace(/[.+^*$?|\\()[\]{}]/g, '\\$&'),
        flags = 'i',
      ] = this.search.match(/^\/(.+?)\/(\w*)$|$/);
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
        this.searchError = null;
      } catch (err) {
        this.searchError = err.message;
      }
      return count;
    },
    async scheduleSearch() {
      const ids = this.searchNeedsCodeIds;
      if (ids?.length) await this.getCodeFromStorage(ids);
      this.debouncedUpdate();
    },
    async getCodeFromStorage(ids) {
      const data = await storage.code.getMulti(ids);
      this.store.scripts.forEach(({ $cache, props: { id } }) => {
        if (id in data) $cache.code = data[id];
      });
    },
    async emptyRecycleBin() {
      try {
        await showConfirmation(i18n('buttonEmptyRecycleBin'));
        sendCmd('CheckRemove', { force: true });
        store.scripts = store.scripts.filter(script => !script.config.removed);
      } catch (e) {
        // NOP
      }
    },
    adjustScriptWidth() {
      const widths = filters.viewTable ? columnsForTableMode : columnsForCardsMode;
      this.numColumns = filters.viewSingleColumn ? 1
        : widths.findIndex(w => window.innerWidth < w) + 1 || widths.length + 1;
    },
    selectScript(index) {
      index = Math.min(index, this.filteredScripts.length - 1);
      index = Math.max(index, -1);
      if (index !== this.focusedIndex) {
        this.focusedIndex = index;
      }
    },
    markRemove(script, removed) {
      sendCmd('MarkRemoved', {
        id: script.props.id,
        removed,
      });
    },
    handleActionEdit(script) {
      this.editScript(script.props.id);
    },
    handleActionRemove(script) {
      this.markRemove(script, 1);
      this.removing = true;
      setTimeout(() => {
        this.removing = false;
      }, 1000);
    },
    handleActionRestore(script) {
      this.markRemove(script, 0);
    },
    handleActionToggle(script) {
      sendCmd('UpdateScriptInfo', {
        id: script.props.id,
        config: {
          enabled: script.config.enabled ? 0 : 1,
        },
      });
    },
    handleActionUpdate(script) {
      sendCmd('CheckUpdate', script.props.id);
    },
    handleSmoothScroll(delta) {
      if (!delta) return;
      const el = this.$refs.scriptList;
      el.scroll({
        top: el.scrollTop + delta,
        behavior: 'smooth',
      });
    },
  },
  created() {
    this.debouncedUpdate = debounce(this.onUpdate, 100);
    this.debouncedRender = debounce(this.renderScripts);
  },
  mounted() {
    // Ensure the correct UI is shown when mounted:
    // * on subsequent navigation via history back/forward;
    // * on first initialization in some weird case the scripts got loaded early.
    if (!store.loading) this.refreshUI();
    // Extract --columns-cards and --columns-table from `:root` or `html` selector. CustomCSS may override it.
    if (!columnsForCardsMode.length) {
      const style = getComputedStyle(document.documentElement);
      [columnsForCardsMode, columnsForTableMode] = ['cards', 'table']
      .map(type => style.getPropertyValue(`--columns-${type}`)?.split(',').map(Number).filter(Boolean) || []);
      global.addEventListener('resize', this.adjustScriptWidth);
    }
    this.adjustScriptWidth();
    this.disposeList = [
      ...ua.isFirefox ? [
        keyboardService.register('tab', () => {
          handleTabNavigation(1);
        }),
        keyboardService.register('s-tab', () => {
          handleTabNavigation(-1);
        }),
      ] : [],
      ...registerHotkey(() => {
        this.$refs.search?.focus();
      }, [
        ['ctrlcmd-f', conditionAll],
        ['/', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        this.$refs.search?.blur();
      }, [
        ['enter', conditionSearch],
      ]),
      ...registerHotkey(() => {
        if (this.selectedScript) this.showHotkeys = !this.showHotkeys;
      }, [
        ['enter', `${conditionAll} && scriptFocus`],
      ]),
      ...registerHotkey(() => {
        this.showHotkeys = false;
      }, [
        ['escape', conditionHotkeys],
        ['q', conditionHotkeys, true],
      ]),
      ...registerHotkey(() => {
        let index = this.focusedIndex;
        if (index < 0) index = 0;
        else index += this.numColumns;
        if (index < this.filteredScripts.length) {
          this.selectScript(index);
        }
      }, [
        ['ctrlcmd-down', conditionAll],
        ['down', conditionAll],
        ['j', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        const index = this.focusedIndex - this.numColumns;
        if (index >= 0) {
          this.selectScript(index);
        }
      }, [
        ['ctrlcmd-up', conditionAll],
        ['up', conditionAll],
        ['k', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        this.selectScript(this.focusedIndex - 1);
      }, [
        ['ctrlcmd-left', conditionAll],
        ['left', conditionNotSearch],
        ['h', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        this.selectScript(this.focusedIndex + 1);
      }, [
        ['ctrlcmd-right', conditionAll],
        ['right', conditionNotSearch],
        ['l', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        this.selectScript(0);
      }, [
        ['ctrlcmd-home', conditionAll],
        ['g g', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        this.selectScript(this.filteredScripts.length - 1);
      }, [
        ['ctrlcmd-end', conditionAll],
        ['G', conditionNotSearch, true],
      ]),
      ...registerHotkey(() => {
        this.handleActionEdit(this.selectedScript);
      }, [
        [scriptHotkeys.edit, conditionScriptFocused, true],
      ]),
      ...registerHotkey(() => {
        this.handleActionRemove(this.selectedScript);
      }, [
        ['delete', conditionScriptFocused],
        [scriptHotkeys.remove, conditionScriptFocused, true],
      ]),
      ...registerHotkey(() => {
        this.handleActionUpdate(this.selectedScript);
      }, [
        [scriptHotkeys.update, conditionScriptFocused, true],
      ]),
      ...registerHotkey(() => {
        this.handleActionToggle(this.selectedScript);
      }, [
        [scriptHotkeys.toggle, conditionScriptFocused, true],
      ]),
      ...registerHotkey(() => {
        this.handleActionRestore(this.selectedScript);
      }, [
        [scriptHotkeys.restore, conditionScriptFocusedRecycle, true],
      ]),
    ];
  },
  beforeDestroy() {
    this.disposeList?.forEach(dispose => {
      dispose();
    });
  },
};
</script>

<style>
:root {
  --columns-cards: 1300, 1900, 2500; // 1366x768, 1920x1080, 2560x1440
  --columns-table: 1600, 2500, 3400; // 1680x1050, 2560x1440, 3440x1440
}
.tab.tab-installed {
  padding: 0;
  header {
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
  @media (max-width: 500px) { // same size as `hidden-sm` in #/common/ui/style/style.css
    .vl-dropdown-right .vl-dropdown-menu {
      position: fixed;
      top: auto;
      left: 0;
      right: auto;
    }
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

.trash-hint {
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
