<template>
  <div
    class="script"
    :class="{ disabled: !script.config.enabled, removed: script.config.removed }"
    :draggable="draggable"
    @keydownEnter="onEdit">
    <img class="script-icon hidden-xs" :src="safeIcon">
    <div class="script-info flex">
      <div class="script-name ellipsis flex-auto" v-text="script.$cache.name"></div>
      <template v-if="canRender">
        <tooltip
          v-if="author"
          :content="i18n('labelAuthor') + script.meta.author"
          class="script-author ml-1 hidden-sm"
          align="end">
          <icon name="author"></icon>
          <a
            v-if="author.email"
            class="ellipsis ml-1"
            :href="`mailto:${author.email}`"
            v-text="author.name"
          />
          <span class="ellipsis ml-1" v-else v-text="author.name"></span>
        </tooltip>
        <tooltip class="ml-1 hidden-sm" :content="updatedAt.title" align="end">
          <span v-text="script.meta.version ? `v${script.meta.version}` : ''"></span>
          <span class="ml-1" v-text="updatedAt.show"></span>
        </tooltip>
        <div v-if="script.config.removed" class="ml-1">
          <tooltip :content="i18n('buttonRestore')" placement="left">
            <span class="btn-ghost" @click="onRestore">
              <icon name="undo"></icon>
            </span>
          </tooltip>
        </div>
      </template>
    </div>
    <template v-if="canRender">
      <div class="script-buttons flex">
        <div class="flex-auto flex flex-wrap">
          <tooltip :content="i18n('buttonEdit')" align="start">
            <span class="btn-ghost" @click="onEdit">
              <icon name="code"></icon>
            </span>
          </tooltip>
          <tooltip :content="labelEnable" align="start">
            <span class="btn-ghost" @click="onEnable">
              <icon :name="`toggle-${script.config.enabled ? 'on' : 'off'}`"></icon>
            </span>
          </tooltip>
          <tooltip
            :disabled="!canUpdate || script.checking"
            :content="i18n('buttonUpdate')"
            align="start">
            <span class="btn-ghost" @click="onUpdate">
              <icon name="refresh"></icon>
            </span>
          </tooltip>
          <span class="sep"></span>
          <tooltip :disabled="!homepageURL" :content="i18n('buttonHome')" align="start">
            <a class="btn-ghost" target="_blank" rel="noopener noreferrer" :href="homepageURL">
              <icon name="home"></icon>
            </a>
          </tooltip>
          <tooltip :disabled="!description" :content="description" align="start">
            <span class="btn-ghost">
              <icon name="info"></icon>
            </span>
          </tooltip>
          <tooltip
            :disabled="!script.meta.supportURL"
            :content="i18n('buttonSupport')"
            align="start">
            <a
              class="btn-ghost"
              target="_blank"
              rel="noopener noreferrer"
              :href="script.meta.supportURL">
              <icon name="question"></icon>
            </a>
          </tooltip>
          <div class="script-message" v-text="script.message"></div>
        </div>
        <tooltip :content="i18n('buttonRemove')" align="end">
          <span class="btn-ghost" @click="onRemove">
            <icon name="trash"></icon>
          </span>
        </tooltip>
      </div>
    </template>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { sendCmd, getLocaleString, formatTime } from '#/common';
import { objectGet } from '#/common/object';
import Icon from '#/common/ui/icon';
import { store } from '../utils';
import enableDragging from '../utils/dragging';

const DEFAULT_ICON = '/public/images/icon48.png';
const images = {};
function loadImage(url) {
  if (!url) return Promise.reject();
  let promise = images[url];
  if (!promise) {
    const cache = store.cache[url];
    promise = cache
      ? Promise.resolve(cache)
      : new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => reject(url);
        img.src = url;
      });
    images[url] = promise;
  }
  return promise;
}

