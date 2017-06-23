<template>
  <div class="tab-installed">
    <header class="flex">
      <div class="flex-auto">
        <div v-dropdown="{autoClose: true}">
          <button dropdown-toggle>
            <svg class="icon"><use xlink:href="#plus" /></svg>
          </button>
          <div class="dropdown-menu">
            <a href="#" v-text="i18n('buttonNew')" @click.prevent="newScript"></a>
            <a v-text="i18n('installFrom', 'OpenUserJS')" href="https://openuserjs.org/" target="_blank"></a>
            <a v-text="i18n('installFrom', 'GreasyFork')" href="https://greasyfork.org/scripts" target="_blank"></a>
            <a href="#" v-text="i18n('buttonInstallFromURL')" @click.prevent="installFromURL"></a>
          </div>
        </div>
        <tooltip :title="i18n('buttonUpdateAll')" placement="down">
          <button @click="updateAll">
            <svg class="icon"><use xlink:href="#refresh" /></svg>
          </button>
        </tooltip>
      </div>
      <div class="filter-search">
        <input type="text" :placeholder="i18n('labelSearchScript')" v-model="search">
        <svg class="icon"><use xlink:href="#search" /></svg>
      </div>
      <div>
      </div>
    </header>
    <div class="scripts">
      <item v-for="script in scripts" :key="script.id"
      :script="script" @edit="editScript" @move="moveScript"></item>
    </div>
    <div class="backdrop" :class="{mask: store.loading}" v-show="message">
      <div v-html="message"></div>
    </div>
    <edit v-if="script" v-model="script" @close="endEditScript"></edit>
  </div>
</template>

<script>
import { i18n, sendMessage, noop, debounce } from 'src/common';
import Item from './script-item';
import Edit from './edit';
import { store, showMessage } from '../utils';
import Tooltip from './tooltip';

export default {
  components: {
    Item,
    Edit,
    Tooltip,
  },
  data() {
    return {
      store,
      script: null,
      search: null,
      scripts: store.scripts,
    };
  },
  watch: {
    search() {
      this.debouncedUpdate();
    },
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
      if (!this.scripts.length) {
        return i18n('labelNoSearchScripts');
      }
    },
  },
  methods: {
    onUpdate() {
      const { search } = this;
      const { scripts } = this.store;
      this.scripts = search
        ? scripts.filter(script => (script._search || '').includes(search.toLowerCase()))
        : scripts;
    },
    newScript() {
      sendMessage({ cmd: 'NewScript' })
      .then((script) => {
        this.script = script;
      });
    },
    updateAll() {
      sendMessage({ cmd: 'CheckUpdateAll' });
    },
    openURL(url) {
      window.open(url);
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
      this.script = this.store.scripts.find(script => script.id === id);
    },
    endEditScript() {
      this.script = null;
    },
    moveScript(data) {
      if (data.from === data.to) return;
      sendMessage({
        cmd: 'Move',
        data: {
          id: this.store.scripts[data.from].id,
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
  },
  created() {
    this.debouncedUpdate = debounce(this.onUpdate, 200);
  },
};
</script>

<style>
.tab-installed {
  padding: 0;
  > header {
    height: 3rem;
    align-items: center;
    padding: 0 .5rem;
    line-height: 1.5;
    border-bottom: 1px solid darkgray;
  }
  .dropdown-menu {
    padding: .5rem;
    white-space: nowrap;
    > a {
      display: block;
      width: 100%;
      padding: .5rem;
      text-decoration: none;
      color: #666;
      &:hover {
        color: inherit;
        background: #fbfbfb;
      }
    }
  }
}
.backdrop,
.scripts {
  position: absolute;
  top: 3rem;
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
</style>
