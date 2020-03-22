<template>
  <div class="edit-help">
    <div>
      <h3 v-html="i18n('editHelpDocumention')"/>
      <a href="https://violentmonkey.github.io/api/"
         rel="noopener noreferrer" target="_blank">violentmonkey.github.io/api/</a>
    </div>
    <div class="keyboard">
      <h3 v-text="i18n('editHelpKeyboard')"/>
      <dl v-for="([key, cmd]) of hotkeys" :key="key">
        <dt class="monospace-font" v-text="key"></dt>
        <dd v-text="cmd"></dd>
      </dl>
    </div>
  </div>
</template>

<script>
import CodeMirror from 'codemirror';
import { forEachEntry } from '#/common/object';

export default {
  props: ['active', 'navLabels', 'target'],
  data() {
    return {
      hotkeys: null,
    };
  },
  watch: {
    active(val) {
      if (val && !this.hotkeys) {
        const cmOpts = this.target.cm.options;
        this.hotkeys = [
          ['Alt-PageUp', ` ${this.navLabels.join(' < ')}`],
          ['Alt-PageDown', ` ${this.navLabels.join(' > ')}`],
          ...Object.entries(expandKeyMap({}, cmOpts.extraKeys, cmOpts.keyMap))
          .sort((a, b) => compareString(a, b, 1) || compareString(a, b, 0)),
        ];
      }
    },
  },
};

function compareString(a, b, index) {
  return a[index] < b[index] ? -1 : a[index] > b[index];
}

function expandKeyMap(res, ...maps) {
  maps.forEach((map) => {
    if (typeof map === 'string') map = CodeMirror.keyMap[map];
    map::forEachEntry(([key, value]) => {
      if (!res[key] && /^[a-z]+$/i.test(value) && CodeMirror.commands[value]) {
        res[key] = value;
      }
    });
    if (map.fallthrough) expandKeyMap(res, map.fallthrough);
  });
  delete res.fallthrough;
  return res;
}
</script>

<style>
.edit-help {
  > * {
    margin-bottom: 1em;
  }
  h3 {
    margin: .5em 0;
  }
  .keyboard {
    column-width: 25em;
    h3 {
      column-span: all;
    }
    dl {
      display: flex;
      align-items: center;
      padding: .25em 0;
    }
    dt {
      text-align: right;
      padding-right: .5em;
      flex: 0 40%;
      font-weight: bold;
    }
  }
}
</style>
