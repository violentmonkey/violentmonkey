<template>
  <div
    ref="$root"
    class="script"
    :class="{
      disabled: !isEnabled,
      removed: isRemoved,
      error: script.error,
      focused: focused,
      hotkeys: focused && showHotkeys,
    }"
    :tabIndex
    @focus="setScriptFocus(true)"
    @blur="setScriptFocus(false)">
    <div class="script-icon hidden-xs">
      <a :href="url" :data-hotkey="hotkeys.edit" data-hotkey-table tabIndex="-1">
        <img :src="script.safeIcon" :data-no-icon="script.noIcon">
      </a>
    </div>
    <!-- We disable native dragging on name to avoid confusion with exec re-ordering.
    Users who want to open a new tab via dragging the link can drag the icon. -->
    <div class="script-info-1 ellipsis">
      <a v-text="script.$cache.name" v-bind="viewTable && { draggable: false, href: url, tabIndex }"
         :data-order="isRemoved ? null : script.props.position"
         class="script-name ellipsis" />
      <div class="script-tags" v-if="canRender">
        <a
          v-for="(item, i) in tags.slice(0, 2)"
          :key="i"
          v-text="`#${item}`"
          @click.prevent="onTagClick(item)"
          :class="{ active: activeTags?.includes(item) }"
          :data-tag="item"
        ></a>
        <Dropdown v-if="tags.length > 2">
          <a>...</a>
          <template #content>
            <a
              v-for="(item, i) in tags.slice(2)"
              :key="i"
              class="dropdown-menu-item"
              v-text="`#${item}`"
              @click.prevent="onTagClick(item)"
              :class="{ active: activeTags?.includes(item) }"
              :data-tag="item"
            ></a>
          </template>
        </Dropdown>
      </div>
    </div>
    <div class="script-info flex ml-1c">
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
            :tabIndex
          />
          <span class="ellipsis" v-else v-text="author.name" />
        </tooltip>
        <span class="version ellipsis" v-text="script.meta.version"/>
        <tooltip class="size hidden-sm" :content="script.$cache.sizes" align="end" v-if="!isRemoved">
          {{ script.$cache.size }}
        </tooltip>
        <tooltip class="updated hidden-sm ml-1c" :content="updatedAt.title" align="end">
          {{ updatedAt.show }}
        </tooltip>
      </template>
    </div>
    <div class="script-buttons script-buttons-left">
      <template v-if="canRender">
        <tooltip :content="i18n('buttonEdit')" align="start">
          <a class="btn-ghost" :href="url" :data-hotkey="hotkeys.edit" :tabIndex>
            <icon name="code"></icon>
          </a>
        </tooltip>
        <template v-if="!isRemoved">
          <tooltip :content="labelEnable" align="start">
            <a
              class="btn-ghost"
              @click="onToggle"
              :data-hotkey="hotkeys.toggle"
              :tabIndex>
              <icon :name="isEnabled ? TOGGLE_ON : TOGGLE_OFF"/>
            </a>
          </tooltip>
          <tooltip
            :disabled="!canUpdate || script.checking"
            :content="i18n('updateScript')"
            align="start">
            <a
              class="btn-ghost"
              @click="onUpdate"
              :data-hotkey="hotkeys.update"
              :tabIndex="canUpdate ? tabIndex : -1">
              <icon name="refresh" :invert.attr="canUpdate === -1 ? '' : null" />
            </a>
          </tooltip>
        </template>
        <span class="sep"></span>
        <tooltip :disabled="!description" :content="description" align="start">
          <a class="btn-ghost" :tabIndex="description ? tabIndex : -1" @click="toggleTip($event.target)">
            <icon name="info"></icon>
          </a>
        </tooltip>
        <tooltip v-for="([title, url], icon) in urls" :key="icon"
                 :disabled="!url" :content="title" align="start">
          <a
            class="btn-ghost"
            v-bind="EXTERNAL_LINK_PROPS"
            :href="url"
            :tabIndex="url ? tabIndex : -1">
            <icon :name="icon"/>
          </a>
        </tooltip>
        <!-- Using v-if to actually hide it because FF is slow to apply :not(:empty) CSS -->
        <div class="script-message" v-if="script.message" v-text="script.message"
             :title="script.error"/>
      </template>
    </div>
    <div class="script-buttons script-buttons-right">
      <template v-if="canRender">
        <tooltip :content="i18n('buttonRemove')" align="end" v-if="showRecycle || !isRemoved">
          <a class="btn-ghost" :class="{ 'btn-danger': isRemoved }" @click="onRemove" :data-hotkey="hotkeys.remove" :tabIndex>
            <icon name="trash"></icon>
          </a>
        </tooltip>
        <tooltip :content="i18n('buttonRestore')" placement="left" v-if="isRemoved">
          <a
            class="btn-ghost"
            @click="onRestore"
            :data-hotkey="hotkeys.restore"
            :tabIndex>
            <icon name="undo"></icon>
          </a>
        </tooltip>
      </template>
    </div>
  </div>
