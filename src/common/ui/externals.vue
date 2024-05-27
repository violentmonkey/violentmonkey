<template>
  <div class="edit-externals flex flex-col">
    <div v-if="!install || all.length > 1" class="select"
         ref="$list" focusme @keydown="moveIndex" @scroll="saveScroll"
         :data-has-main="install ? '' : null">
      <dl v-for="([type, url, contents], i) of all" :key="i"
          class="flex"
          :class="{
            active: index === i,
            loading: install && i && contents == null,
            error: contents === false,
          }"
          @click="contents !== false && (index = i)">
        <dt v-text="type"/>
        <dd class="ellipsis flex-1">
          <a :href="url" target="_blank">&nearr;</a>
          <span v-text="decodeURIComponent(url)"/>
        </dd>
        <dd v-if="contents" v-text="formatLength(contents, type)" class="ml-2"/>
      </dl>
    </div>
    <div class="contents pos-rel flex-1">
      <KeepAlive :key="data.key" :max="10" ref="$body">
      <img v-if="data.img" :src="data.img">
      <VmCode
        v-else
        class="abs-full"
        :value="data.code"
        ref="$code"
        readOnly
        :cm-options="cmOptions"
        :mode="data.mode"
        :commands="{...commands, close: () => $list?.focus() }"
        :active="isActive && !data.img"
      />
      </KeepAlive>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, ref, watchEffect } from 'vue';
import { dataUri2text, formatByteLength, i18n, makeDataUri, sendCmdDirectly } from '@/common';
import VmCode from '@/common/ui/code';
import { focusMe, hasKeyModifiers } from '@/common/ui/index';

const props = defineProps(['value', 'cmOptions', 'commands', 'install']);
const $body = ref();
const $code = ref();
const $list = ref();
const isActive = ref();
const dependencies = ref({});
const index = ref(0);
const data = ref({});

const all = computed(() => {
  const { code, deps = dependencies.value, url: mainUrl } = props.install || {};
  const { require = [], resources = {} } = props.value.meta || {};
  return [
    ...mainUrl ? [[i18n('editNavCode'), mainUrl, code]] : [],
    ...require.map(url => ['@require', url, deps[`0${url}`]]),
    ...Object.entries(resources).map(([id, url]) => [`@resource ${id}`, url, deps[`1${url}`]]),
  ];
});

const MOVEMENT = {
  ArrowDown: 1,
  ArrowUp: -1,
  PageDown: 10,
  PageUp: -10,
  Home: -1e9,
  End: 1e9,
  Enter: 0,
};
const scrollIntoViewIfNeeded = Element.prototype.scrollIntoViewIfNeeded
|| function (center = true) {
  const parent = this.parentElement.getBoundingClientRect();
  const me = this.getBoundingClientRect();
  if (me.bottom > parent.bottom || me.top < parent.top) {
    this.scrollIntoView(center ? { block: 'center' } : undefined);
  }
};
let listScrollTop;

defineExpose({
  $code, // used by parent
});
onActivated(() => {
  isActive.value = true;
  ($list.value || {}).scrollTop = listScrollTop || 0;
});
onDeactivated(() => {
  isActive.value = false;
});
watchEffect(update);

async function update() {
  const [type, url] = all.value[index.value];
  if (!url) return;
  const { install } = props;
  const isMain = install && !index.value;
  const isDataUri = url.startsWith('data:');
  const isReq = !isMain && !isDataUri && type === '@require';
  const depsUrl = `${+!isReq}${url}`;
  let code;
  let contentType;
  let img;
  let raw;
  if (isMain) {
    code = install.code;
  } else {
    if (isDataUri) {
      raw = url;
    } else if (install) {
      raw = install.deps[depsUrl];
    } else {
      const key = props.value.custom.pathMap?.[url] || url;
      raw = await sendCmdDirectly('Storage', [isReq ? 'require' : 'cache', 'getOne', key]);
      if (!isReq) raw = makeDataUri(raw, key);
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
      } else if (contentType) {
        contentType = contentType.split(/[:;]/)[1];
      }
      code = dataUri2text(isDataUri ? url : `${contentType};base64,${code}`);
    }
  }
  data.value = {
    img,
    code,
    key: depsUrl,
    mode: contentType === 'text/css' || /\.css([#&?]|$)/i.test(url) ? 'css' : null,
  };
  dependencies.value[depsUrl] = img || code;
}

function formatLength(str, type) {
  let len = str?.length;
  if (type.startsWith('@resource')) {
    len = Math.round((len - str.indexOf(',') - 1) * 6 / 8); // base64 uses 6 bits out of 8
  }
  return formatByteLength(len);
}
async function moveIndex(evt) {
  if (hasKeyModifiers(evt)) return;
  const delta = MOVEMENT[evt.key];
  if (delta === 0 && !data.value.img) focusMe($body.value.$el);
  if (!delta) return;
  evt.preventDefault();
  const i = index.value + delta;
  const len = all.value.length;
  index.value = delta < -1 || delta > 1
      ? Math.max(0, Math.min(len - 1, i))
      : (i + len) % len;
  await nextTick();
  $list.value.querySelector('.active')::scrollIntoViewIfNeeded();
}
function saveScroll() {
  listScrollTop = $list.value.scrollTop;
}
</script>

<style>
$outerPadX: 1rem;
$mainEntryBorder: 6px double;
.edit-externals {
  --border: $mainEntryBorder var(--fill-8);
  border-top: var(--border);
  > .select {
    min-height: 1.25rem;
    max-height: 15vh;
    overflow-y: auto;
    border-bottom: 2px solid var(--fill-3);
    padding-bottom: calc($outerPadX/2);
    &:focus .active span {
      text-decoration: underline;
    }
    &[data-has-main] dl:first-child {
      padding-top: .5em;
      padding-bottom: .5em;
      border-bottom: 1px solid var(--fill-3);
      position: sticky;
      top: 0;
      background: var(--bg);
    }
    dl {
      padding-right: $outerPadX;
      align-items: center;
      white-space: nowrap;
      &.active {
        font-weight: bold;
        color: blue;
      }
      &.loading dd {
        color: var(--fill-7);
      }
      &.error dd {
        color: red;
      }
      &:not(.error) {
        cursor: pointer;
        &:hover dd {
          text-decoration: underline;
          a {
            text-decoration: none;
          }
        }
      }
    }
    dt {
      color: darkblue;
      margin-left: $outerPadX;
      font-family: monospace;
    }
    a {
      padding: 0 .5em;
      cursor: alias;
      &:hover {
        background: var(--fill-3);
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
  @media (prefers-color-scheme: dark) {
    .select {
      &.error dd {
        color: #ff4747;
      }
      dl.active {
        color: coral;
        dt {
          color: hotpink;
        }
      }
      dt {
        color: #c34ec3;
      }
    }
  }
}
</style>
