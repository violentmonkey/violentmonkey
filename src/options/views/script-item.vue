<template>
  <div
    class="script"
    :class="{ disabled: !script.config.enabled, removed: script.config.removed }"
    :draggable="draggable"
    @dragstart.prevent="onDragStart">
    <img class="script-icon hidden-xs" :src="safeIcon">
    <div class="script-info flex">
      <div class="script-name ellipsis flex-auto" v-text="script.$cache.name"></div>
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
    </div>
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
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { sendMessage, getLocaleString, formatTime } from '#/common';
import { objectGet } from '#/common/object';
import Icon from '#/common/ui/icon';
import { store } from '../utils';

const DEFAULT_ICON = '/public/images/icon48.png';
const PADDING = 10;
const SCROLL_GAP = 10;

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
  props: ['script', 'draggable'],
  components: {
    Icon,
    Tooltip,
  },
  data() {
    return {
      safeIcon: DEFAULT_ICON,
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
  },
  methods: {
    onEdit() {
      this.$emit('edit', this.script.props.id);
    },
    markRemoved(removed) {
      sendMessage({
        cmd: 'MarkRemoved',
        data: {
          id: this.script.props.id,
          removed,
        },
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
      sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: this.script.props.id,
          config: {
            enabled: this.script.config.enabled ? 0 : 1,
          },
        },
      });
    },
    onUpdate() {
      sendMessage({
        cmd: 'CheckUpdate',
        data: this.script.props.id,
      });
    },
    onDragStart(e) {
      const el = e.currentTarget;
      const parent = el.parentNode;
      const rect = el.getBoundingClientRect();
      const dragging = {
        el,
        offset: {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        },
        delta: rect.height,
        index: [].indexOf.call(parent.children, el),
        elements: [].filter.call(parent.children, child => child !== el),
        dragged: el.cloneNode(true),
      };
      this.dragging = dragging;
      dragging.lastIndex = dragging.index;
      const { dragged } = dragging;
      dragged.classList.add('dragging');
      dragged.style.left = `${rect.left}px`;
      dragged.style.top = `${rect.top}px`;
      dragged.style.width = `${rect.width}px`;
      parent.appendChild(dragged);
      el.classList.add('dragging-placeholder');
      document.addEventListener('mousemove', this.onDragMouseMove, false);
      document.addEventListener('mouseup', this.onDragMouseUp, false);
    },
    onDragMouseMove(e) {
      const { dragging } = this;
      const {
        el, dragged, offset, elements, lastIndex,
      } = dragging;
      dragged.style.left = `${e.clientX - offset.x}px`;
      dragged.style.top = `${e.clientY - offset.y}px`;
      let hoveredIndex = elements.findIndex((item) => {
        if (!item || item.classList.contains('dragging-moving')) return false;
        const rect = item.getBoundingClientRect();
        return (
          e.clientX >= rect.left + PADDING
          && e.clientX <= rect.left + rect.width - PADDING
          && e.clientY >= rect.top + PADDING
          && e.clientY <= rect.top + rect.height - PADDING
        );
      });
      if (hoveredIndex >= 0) {
        const hoveredEl = elements[hoveredIndex];
        const isDown = hoveredIndex >= lastIndex;
        let { delta } = dragging;
        if (isDown) {
          hoveredIndex += 1;
          hoveredEl.parentNode.insertBefore(el, hoveredEl.nextElementSibling);
        } else {
          delta = -delta;
          hoveredEl.parentNode.insertBefore(el, hoveredEl);
        }
        dragging.lastIndex = hoveredIndex;
        this.onDragAnimate(dragging.elements.slice(
          isDown ? lastIndex : hoveredIndex,
          isDown ? hoveredIndex : lastIndex,
        ), delta);
      }
      this.onDragScrollCheck(e.clientY);
    },
    onDragMouseUp() {
      document.removeEventListener('mousemove', this.onDragMouseMove, false);
      document.removeEventListener('mouseup', this.onDragMouseUp, false);
      const { dragging } = this;
      this.dragging = null;
      dragging.dragged.remove();
      dragging.el.classList.remove('dragging-placeholder');
      this.$emit('move', {
        from: dragging.index,
        to: dragging.lastIndex,
      });
    },
    onDragAnimate(elements, delta) {
      elements.forEach((el) => {
        if (!el) return;
        el.classList.add('dragging-moving');
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;
        el.addEventListener('transitionend', endAnimation, false);
        setTimeout(() => {
          el.style.transition = '';
          el.style.transform = '';
        });
      });
      function endAnimation(e) {
        e.target.classList.remove('dragging-moving');
        e.target.removeEventListener('transitionend', endAnimation, false);
      }
    },
    onDragScrollCheck(y) {
      const { dragging } = this;
      let scrollSpeed = 0;
      const offset = dragging.el.parentNode.getBoundingClientRect();
      let delta = (y - (offset.bottom - SCROLL_GAP)) / SCROLL_GAP;
      if (delta > 0) {
        // scroll down
        scrollSpeed = 1 + Math.min((delta * 5) | 0, 10);
      } else {
        // scroll up
        delta = (offset.top + SCROLL_GAP - y) / SCROLL_GAP;
        if (delta > 0) scrollSpeed = -1 - Math.min((delta * 5) | 0, 10);
      }
      dragging.scrollSpeed = scrollSpeed;
      if (scrollSpeed) this.onDragScroll();
    },
    onDragScroll() {
      const scroll = () => {
        const { dragging } = this;
        if (!dragging) return;
        if (dragging.scrollSpeed) {
          dragging.el.parentNode.scrollTop += dragging.scrollSpeed;
          setTimeout(scroll, 32);
        } else dragging.scrolling = false;
      };
      if (this.dragging && !this.dragging.scrolling) {
        this.dragging.scrolling = true;
        scroll();
      }
    },
  },
};
</script>

<style>
.script {
  position: relative;
  margin: 8px;
  padding: 12px 10px 5px;
  border: 1px solid #ccc;
  border-radius: .3rem;
  transition: transform .5s;
  background: white;
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
    padding-bottom: 10px;
    .secondary {
      display: none;
    }
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
    line-height: 1.5;
    align-items: center;
  }
  &-icon {
    position: absolute;
    width: 3rem;
    height: 3rem;
    top: 1rem;
    .disabled &,
    .removed & {
      filter: grayscale(.8);
    }
    .removed & {
      width: 2rem;
      height: 2rem;
    }
    ~ * {
      margin-left: 3.5rem;
    }
  }
  &-name {
    font-weight: 500;
    font-size: 1rem;
    .disabled & {
      color: gray;
    }
  }
  &-author {
    > * {
      vertical-align: middle;
    }
    > .ellipsis {
      display: inline-block;
      max-width: 100px;
    }
  }
  &-message {
    white-space: nowrap;
  }
}
.dragging {
  position: fixed;
  margin: 0;
  z-index: 9;
  &-placeholder {
    visibility: hidden;
  }
}

@media (max-width: 319px) {
  .script-icon ~ * {
    margin-left: 0;
  }
}
</style>