</template>

<script>
import { formatTime, getLocaleString, getScriptHome, getScriptSupportUrl, i18n } from '@/common';
import { EXTERNAL_LINK_PROPS, getActiveElement, showConfirmation } from '@/common/ui';
import { isInput, keyboardService, toggleTip } from '@/common/keyboard';
import { kDescription, store, TOGGLE_OFF, TOGGLE_ON } from '../utils';

const itemMargin = 8;
const setScriptFocus = val => keyboardService.setContext('scriptFocus', val);
</script>

<script setup>
import Dropdown from 'vueleton/lib/dropdown';
import Tooltip from 'vueleton/lib/tooltip';
import Icon from '@/common/ui/icon';
import { computed, ref, watch } from 'vue';

const props = defineProps([
  'script',
  'visible',
  'viewTable',
  'focused',
  'hotkeys',
  'showHotkeys',
  'activeTags',
]);
const emit = defineEmits([
  'clickTag',
  'remove',
  'restore',
  'scrollDelta',
  'toggle',
  'update',
]);
const $root = ref();
const canRender = ref(props.visible);
const isEnabled = computed(() => props.script.config.enabled);
const isRemoved = computed(() => props.script.config.removed);
const showRecycle = computed(() => store.route.paths[0] === TAB_RECYCLE);
const author = computed(() => {
  const text = props.script.meta.author;
  if (!text) return;
  const matches = text.match(/^(.*?)\s<(\S*?@\S*?)>$/);
  return {
    email: matches && matches[2],
    name: matches ? matches[1] : text,
  };
});
const canUpdate = computed(() => props.script.$canUpdate);
const description = computed(() => {
  return props.script.custom[kDescription] || getLocaleString(props.script.meta, kDescription);
});
const labelEnable = computed(() => {
  return isEnabled.value ? i18n('buttonDisable') : i18n('buttonEnable');
});
const tabIndex = computed(() => {
  return props.focused ? 0 : -1;
});
const tags = computed(() => {
  return props.script.custom.tags?.split(' ').filter(Boolean) || [];
});
const updatedAt = computed(() => {
  const { props: scrProps } = props.script;
  const lastModified = !isRemoved.value && scrProps.lastUpdated || scrProps.lastModified;
  const dateStr = lastModified && new Date(lastModified).toLocaleString();
  return lastModified ? {
    show: formatTime(Date.now() - lastModified),
    title: isRemoved.value
      ? i18n('labelRemovedAt', dateStr)
      : i18n('labelLastUpdatedAt', dateStr)
  } : {};
});
const url = computed(() => `#${
  isRemoved.value ? TAB_RECYCLE : SCRIPTS}/${props.script.props.id}
`);
const urls = computed(() => ({
  home: [i18n('buttonHome'), getScriptHome(props.script)],
  question: [i18n('buttonSupport'), getScriptSupportUrl(props.script)],
}));

const emitScript = event => emit(event, props.script);
const onRemove = () => emitScript('remove');
const onRestore = () => emitScript('restore');
const onTagClick = item => emit('clickTag', item);
const onToggle = () => emitScript('toggle');
const onUpdate = async () => {
  if (props.script.$canUpdate !== -1
  || await showConfirmation(i18n('confirmManualUpdate'))) {
    emitScript('update');
  }
};

watch(() => props.visible, visible => {
  // Leave it if the element is already rendered
  if (visible) canRender.value = true;
});

watch(() => props.focused, (value, prevValue) => {
  const $el = $root.value;
  if (value && !prevValue && $el) {
    const rect = $el.getBoundingClientRect();
    const pRect = $el.parentNode.getBoundingClientRect();
    let delta = 0;
    if (rect.bottom > pRect.bottom - itemMargin) {
      delta += rect.bottom - pRect.bottom + itemMargin;
    } else if (rect.top < pRect.top + itemMargin) {
      delta -= pRect.top - rect.top + itemMargin;
    }
    if (!isInput(getActiveElement())) {
      // focus without scrolling, then scroll smoothly
      $el.focus({ preventScroll: true });
    }
    emit('scrollDelta', delta);
  }
});
</script>

<style>
@import '../utils/dragging.css';

