<template>
  <div class="edit-keyboard">
    <table>
      <tr v-for="([key, cmd]) of hotkeys" :key="key">
        <th class="monospace-font">{{key}}</th>
        <td>{{cmd}}</td>
      </tr>
    </table>
  </div>
</template>

<script>
import CodeMirror from 'codemirror';

export default {
  props: ['target'],
  data() {
    return {
      hotkeys: null,
    };
  },
  mounted() {
    const cmOpts = this.target.cm.options;
    this.hotkeys = Object.entries(expandKeyMap({}, cmOpts.extraKeys, cmOpts.keyMap))
    .sort((a, b) => compareString(a, b, 1) || compareString(a, b, 0));
  },
};

function compareString(a, b, index) {
  return a[index] < b[index] ? -1 : a[index] > b[index];
}

function expandKeyMap(res, ...maps) {
  maps.forEach((map) => {
    if (typeof map === 'string') map = CodeMirror.keyMap[map];
    Object.entries(map).forEach(([key, value]) => {
      if (!res[key] && /^[a-z]+$/i.test(value)) {
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
.edit-keyboard {
  column-width: 20em;
  & th {
    text-align: right;
    padding-right: .5em;
  }
}
</style>
