<template>
  <div class="edit-externals flex flex-col">
    <select class="monospace-font" v-model="index"
            :size="Math.max(2, all.length)"
            :data-size="all.length">
      <option v-for="([type, url], i) of all" :key="i"
              class="ellipsis" v-text="url" :value="i" :data-type="type" />
    </select>
    <div class="contents pos-rel flex-auto">
      <img v-if="img" :src="img">
      <vm-code v-else class="abs-full"
               v-model="code" :readonly="true" :mode="mode" ref="code" />
    </div>
  </div>
</template>

<script>
import VmCode from '#/common/ui/code';
import storage from '#/common/storage';

export default {
  props: ['script', 'isRes'],
  components: { VmCode },
  data() {
    const { require, resources } = this.script.meta;
    return {
      all: [
        ...require.map(url => ['@require', url]),
        ...Object.entries(resources).map(([name, url]) => [`@resource ${name}`, url]),
      ],
      code: null,
      img: null,
      index: null,
      mode: null,
    };
  },
  watch: {
    async index(val) {
      const [type, url] = this.all[val];
      const isReq = type === '@require';
      const key = this.script.custom.pathMap?.[url] || url;
      let raw = await storage[isReq ? 'require' : 'cache'].getOne(key);
      if (!isReq) raw = storage.cache.makeDataUri(key, raw);
      let img;
      let code;
      let contentType;
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
      this.img = img;
      this.mode = contentType === 'text/css' || /\.css([#&?]|$)/i.test(url) ? 'css' : null;
      this.code = code;
    },
  },
  async mounted() {
    this.index = 0;
  },
};
</script>

<style>
.edit-externals {
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
      padding: 0 1rem;
      &:checked {
        font-weight: bold;
      }
      &::before {
        content: attr(data-type) " ";
        font-style: italic;
        color: var(--fill-8);
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