$rem: 14px;
// SVG viewport (200px) * .icon width (1rem = 14px) * attenuation factor
$strokeWidth: calc(200px / 14 * .7);
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
  display: grid;
  grid-template-columns: $iconSize 1fr auto;
  margin: $itemMargin 0 0 $itemMargin;
  padding: $itemPadT 10px $itemPadB;
  border: 1px solid var(--fill-3);
  border-radius: .3rem;
  transition: transform .25s;
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
  &.disabled,
  &.removed {
    background: var(--fill-1);
    color: var(--fill-6);
  }
  &.removed {
    grid-template-columns: $iconSize auto 1fr auto auto;
    height: $removedItemHeight;
    padding-bottom: $removedItemPadB;
  }
  &:not(.removed) {
    .script-buttons-left {
      min-width: 165px;
    }
    .script-buttons-right {
      min-width: 30px;
      justify-self: end;
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
  &-info-1 {
    display: flex;
    gap: 8px;
    align-items: center;
    align-self: flex-start;
  }
  &-name {
    font-weight: 500;
    font-size: $nameFontSize;
    color: inherit;
    padding-left: .5rem;
    &.removed {
      margin-right: 8px;
    }
    &.disabled {
      color: var(--fill-8);
    }
  }
  &-tags {
    white-space: nowrap;
    a {
      margin-right: 4px;
      cursor: pointer;
      color: var(--fill-4);
      &:hover {
        color: var(--fill-6);
      }
    }
    .active {
      color: var(--fill-6);
      font-weight: bold;
    }
  }
  &-buttons {
    display: flex;
    align-items: center;
    line-height: 1;
    white-space: nowrap;
    color: hsl(215, 13%, 28%);
    @media (prefers-color-scheme: dark) {
      color: hsl(215, 10%, 55%);
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
    &-right {
      margin-left: 8px;
      text-align: right;
      .removed & {
        order: 2;
      }
    }
  }
  &-info {
    align-items: center;
    line-height: $itemLineHeight;
    margin-left: 8px;
    overflow: hidden; /* e.g. in recycle bin with a long author/version and multi-column */
    .removed & {
      order: 2;
    }
  }
  &-icon {
    grid-row-end: span 2;
    width: $iconSize;
    height: $iconSize;
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
      img {
        filter: grayscale(.8);
        opacity: .5;
      }
    }
    .removed & {
      grid-row-end: auto;
      width: $iconSizeSmaller;
      height: $iconSizeSmaller;
    }
  }
  &-author {
    display: flex;
    align-items: center;
    min-width: 4em;
    > .ellipsis {
      display: inline-block;
      max-width: 15ch;
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
    font: .8rem monospace; // monospace usually provides differentiation between l and I, 0 and O
    line-height: 1;
  }
}

.scripts {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  padding: 0 0 $itemMargin 0;
  &[data-table] {
    /* Copied from @common/ui/style/style.css and changed max-width */
    @media (max-width: 650px) {
      .hidden-sm {
        display: none !important;
      }
    }
    @media (max-width: 400px) {
      .hidden-xs {
        display: none !important;
      }
    }
    // --num-columns is set in tab-installed.vue
    --w: calc((100% - $itemMargin * (var(--num-columns) - 1)) / var(--num-columns));
    // when searching for text the items are shuffled so we can't use different margins on columns
    // TODO: make `sortedScripts` a computed property that only shows visible scripts?
    justify-content: space-between;
    &[data-columns="3"]::after { // left-aligning items in the last row
      width: calc(var(--w) - 1px); // subtracting 1px to match margin of `.script`
      content: '';
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
      grid-template-columns:
        auto /* main icons */
        auto /* trash icon */
        $iconSize /* script icon */
        minmax(15ch, 1fr) /* name */
        auto /* info */;
      align-items: center;
      height: 2.5rem;
      width: var(--w);
      margin: -1px 0 0 -1px;
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
      &-info-1 {
        display: flex;
        align-self: stretch;
        align-items: center;
      }
      &-icon {
        width: 2rem;
        height: 2rem;
        margin-left: .5rem;
        grid-row-end: auto;
      }
      &-info {
        order: 2;
        align-self: stretch;
        justify-content: end;
        margin-left: .5rem;
        line-height: 1.2; /* not using 1.1 as it cuts descender in "g" */
        .size {
          width: 3em;
          text-align: right;
        }
        .updated, .version {
          text-align: right;
          color: var(--fill-8);
        }
        .updated {
          width: 3em;
        }
        .version:not(:empty)::before {
          width: 6em;
          content: 'v';
        }
      }
      &-buttons {
        order: -1;
        margin: 0;
        &-left {
          > :first-child { /* edit button */
            display: none;
          }
        }
      }
      &.removed .script-buttons .sep {
        display: none;
      }
      &-message {
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
    .size {
      position: absolute;
      bottom: 10px;
      right: 40px;
    }
    .script-icon {
      align-self: start;
    }
  }
  &[data-show-order] [data-order]::before {
    content: attr(data-order) '. ';
  }
}

svg[invert] {
  fill: transparent;
  stroke: currentColor;
  stroke-width: $strokeWidth;
}
</style>
