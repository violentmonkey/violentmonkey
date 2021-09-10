<template>
  <div
    class="script"
    :class="{
      disabled: !script.config.enabled,
      removed: script.config.removed,
      error: script.error,
      focused: focused,
      hotkeys: focused && showHotkeys,
    }"
    :tabIndex="tabIndex"
    :draggable="draggable"
    @focus="onFocus"
    @blur="onBlur">
    <div class="script-icon hidden-xs">
      <a @click="onEdit" :data-hotkey="hotkeys.edit" data-hotkey-table tabIndex="-1">
        <img :src="script.safeIcon">
      </a>
    </div>
    <div class="script-info flex ml-1c">
      <span class="script-order" v-text="script.props.position"/>
      <span
        class="script-name ellipsis flex-auto"
        v-text="script.$cache.name"
        @click.exact="nameClickable && onEdit()"
        :tabIndex="nameClickable ? tabIndex : -1"
      />
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
            :tabIndex="tabIndex"
          />
          <span class="ellipsis" v-else v-text="author.name" />
        </tooltip>
        <span class="version ellipsis"
              v-text="script.meta.version ? `v${script.meta.version}` : ''"/>
        <tooltip class="updated hidden-sm ml-1c" :content="updatedAt.title" align="end">
          {{ updatedAt.show }}
        </tooltip>
        <div v-if="script.config.removed">
          <tooltip :content="i18n('buttonRestore')" placement="left">
            <a
              class="btn-ghost"
              @click="onRestore"
              :data-hotkey="hotkeys.restore"
              :tabIndex="tabIndex">
              <icon name="undo"></icon>
            </a>
          </tooltip>
        </div>
      </template>
    </div>
    <div class="script-buttons flex">
      <template v-if="canRender">
        <div class="flex-auto flex flex-wrap">
          <tooltip :content="i18n('buttonEdit')" align="start">
            <a class="btn-ghost" @click="onEdit" :data-hotkey="hotkeys.edit" :tabIndex="tabIndex">
              <icon name="code"></icon>
            </a>
          </tooltip>
          <tooltip :content="labelEnable" align="start">
            <a
              class="btn-ghost"
              @click="onToggle"
              :data-hotkey="hotkeys.toggle"
              :tabIndex="tabIndex">
              <icon :name="`toggle-${script.config.enabled ? 'on' : 'off'}`"></icon>
            </a>
          </tooltip>
          <tooltip
            :disabled="!canUpdate || script.checking"
            :content="i18n('buttonUpdate')"
            align="start">
            <a
              class="btn-ghost"
              @click="onUpdate"
              :data-hotkey="hotkeys.update"
              :tabIndex="canUpdate ? tabIndex : -1">
              <icon name="refresh"></icon>
            </a>
          </tooltip>
          <span class="sep"></span>
          <tooltip :disabled="!homepageURL" :content="i18n('buttonHome')" align="start">
            <a
              class="btn-ghost"
              target="_blank"
              rel="noopener noreferrer"
              :href="homepageURL"
              :tabIndex="homepageURL ? tabIndex : -1">
              <icon name="home"></icon>
            </a>
          </tooltip>
          <tooltip :disabled="!description" :content="description" align="start">
            <a class="btn-ghost" :tabIndex="description ? tabIndex : -1" @click="toggleTip">
              <icon name="info"></icon>
            </a>
          </tooltip>
          <tooltip
            :disabled="!script.meta.supportURL"
            :content="i18n('buttonSupport')"
            align="start">
            <a
              class="btn-ghost"
              target="_blank"
              rel="noopener noreferrer"
              :tabIndex="script.meta.supportURL ? tabIndex : -1"
              :href="script.meta.supportURL">
              <icon name="question"></icon>
            </a>
          </tooltip>
          <div class="script-message" v-text="script.message" :title="script.error"></div>
        </div>
        <tooltip :content="i18n('buttonRemove')" align="end">
          <a class="btn-ghost" @click="onRemove" :data-hotkey="hotkeys.remove" :tabIndex="tabIndex">
            <icon name="trash"></icon>
          </a>
        </tooltip>
      </template>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { getLocaleString, formatTime } from '#/common';
import Icon from '#/common/ui/icon';
import { keyboardService, isInput, toggleTip } from '#/common/keyboard';
import enableDragging from '../utils/dragging';

const itemMargin = 8;

