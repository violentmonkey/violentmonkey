<template>
  <div
    class="script"
    :class="{
      disabled: !script.config.enabled,
      removed: script.config.removed,
      error: script.error,
    }"
    :draggable="draggable"
    @keydownEnter="onEdit">
    <img class="script-icon hidden-xs" :src="script.safeIcon" @click="onEdit">
    <div class="script-info flex ml-1c">
      <div class="script-name ellipsis flex-auto" v-text="script.$cache.name"
           @click.exact="nameClickable && onEdit()"/>
      <template v-if="canRender">
        <tooltip v-if="author" :content="i18n('labelAuthor') + script.meta.author"
                 class="script-author ml-1c hidden-sm"
                 align="end">
          <icon name="author" />
          <a
            v-if="author.email"
            class="ellipsis"
            :href="`mailto:${author.email}`"
            v-text="author.name"
          />
          <span class="ellipsis" v-else v-text="author.name" />
        </tooltip>
        <tooltip class="hidden-sm ml-1c" :content="updatedAt.title" align="end">
          <span v-text="script.meta.version ? `v${script.meta.version}` : ''"></span>
          <span v-text="updatedAt.show"></span>
        </tooltip>
        <div v-if="script.config.removed">
          <tooltip :content="i18n('buttonRestore')" placement="left">
            <span class="btn-ghost" @click="onRestore">
              <icon name="undo"></icon>
            </span>
          </tooltip>
        </div>
      </template>
    </div>
    <div class="script-buttons flex">
      <template v-if="canRender">
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
          <div class="script-message" v-text="script.message" :title="script.error"></div>
        </div>
        <tooltip :content="i18n('buttonRemove')" align="end">
          <span class="btn-ghost" @click="onRemove">
            <icon name="trash"></icon>
          </span>
        </tooltip>
      </template>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { sendCmd, getLocaleString, formatTime } from '#/common';
import Icon from '#/common/ui/icon';
import enableDragging from '../utils/dragging';

export default {
  props: [
    'script',
    'draggable',
    'visible',
    'nameClickable',
  ],
  components: {
    Icon,
    Tooltip,
  },
  data() {
    return {
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
// The icon should use the real size we generate in `dist` to ensure crispness
$iconSize: 38px;
$iconSizeSmaller: 32px;
$actionIconSize: calc(2 * $rem);

$nameFontSize: $rem;

$itemLineHeight: 1.5;
$itemMargin: 8px;
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
  margin: $itemMargin;
  padding: $itemPadT 10px $itemPadB;
  border: 1px solid var(--fill-3);
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
  background: var(--bg);
  height: $itemHeight;
  &:hover {
    border-color: var(--fill-5);
  }
  .secondary {
    color: var(--fill-8);
    font-size: small;
  }
  &.disabled,
  &.removed {
    background: var(--fill-1);
    color: var(--fill-6);
  }
  &.disabled {
    .secondary {
      color: var(--fill-5);
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
    box-shadow: 1px 2px 9px var(--fill-8);
  }
  &.error {
    border-color: #f008;
    [*|href="#refresh"] {
      fill: #f00;
    }
    .script-message {
      color: #f00;
    }
  }
  &-buttons {
    line-height: 1;
    color: hsl(215, 13%, 28%);
    @media (prefers-color-scheme: dark) {
      color: hsl(215, 10%, 55%);
    }
    > .flex {
      align-items: center;
    }
    .removed & {
      display: none;
    }
    .disabled {
      color: var(--fill-2);
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
    top: 0;
    bottom: 0;
    margin: auto;
    cursor: pointer;
    &:not([src]) {
      visibility: hidden; // hiding the empty outline border while the image loads
    }
    .disabled &,
    .removed & {
      filter: grayscale(.8);
      opacity: .5;
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
      color: var(--fill-8);
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

.scripts {
  &:not([data-columns="1"]) {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    padding: 0 $itemMargin;
    .script {
      // --num-columns is set in tab-installed.vue
      width: calc(100% / var(--num-columns) - (2 * $itemMargin));
    }
  }
  &[data-table] {
    &[data-columns="1"] .script {
      margin: 0;
      border-left: none;
      border-right: none;
    }
    &[data-columns="1"], &[data-columns="3"] {
      .script:nth-child(even) {
        background-color: var(--fill-0-5);
      }
    }
    &[data-columns="2"] .script {
      &:nth-child(4n + 2),
      &:nth-child(4n + 3) {
        background-color: var(--fill-0-5);
      }
    }
    &[data-columns="4"] .script {
      &:nth-child(8n + 2),
      &:nth-child(8n + 4),
      &:nth-child(8n + 5),
      &:nth-child(8n + 7) {
        background-color: var(--fill-0-5);
      }
    }
    .script {
      display: flex;
      align-items: center;
      height: 2.5rem;
      margin: 0 $itemMargin;
      padding: 0 calc(2 * $itemMargin) 0 $itemMargin;
      border-top: none;
      border-radius: 0;
      background: none;
      &-name {
        cursor: pointer;
      }
      &-icon {
        width: 2rem;
        height: 2rem;
        order: 1;
        position: static;
        margin-left: .5rem;
      }
      &-info {
        order: 2;
        flex: 1;
        margin-left: .5rem;
        line-height: 1.2; /* not using 1.1 as it cuts descender in "g" */
        > :last-child { /* author + version */
          align-items: center;
          display: flex;
          > * {
            width: 5rem;
            text-align: right;
            color: var(--fill-8);
          }
          > :last-child { /* version */
            width: 3.5rem;
          }
        }
      }
      &-buttons {
        margin: 0;
        min-width: 14rem;
        > .flex {
          width: auto;
          > :first-child { /* edit button */
            display: none;
          }
        }
      }
      &-author > .ellipsis {
        max-width: 15vw;
      }
      &-message:not(:empty) {
        position: absolute;
        right: 0;
        font-size: smaller;
        padding: 1px .5em 2px;
        border-radius: .5em;
        border: 1px solid var(--fill-5);
        background: var(--bg);
      }
    }
  }
}
@media (max-width: 319px) {
  .script-icon ~ * {
    margin-left: 0;
  }
}
</style>
