<template>
  <div class="edit-externals flex flex-col">
    <select v-model="index"
            v-if="!install || all.length > 1"
            :size="Math.max(2, all.length)"
            :data-size="all.length">
      <option
        v-for="([type, url], i) of all" :key="i"
        v-text="decodeURIComponent(url)"
        class="ellipsis"
        :disabled="i > 0 && install && !(url in install.deps)"
        :data-is-main="!i && install ? '' : null"
        :data-type="type"
        :value="i"/>
    </select>
    <div class="contents pos-rel h-100">
      <img v-if="img" :src="img">
      <vm-code
        class="abs-full"
        v-model="code"
        ref="code"
        readonly
        :cm-options="cmOptions"
        :mode="mode"
      />
    </div>
  </div>
</template>

<script>
import { objectEntries } from '#/common/object';
import VmCode from '#/common/ui/code';
import storage from '#/common/storage';

export default {
  props: ['value', 'cmOptions', 'commands', 'install'],
  components: { VmCode },
  computed: {
    all() {
      const { url: mainUrl } = this.install || {};
      const { require = [], resources = {} } = this.value.meta || {};
      return [
        ...mainUrl ? [[this.i18n('editNavCode'), mainUrl]] : [],
        ...require.map(url => ['@require', url]),
        ...objectEntries(resources).map(([name, url]) => [`@resource ${name}`, url]),
      ];
    },
  },
  data() {
    return {
      code: null,
      img: null,
      index: null,
      mode: null,
    };
  },
  watch: {
    async index(index) {
      const [type, url] = this.all[index] || [];
      if (!url) return;
      const { install } = this;
      const isMain = install && !index;
      const isReq = !isMain && type === '@require';
      let code;
      let contentType;
      let img;
      let raw;
      if (isMain) {
        code = install.code;
      } else {
        if (install) {
          raw = install.deps[url];
        } else {
          const key = this.value.custom.pathMap?.[url] || url;
          raw = await storage[isReq ? 'require' : 'cache'].getOne(key);
          if (!isReq) raw = storage.cache.makeDataUri(key, raw);
        }
        if (isReq || !raw) {
          code = raw;
        } else if (raw.startsWith('data:image')) {
          img = raw;
        } else {
          [contentType, code] = raw.split(',');
          if (code == null) { // workaround for bugs in old VM, see 2e135cf7
            const fileExt = url.match(/\.(\w+)([#&?]|$)/)?.[1] || '';
            contentType = /^(png|jpe?g|bmp|svgz?|gz|zip)$/i.test(fileExt)
              ? ''
              : `text/${fileExt.toLowerCase()}`;
            code = raw;
          }
          code = atob(code);
          if (/[\x80-\xFF]/.test(code)) {
            const len = code.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i += 1) {
              bytes[i] = code.charCodeAt(i);
            }
            code = new TextDecoder().decode(bytes);
          }
        }
      }
      this.img = img;
      this.mode = contentType === 'text/css' || /\.css([#&?]|$)/i.test(url) ? 'css' : null;
      this.code = code;
    },
    value() {
      this.$nextTick(() => {
        if (this.index >= this.all.length) this.index = 0;
      });
    },
  },
  async mounted() {
    this.index = 0;
  },
};
</script>

<style>
$optPad: 1rem;
$mainEntryBorder: 6px double;

.edit-externals {
  border-top: $mainEntryBorder var(--fill-8);
  > select {
    min-height: 1.25rem;
    max-height: 15vh;
    padding: 1rem 0;
    overflow-y: auto;
    border: solid var(--fill-3);
    border-width: 2px 0 2px 0;
    &[data-size="1"] {
      padding-bottom: 0;
    }
    option {
      padding-right: $optPad;
      &:checked {
        font-weight: bold;
      }
      &::before {
        content: attr(data-type);
        color: var(--fill-8);
        margin-right: .5em;
        padding: 0 .5em 0 $optPad;
        font-family: monospace;
      }
      &[data-is-main] {
        border-bottom: $mainEntryBorder var(--fill-7);
      }
    }
  }
  > .contents {
    > img {
      padding: 1rem;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  }
}
</style>
