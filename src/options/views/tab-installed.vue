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
        <div class="flex-auto" v-else v-text="i18n('headerRecycleBin')" />
        <tooltip :content="i18n('buttonRecycleBin')" placement="bottom">
          <span class="btn-ghost" @click="toggleRecycle" :class="{active: showRecycle}" ref="trash">
            <icon name="trash"></icon>
          </span>
        </tooltip>
        <dropdown align="right" class="filter-sort">
          <tooltip :content="i18n('buttonFilter')" placement="bottom" slot="toggle">
            <span class="btn-ghost">
              <icon name="filter"></icon>
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
            <label>
              <setting-check name="filters.showEnabledFirst" />
              <span v-text="i18n('optionShowEnabledFirst')"></span>
            </label>
          </div>
        </dropdown>
        <div class="filter-search hidden-sm">
          <input type="search" :placeholder="i18n('labelSearchScript')" :title="searchError"
                 v-model="search">
          <icon name="search"></icon>
        </div>
      </header>
      <div
        v-if="showRecycle"
        class="trash-hint mx-1 my-1 text-center"
        v-text="i18n('hintRecycleBin')"
      />
      <div class="flex-auto pos-rel">
        <div class="scripts abs-full">
          <script-item
            v-for="(script, index) in sortedScripts"
            v-show="!search || script.$cache.show !== false"
            :key="script.props.id"
            :class="{ removing: removing && removing.id === script.props.id }"
            :script="script"
            :draggable="filters.sort.value === 'exec' && !script.config.removed"
            :visible="index < batchRender.limit"
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
import SettingCheck from '#/common/ui/setting-check';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import LocaleGroup from '#/common/ui/locale-group';
import { setRoute, lastRoute } from '#/common/router';
import storage from '#/common/storage';
import ScriptItem from './script-item';
import Edit from './edit';
import { store, showMessage } from '../utils';

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
const filters = {
  showEnabledFirst: null,
  sort: {
    value: null,
    title: null,
    set(value) {
      const option = filterOptions.sort[value];
      if (option) {
        filters.sort.value = value;
        filters.sort.title = option.title;
      } else {
        filters.sort.set(Object.keys(filterOptions.sort)[0]);
      }
    },
  },
};
const combinedCompare = cmpFunc => (
  filters.showEnabledFirst
    ? ((a, b) => b.config.enabled - a.config.enabled || cmpFunc(a, b))
    : cmpFunc
);
hookSetting('filters.showEnabledFirst', (value) => {
  filters.showEnabledFirst = value;
});
hookSetting('filters.sort', (value) => {
  filters.sort.set(value);
});
options.ready.then(() => {
  filters.sort.set(options.get('filters.sort'));
  filters.showEnabledFirst = options.get('filters.showEnabledFirst');
});

const MAX_BATCH_DURATION = 100;
let step = 0;

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
    };
  },
  watch: {
    search: 'scheduleSearch',
    'filters.sort.value': 'updateLater',
    'filters.showEnabledFirst': 'updateLater',
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
    trash() {
      return this.store.scripts.filter(script => script.config.removed);
    },
  },
  methods: {
    refreshUI() {
      this.onUpdate();
      this.onHashChange();
    },
    onUpdate() {
      const scripts = [...this.showRecycle ? this.trash : this.scripts];
      if (this.search) this.performSearch(scripts);
      const cmp = this.currentSortCompare;
      if (cmp) scripts.sort(combinedCompare(cmp));
      this.sortedScripts = scripts;
      this.debouncedRender();
    },
    updateLater() {
      this.debouncedUpdate();
    },
    updateAll() {
      sendCmd('CheckUpdateAll');
    },
    installFromURL() {
      new Promise((resolve, reject) => {
        showMessage({
          text: i18n('hintInputURL'),
          onBackdropClick: reject,
          buttons: [
            {
              type: 'submit',
              text: i18n('buttonOK'),
              onClick: resolve,
            },
            {
              text: i18n('buttonCancel'),
              onClick: reject,
            },
          ],
        });
      })
      .then((url) => {
        if (url && url.includes('://')) return sendCmd('ConfirmInstall', { url });
      })
      .catch((err) => {
        if (err) showMessage({ text: err });
      });
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
          this.canRenderScripts = true;
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
        if (step) {
          limit += step;
        } else {
          limit += 1;
        }
        batchRender.limit = limit;
        await new Promise(resolve => this.$nextTick(resolve));
        if (!step && performance.now() - startTime >= MAX_BATCH_DURATION) {
          step = limit;
        }
        if (step) await makePause();
      }
    },
    performSearch(scripts) {
      let searchRE;
      const [,
        expr = this.search.replace(/[.+^*$?|\\()[\]{}]/g, '\\$&'),
        flags = 'i',
      ] = this.search.match(/^\/(.+?)\/(\w*)$|$/);
      try {
        searchRE = expr && new RegExp(expr, flags);
        scripts.forEach(({ $cache }) => {
          $cache.show = !expr || searchRE.test($cache.search) || searchRE.test($cache.code);
        });
        this.searchError = null;
      } catch (err) {
        this.searchError = err.message;
      }
    },
    async scheduleSearch() {
      const { scripts } = this.store;
      if (scripts[0]?.$cache.code == null) {
        const ids = scripts.map(({ props: { id } }) => id);
        const data = await storage.code.getMulti(ids);
        ids.forEach((id, index) => {
          scripts[index].$cache.code = data[id];
        });
      }
      this.debouncedUpdate();
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
  },
};
</script>

<style>
.tab.tab-installed {
  padding: 0;
  header {
    height: 4rem;
    align-items: center;
    padding: 0 1rem;
    line-height: 1;
    border-bottom: 1px solid darkgray;
  }
  .vl-dropdown-menu {
    white-space: nowrap;
  }
  .vl-dropdown.active .vl-tooltip-wrap {
    display: none;
  }
}
.backdrop {
  text-align: center;
  color: gray;
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
  color: #666;
  cursor: pointer;
  &:hover {
    color: inherit;
    background: #fbfbfb;
  }
}
.filter-search {
  position: relative;
  width: 14rem;
  .icon {
    position: absolute;
    height: 100%;
    top: 0;
    right: .5rem;
  }
  > input {
    width: 100%;
    padding-left: .5rem;
    padding-right: 2rem;
    height: 2rem;
    &[title] {
      outline: 1px solid red;
    }
  }
}
.filter-sort {
  .vl-dropdown-menu {
    padding: 1rem;
    > * {
      margin-bottom: .5rem;
    }
  }
}

.trash-hint {
  line-height: 1.5;
  color: #999;
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
