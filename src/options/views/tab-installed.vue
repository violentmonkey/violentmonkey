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
                  v-for="option in filterOptions.sort"
                  :key="option.value"
                  v-text="option.title"
                  :value="option.value">
                </option>
              </select>
            </locale-group>
          </div>
          <div v-if="filters.sort.value === 'alpha'">
            <label>
              <setting-check name="filters.showEnabledFirst" @change="updateLater"></setting-check>
              <span v-text="i18n('optionShowEnabledFirst')"></span>
            </label>
          </div>
        </dropdown>
        <div class="filter-search hidden-sm">
          <input type="search" :placeholder="i18n('labelSearchScript')" v-model="search">
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
            v-for="script in sortedScripts"
            v-show="!search || script.$cache.show !== false"
            :key="script.props.id"
            :class="{ removing: removing && removing.id === script.props.id }"
            :script="script"
            :draggable="filters.sort.value === 'exec' && !script.config.removed"
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
  i18n, sendMessage, debounce,
} from '#/common';
import options from '#/common/options';
import SettingCheck from '#/common/ui/setting-check';
import hookSetting from '#/common/hook-setting';
import Icon from '#/common/ui/icon';
import LocaleGroup from '#/common/ui/locale-group';
import { setRoute, lastRoute } from '#/common/router';
import ScriptItem from './script-item';
import Edit from './edit';
import { store, showMessage } from '../utils';

const SORT_EXEC = { value: 'exec', title: i18n('filterExecutionOrder') };
const SORT_ALPHA = { value: 'alpha', title: i18n('filterAlphabeticalOrder') };
const SORT_UPDATE = { value: 'update', title: i18n('filterLastUpdateOrder') };
const filterOptions = {
  sort: [
    SORT_EXEC,
    SORT_ALPHA,
    SORT_UPDATE,
  ],
};
const filters = {
  sort: {
    value: null,
    title: null,
    set(value) {
      const option = filterOptions.sort.find(item => item.value === value);
      const { sort } = filters;
      if (!option) {
        sort.set(filterOptions.sort[0].value);
        return;
      }
      sort.value = option && option.value;
      sort.title = option && option.title;
    },
  },
};
hookSetting('filters.sort', (value) => {
  filters.sort.set(value);
});
options.ready.then(() => {
  filters.sort.set(options.get('filters.sort'));
});

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
      modal: null,
      menuNewActive: false,
      showRecycle: false,
      sortedScripts: [],
      removing: null,
      // Speedup and deflicker for initial page load:
      // skip rendering the script list when starting in the editor.
      canRenderScripts: !store.route.paths[1],
    };
  },
  watch: {
    search: 'updateLater',
    'filters.sort.value': 'updateLater',
    showRecycle: 'onUpdate',
    scripts: 'refreshUI',
    'store.route.paths.1': 'onHashChange',
  },
  computed: {
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
      const { search, filters: { sort }, showRecycle } = this;
      const scripts = showRecycle ? this.trash : this.scripts;
      const sortedScripts = [...scripts];
      if (search) {
        const lowerSearch = (search || '').toLowerCase();
        for (const { $cache } of scripts) {
          $cache.show = $cache.search.includes(lowerSearch);
        }
      }
      if (sort.value === SORT_ALPHA.value) {
        const showEnabledFirst = options.get('filters.showEnabledFirst');
        const getSortKey = (item) => {
          const keys = [];
          if (showEnabledFirst) {
            keys.push(item.config.enabled ? 0 : 1);
          }
          keys.push(item.$cache.lowerName);
          return keys.join('');
        };
        sortedScripts.sort((a, b) => {
          const nameA = getSortKey(a);
          const nameB = getSortKey(b);
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        });
      } else if (sort.value === SORT_UPDATE.value) {
        const getSortKey = item => +item.props.lastUpdated || 0;
        sortedScripts.sort((a, b) => getSortKey(b) - getSortKey(a));
      }
      this.sortedScripts = sortedScripts;
    },
    updateLater() {
      this.debouncedUpdate();
    },
    updateAll() {
      sendMessage({ cmd: 'CheckUpdateAll' });
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
        if (url && url.includes('://')) return sendMessage({ cmd: 'ConfirmInstall', data: { url } });
      })
      .catch((err) => {
        if (err) showMessage({ text: err });
      });
    },
    moveScript(data) {
      if (data.from === data.to) return;
      sendMessage({
        cmd: 'Move',
        data: {
          id: this.scripts[data.from].props.id,
          offset: data.to - data.from,
        },
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
  },
  created() {
    this.debouncedUpdate = debounce(this.onUpdate, 100);
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
