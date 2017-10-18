<template>
  <div class="tab-installed">
    <header class="flex">
      <div class="flex-auto">
        <vl-dropdown :closeAfterClick="true">
          <tooltip :title="i18n('buttonNew')" placement="down" align="start" slot="toggle">
            <span class="btn-ghost">
              <icon name="plus"></icon>
            </span>
          </tooltip>
          <div class="dropdown-menu-item" v-text="i18n('buttonNew')" @click.prevent="newScript"></div>
          <a class="dropdown-menu-item" v-text="i18n('installFrom', 'OpenUserJS')" href="https://openuserjs.org/" target="_blank"></a>
          <a class="dropdown-menu-item" v-text="i18n('installFrom', 'GreasyFork')" href="https://greasyfork.org/scripts" target="_blank"></a>
          <div class="dropdown-menu-item" v-text="i18n('buttonInstallFromURL')" @click.prevent="installFromURL"></div>
        </vl-dropdown>
        <tooltip :title="i18n('buttonUpdateAll')" placement="down" align="start">
          <span class="btn-ghost" @click="updateAll">
            <icon name="refresh"></icon>
          </span>
        </tooltip>
      </div>
      <vl-dropdown align="right" class="filter-sort">
        <tooltip :title="i18n('buttonFilter')" placement="down" slot="toggle">
          <span class="btn-ghost">
            <icon name="filter"></icon>
          </span>
        </tooltip>
        <div>
          <locale-group i18n-key="labelFilterSort">
            <select :value="filters.sort.value" @change="onOrderChange">
              <option
                v-for="option in filterOptions.sort"
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
      </vl-dropdown>
      <div class="filter-search">
        <input type="text" :placeholder="i18n('labelSearchScript')" v-model="search">
        <icon name="search"></icon>
      </div>
    </header>
    <div class="scripts">
      <item v-for="script in store.filteredScripts" :key="script.props.id"
      :script="script" :draggable="filters.sort.value === 'exec' && !script.config.removed"
      @edit="editScript" @move="moveScript"></item>
    </div>
    <div class="backdrop" :class="{mask: store.loading}" v-show="message">
      <div v-html="message"></div>
    </div>
    <edit v-if="script" :initial="script" @close="endEditScript"></edit>
  </div>
</template>

<script>
import VlDropdown from 'vueleton/lib/dropdown';
import { i18n, sendMessage, noop, debounce } from 'src/common';
import { objectGet } from 'src/common/object';
import options from 'src/common/options';
import SettingCheck from 'src/common/ui/setting-check';
import hookSetting from 'src/common/hook-setting';
import Icon from 'src/common/ui/icon';
import Tooltip from 'src/common/ui/tooltip';
import LocaleGroup from 'src/common/ui/locale-group';
import Item from './script-item';
import Edit from './edit';
import { store, showMessage } from '../utils';

const filterOptions = {
  sort: [
    { value: 'exec', title: i18n('filterExecutionOrder') },
    { value: 'alpha', title: i18n('filterAlphabeticalOrder') },
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
hookSetting('filters.sort', value => {
  filters.sort.set(value);
});
options.ready(() => {
  filters.sort.set(options.get('filters.sort'));
});

export default {
  components: {
    Item,
    Edit,
    Tooltip,
    SettingCheck,
    LocaleGroup,
    VlDropdown,
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
    };
  },
  watch: {
    search: 'updateLater',
    'filters.sort.value': 'updateLater',
    'store.scripts': 'onUpdate',
  },
  computed: {
    message() {
      if (this.store.loading) {
        return i18n('msgLoading');
      }
      if (!this.store.scripts.length) {
        return i18n('labelNoScripts');
      }
      if (!objectGet(this.store, 'filteredScripts.length')) {
        return i18n('labelNoSearchScripts');
      }
    },
  },
  methods: {
    onUpdate() {
      const { search, filters: { sort } } = this;
      const lowerSearch = (search || '').toLowerCase();
      const { scripts } = this.store;
      const filteredScripts = search
        ? scripts.filter(script => script._cache.search.includes(lowerSearch))
        : scripts.slice();
      if (sort.value === 'alpha') {
        const showEnabledFirst = options.get('filters.showEnabledFirst');
        filteredScripts.sort((a, b) => {
          if (showEnabledFirst && a.config.enabled !== b.config.enabled) {
            return a.config.enabled ? -1 : 1;
          }
          const { _cache: { lowerName: nameA } } = a;
          const { _cache: { lowerName: nameB } } = b;
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        });
      }
      this.store.filteredScripts = filteredScripts;
    },
    updateLater() {
      this.debouncedUpdate();
    },
    newScript() {
      this.script = {};
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
      .then(url => {
        if (url && url.includes('://')) return sendMessage({ cmd: 'ConfirmInstall', data: { url } });
      }, noop)
      .catch(err => {
        if (err) showMessage({ text: err });
      });
    },
    editScript(id) {
      this.script = this.store.scripts.find(script => script.props.id === id);
    },
    endEditScript() {
      this.script = null;
    },
    moveScript(data) {
      if (data.from === data.to) return;
      sendMessage({
        cmd: 'Move',
        data: {
          id: this.store.scripts[data.from].props.id,
          offset: data.to - data.from,
        },
      })
      .then(() => {
        const { scripts } = this.store;
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
        this.store.scripts = seq.concat.apply([], seq);
      });
    },
    onOrderChange(e) {
      options.set('filters.sort', e.target.value);
    },
  },
  created() {
    this.debouncedUpdate = debounce(this.onUpdate, 200);
    this.onUpdate();
  },
};
</script>

<style>
$header-height: 4rem;

.tab-installed {
  padding: 0;
  > header {
    height: $header-height;
    align-items: center;
    padding: 0 1rem;
    line-height: 1;
    border-bottom: 1px solid darkgray;
  }
  .vl-dropdown-menu {
    white-space: nowrap;
  }
}
.backdrop,
.scripts {
  position: absolute;
  top: $header-height;
  left: 0;
  right: 0;
  bottom: 0;
}
.scripts {
  overflow-y: auto;
}
.backdrop {
  text-align: center;
  color: gray;
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
  width: 12rem;
  .icon {
    position: absolute;
    height: 100%;
    top: 0;
    right: .5rem;
  }
  > input {
    padding-left: .5rem;
    padding-right: 2rem;
    line-height: 2;
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
</style>