export default {
  props: [
    'script',
    'draggable',
    'visible',
  ],
  components: {
    Icon,
    Tooltip,
  },
  data() {
    return {
      safeIcon: DEFAULT_ICON,
      canRender: this.visible,
    };
  },
  computed: {
    canUpdate() {
      const { script } = this;
      return script.config.shouldUpdate && (
        script.custom.updateURL
        || script.meta.updateURL
        || script.custom.downloadURL
        || script.meta.downloadURL
        || script.custom.lastInstallURL
      );
    },
    homepageURL() {
      const { script } = this;
      return script.custom.homepageURL || script.meta.homepageURL || script.meta.homepage;
    },
    author() {
      const text = this.script.meta.author;
      if (!text) return;
      const matches = text.match(/^(.*?)\s<(\S*?@\S*?)>$/);
      return {
        email: matches && matches[2],
        name: matches ? matches[1] : text,
      };
    },
    labelEnable() {
      return this.script.config.enabled ? this.i18n('buttonDisable') : this.i18n('buttonEnable');
    },
    description() {
      return this.script.custom.description || getLocaleString(this.script.meta, 'description');
    },
    updatedAt() {
      const { props, config } = this.script;
      const ret = {};
      let lastModified;
      if (config.removed) {
        ({ lastModified } = props);
      } else {
        // XXX use `lastModified` as a fallback for scripts without `lastUpdated`
        lastModified = props.lastUpdated || props.lastModified;
      }
      if (lastModified) {
        const date = new Date(lastModified);
        ret.show = formatTime(Date.now() - lastModified);
        if (config.removed) {
          ret.title = this.i18n('labelRemovedAt', date.toLocaleString());
        } else {
          ret.title = this.i18n('labelLastUpdatedAt', date.toLocaleString());
        }
      }
      return ret;
    },
  },
  watch: {
    visible(visible) {
      // Leave it if the element is already rendered
      if (visible) this.canRender = true;
    },
  },
  mounted() {
    const { icon } = this.script.meta;
    if (icon && icon !== this.safeIcon) {
      const pathMap = objectGet(this.script, 'custom.pathMap') || {};
      const fullUrl = pathMap[icon] || icon;
      loadImage(fullUrl)
      .then((url) => {
        this.safeIcon = url;
      }, () => {
        this.safeIcon = DEFAULT_ICON;
      });
    }
    enableDragging(this.$el, {
      onDrop: (from, to) => this.$emit('move', { from, to }),
    });
  },
  methods: {
    onEdit() {
      this.$emit('edit', this.script.props.id);
    },
    markRemoved(removed) {
      sendCmd('MarkRemoved', {
        id: this.script.props.id,
        removed,
      });
    },
    onRemove() {
      const rect = this.$el.getBoundingClientRect();
      this.markRemoved(1);
      this.$emit('remove', this.script.props.id, rect);
    },
    onRestore() {
      this.markRemoved(0);
    },
    onEnable() {
      sendCmd('UpdateScriptInfo', {
        id: this.script.props.id,
        config: {
          enabled: this.script.config.enabled ? 0 : 1,
        },
      });
    },
    onUpdate() {
      sendCmd('CheckUpdate', this.script.props.id);
    },
  },
};
</script>

<style>
@import '../utils/dragging.css';

$rem: 14px;

$iconSize: calc(3 * $rem);
$iconSizeSmaller: calc(2 * $rem);
$actionIconSize: calc(2 * $rem);

$nameFontSize: $rem;

$itemLineHeight: 1.5;
$itemPadT: 12px;
$itemPadB: 5px;
$itemHeight: calc(
  $nameFontSize * $itemLineHeight +
  $actionIconSize + 2px /* icon borders */ +
  $itemPadT + $itemPadB + 2px /* item borders */
);

$removedItemPadB: 10px;
$removedItemHeight: calc(
  $actionIconSize + 2px /* icon borders */ +
  $itemPadT + $removedItemPadB + 2px /* item borders */
);

.script {
  position: relative;
  margin: 8px;
  padding: $itemPadT 10px $itemPadB;
  border: 1px solid #ccc;
  border-radius: .3rem;
  transition: transform .25s;
  // added in Chrome 41, FF64
  @media (pointer: coarse) {
    transition: none;
  }
  // fallback for pre-FF64
  .touch & {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
  background: white;
  height: $itemHeight;
  &:hover {
    border-color: darkgray;
  }
  .secondary {
    color: gray;
    font-size: small;
  }
  &.disabled,
  &.removed {
    background: #f0f0f0;
    color: #999;
  }
  &.disabled {
    .secondary {
      color: darkgray;
    }
  }
  &.removed {
    height: $removedItemHeight;
    padding-bottom: $removedItemPadB;
    .secondary {
      display: none;
    }
  }
  &.focused {
    box-shadow: 1px 2px 9px gray;
  }
  &-buttons {
    line-height: 1;
    color: #3e4651;
    > .flex {
      align-items: center;
    }
    .removed & {
      display: none;
    }
    .disabled {
      color: gainsboro;
    }
    .icon {
      display: block;
    }
  }
  &-info {
    line-height: $itemLineHeight;
    align-items: center;
  }
  &-icon {
    position: absolute;
    width: $iconSize;
    height: $iconSize;
    top: 1rem;
    .disabled &,
    .removed & {
      filter: grayscale(.8);
    }
    .removed & {
      width: $iconSizeSmaller;
      height: $iconSizeSmaller;
    }
    ~ * {
      margin-left: calc($iconSize + $rem / 2);
    }
  }
  &-name {
    font-weight: 500;
    font-size: $nameFontSize;
    .disabled & {
      color: gray;
    }
  }
  &-author {
    display: flex;
    align-items: center;
    > .ellipsis {
      display: inline-block;
      max-width: 100px;
    }
  }
  &-message {
    white-space: nowrap;
  }
}

@media (max-width: 319px) {
  .script-icon ~ * {
    margin-left: 0;
  }
}
</style>
