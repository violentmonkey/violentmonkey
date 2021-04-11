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
              <span class="btn-ghost">
                <icon name="plus"></icon>
              </span>
            </tooltip>
            <div
              class="dropdown-menu-item"
              v-text="i18n('buttonNew')"
              @click.prevent="onEditScript('_new')"
            />
            <a class="dropdown-menu-item" v-text="i18n('installFrom', 'OpenUserJS')" href="https://openuserjs.org/" target="_blank" rel="noopener noreferrer"></a>
            <a class="dropdown-menu-item" v-text="i18n('installFrom', 'GreasyFork')" href="https://greasyfork.org/scripts" target="_blank" rel="noopener noreferrer"></a>
            <div
              class="dropdown-menu-item"
              v-text="i18n('buttonInstallFromURL')"
              @click.prevent="installFromURL"
            />
          </dropdown>
          <tooltip :content="i18n('buttonUpdateAll')" placement="bottom" align="start">
            <span class="btn-ghost" @click="updateAll">
              <icon name="refresh"></icon>
            </span>
          </tooltip>
        </div>
        <div class="flex-auto" v-else
             v-text="`${i18n('headerRecycleBin')}${trash.length ? ` (${trash.length})` : ''}`" />
        <tooltip :content="i18n('buttonRecycleBin')" placement="bottom">
          <span class="btn-ghost trash-button" @click="toggleRecycle" ref="trash"
                :class="{ active: showRecycle, filled: trash.length }">
            <icon name="trash"></icon>
            <b v-if="trash.length" v-text="trash.length"/>
          </span>
        </tooltip>
        <dropdown align="right" class="filter-sort">
          <tooltip :content="i18n('labelSettings')" placement="bottom" slot="toggle">
            <span class="btn-ghost">
              <icon name="cog"/>
            </span>
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
      <div class="flex-auto pos-rel">
        <div class="scripts abs-full"
             :style="`--num-columns:${numColumns}`"
             :data-columns="numColumns"
             :data-table="filters.viewTable">
          <script-item
            v-for="(script, index) in sortedScripts"
            v-show="!search || script.$cache.show !== false"
            :key="script.props.id"
            :class="{ removing: removing && removing.id === script.props.id }"
            :script="script"
            :draggable="filters.sort.value === 'exec' && !script.config.removed"
            :visible="index < batchRender.limit"
            :name-clickable="filters.viewTable"
            @edit="onEditScript"
            @move="moveScript"
            @remove="onRemove"
          />
        </div>
        <div
          class="backdrop abs-full"
          :class="{mask: store.loading}"
          v-show="message">
          <div v-html="message"></div>
        </div>
      </div>
    </div>
    <edit v-if="script" :initial="script" @close="onEditScript()"></edit>
    <div class="trash-animate" v-if="removing" :style="removing.animation" />
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
      store,
      filterOptions,
      filters,
      script: null,
      search: null,
      searchError: null,
      modal: null,
      menuNewActive: false,
      showRecycle: false,
      sortedScripts: [],
      removing: null,
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
    showRecycle: 'onUpdate',
    scripts: 'refreshUI',
    'store.route.paths.1': 'onHashChange',
  },
  computed: {
    currentSortCompare() {
      return filterOptions.sort[filters.sort.value]?.compare;
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
      return this.store.scripts.filter(script => !script.config.removed);
    },
    searchNeedsCodeIds() {
      return this.search
        && ['code', 'all'].includes(filters.searchScope)
        && this.store.scripts.filter(s => s.$cache.code == null).map(s => s.props.id);
    },
    trash() {
      return this.store.scripts.filter(script => script.config.removed);
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
    onEditScript(id) {
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
    toggleRecycle() {
      this.showRecycle = !this.showRecycle;
    },
    onRemove(id, rect) {
      const { trash } = this.$refs;
      if (!trash || this.removing) return;
      const trashRect = trash.getBoundingClientRect();
      this.removing = {
        id,
        animation: {
          width: `${trashRect.width}px`,
          height: `${trashRect.height}px`,
          top: `${trashRect.top}px`,
          left: `${trashRect.left}px`,
          transform: `translate(${rect.left - trashRect.left}px,${rect.top - trashRect.top}px) scale(${rect.width / trashRect.width},${rect.height / trashRect.height})`,
          transition: 'transform .3s',
        },
      };
      setTimeout(() => {
        this.removing.animation.transform = 'translate(0,0) scale(1,1)';
        setTimeout(() => {
          this.removing = null;
        }, 300);
      });
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
  select {
    /* borders are copied from inputs in common/ui/style */
    border: 1px solid var(--fill-3);
    &:focus {
      border-color: var(--fill-7);
    }
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
  position: fixed;
  background: rgba(0,0,0,.1);
  transform-origin: top left;
}

.script.removing {
  opacity: .2;
}
</style>