export default {
  props: [
    'script',
    'draggable',
    'visible',
    'nameClickable',
    'focused',
    'hotkeys',
    'showHotkeys',
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
    tabIndex() {
      return this.focused ? 0 : -1;
    },
  },
  watch: {
    visible(visible) {
      // Leave it if the element is already rendered
      if (visible) this.canRender = true;
    },
    focused(value, prevValue) {
      const { $el } = this;
      if (value && !prevValue && $el) {
        const rect = $el.getBoundingClientRect();
        const pRect = $el.parentNode.getBoundingClientRect();
        let delta = 0;
        if (rect.bottom > pRect.bottom - itemMargin) {
          delta += rect.bottom - pRect.bottom + itemMargin;
        } else if (rect.top < pRect.top + itemMargin) {
          delta -= pRect.top - rect.top + itemMargin;
        }
        if (!isInput(document.activeElement)) {
          // focus without scrolling, then scroll smoothly
          $el.focus({ preventScroll: true });
        }
        this.$emit('scrollDelta', delta);
      }
    },
  },
  mounted() {
    enableDragging(this.$el, {
      onDrop: (from, to) => this.$emit('move', { from, to }),
    });
  },
  methods: {
    onEdit() {
      this.$emit('edit', this.script);
    },
    onRemove() {
      this.$emit('remove', this.script);
    },
    onRestore() {
      this.$emit('restore', this.script);
    },
    onToggle() {
      this.$emit('toggle', this.script);
    },
    onUpdate() {
      this.$emit('update', this.script);
    },
    onFocus() {
      keyboardService.setContext('scriptFocus', true);
    },
    onBlur() {
      keyboardService.setContext('scriptFocus', false);
    },
    toggleTip(e) {
      toggleTip(e.target);
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
  margin: $itemMargin 0 0 $itemMargin;
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
  width: calc((100% - $itemMargin) / var(--num-columns) - $itemMargin);
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
    // bring the focused item to the front so that the box-shadow will not be overlapped
    // by the next item
    z-index: 1;
    box-shadow: 1px 2px 9px var(--fill-7);
    &:focus {
      box-shadow: 1px 2px 9px var(--fill-9);
    }
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
      [data-hotkey]::after {
        content: none;
      }
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
    width: $iconSize;
    height: $iconSize;
    float: left;
    cursor: pointer;
    a {
      display: block;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      &:not([src]) {
        visibility: hidden; // hiding the empty outline border while the image loads
      }
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
    max-width: 30%;
    > .ellipsis {
      display: inline-block;
      max-width: 100px;
    }
  }
  &-message {
    white-space: nowrap;
  }
}

.hotkeys [data-hotkey] {
  position: relative;
  &::after {
    content: attr(data-hotkey);
    position: absolute;
    left: 50%;
    bottom: 80%;
    transform-origin: bottom;
    transform: translate(-50%,0);
    padding: .2em;
    background: #fe6;
    color: #333;
    border: 1px solid #880;
    border-radius: .2em;
    font-size: .8rem;
    line-height: 1;
  }
}

.scripts {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  padding: 0 0 $itemMargin 0;
  &[data-table] {
    &[data-columns="1"] .script,
    &[data-columns="2"] .script:nth-child(odd),
    &[data-columns="3"] .script:nth-child(3n + 1),
    &[data-columns="4"] .script:nth-child(4n + 1) {
      border-left: none;
      margin-left: 0;
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
      // --num-columns is set in tab-installed.vue
      width: calc((100% - $itemMargin * (var(--num-columns) - 1)) / var(--num-columns));
      margin: -1px 0 0 $itemMargin;
      padding: 0 calc(2 * $itemMargin) 0 $itemMargin;
      border-radius: 0;
      background: none;
      &:hover::after {
        // using a separate element with z-index higher than a sibling's overlapped border
        content: '';
        position: absolute;
        top: -1px;
        left: -1px;
        right: -1px;
        bottom: -1px;
        border: 1px solid var(--fill-6);
        pointer-events: none;
        z-index: 2;
      }
      &-name {
        cursor: pointer;
      }
      &-icon {
        width: 2rem;
        height: 2rem;
        order: 1;
        margin-left: .5rem;
      }
      &-info {
        order: 2;
        flex: 1;
        margin-left: .5rem;
        line-height: 1.2; /* not using 1.1 as it cuts descender in "g" */
        .updated, .version {
          width: 6em;
          text-align: right;
          color: var(--fill-8);
        }
        .updated {
          width: 3em;
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
        right: .5em;
        top: 2em;
        z-index: 3;
        font-size: smaller;
        padding: 1px .5em;
        border-radius: .5em;
        border: 1px solid var(--fill-5);
        background: var(--bg);
      }
    }
  }
  &:not([data-table]) {
    [data-hotkey-table]::after {
      content: none;
    }
  }
  &[data-show-order] .script-order::after {
    content: '. ';
  }
  &:not([data-show-order]) .script-order {
    display: none;
  }
}
</style>
