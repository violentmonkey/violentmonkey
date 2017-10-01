<template>
  <div class="script" :class="{ disabled: !script.config.enabled, removed: script.config.removed }" :draggable="draggable" @dragstart.prevent="onDragStart">
    <img class="script-icon" :src="safeIcon">
    <div class="script-info flex">
      <div class="script-name ellipsis" v-text="script._cache.name"></div>
      <div class="flex-auto"></div>
      <div class="script-author ellipsis" :title="script.meta.author" v-if="author">
        <span v-text="i18n('labelAuthor')"></span>
        <a :href="'mailto:'+author.email" v-if="author.email" v-text="author.name"></a>
        <span v-if="!author.email" v-text="author.name"></span>
      </div>
      <div class="script-version" v-text="script.meta.version ? `v${script.meta.version}` : ''"></div>
      <div v-if="script.config.removed" v-text="i18n('labelRemoved')"></div>
      <div v-if="script.config.removed">
        <tooltip :title="i18n('buttonUndo')" placement="left">
          <span class="btn-ghost" @click="onRemove(0)">
            <icon name="undo"></icon>
          </span>
        </tooltip>
      </div>
    </div>
    <p class="script-desc ellipsis" v-text="script.custom.description || getLocaleString('description')"></p>
    <div class="script-buttons flex">
      <tooltip :title="i18n('buttonEdit')" align="start">
        <span class="btn-ghost" @click="onEdit">
          <icon name="code"></icon>
        </span>
      </tooltip>
      <tooltip :title="labelEnable" align="start">
        <span class="btn-ghost" @click="onEnable">
          <icon :name="`toggle-${script.config.enabled ? 'on' : 'off'}`"></icon>
        </span>
      </tooltip>
      <tooltip v-if="canUpdate" :title="i18n('buttonUpdate')" align="start">
        <span class="btn-ghost" :disabled="script.checking" @click="onUpdate">
          <icon name="refresh"></icon>
        </span>
      </tooltip>
      <span class="sep"></span>
      <tooltip v-if="homepageURL || script.meta.supportURL" :title="i18n('buttonHome')" align="start">
        <a class="btn-ghost" target="_blank" :href="homepageURL">
          <icon name="home"></icon>
        </a>
      </tooltip>
      <tooltip v-if="script.meta.supportURL" :title="i18n('buttonSupport')" align="start">
        <a class="btn-ghost" target="_blank" :href="script.meta.supportURL">
          <icon name="question"></icon>
        </a>
      </tooltip>
      <div class="flex-auto" v-text="script.message"></div>
      <tooltip :title="i18n('buttonRemove')" align="end">
        <span class="btn-ghost" @click="onRemove(1)">
          <icon name="trash"></icon>
        </span>
      </tooltip>
    </div>
  </div>
</template>

<script>
import { sendMessage, getLocaleString } from 'src/common';
import Icon from 'src/common/ui/icon';
import Tooltip from 'src/common/ui/tooltip';
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
        script.custom.updateURL ||
        script.meta.updateURL ||
        script.custom.downloadURL ||
        script.meta.downloadURL ||
        script.custom.lastInstallURL
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
  },
  mounted() {
    const { icon } = this.script.meta;
    if (icon && icon !== this.safeIcon) {
      loadImage(icon)
      .then(url => {
        this.safeIcon = url;
      }, () => {
        this.safeIcon = DEFAULT_ICON;
      });
    }
  },
  methods: {
    getLocaleString(key) {
      return getLocaleString(this.script.meta, key);
    },
    onEdit() {
      this.$emit('edit', this.script.props.id);
    },
    onRemove(remove) {
      sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: this.script.props.id,
          config: {
            removed: remove ? 1 : 0,
          },
        },
      });
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
      const next = el.nextElementSibling;
      const dragging = {
        el,
        offset: {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        },
        delta: (next ? next.getBoundingClientRect().top : parent.offsetHeight) - rect.top,
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
      let hoveredIndex = elements.findIndex(item => {
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
      elements.forEach(el => {
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
  &.disabled,
  &.removed {
    background: #f0f0f0;
    color: #999;
  }
  &.removed {
    padding-bottom: 10px;
  }
  &-buttons {
    align-items: center;
    line-height: 1;
    color: #3e4651;
    > .flex-auto {
      margin-left: 1rem;
    }
    .removed & {
      display: none;
    }
  }
  &-info {
    margin-left: 3.5rem;
    line-height: 1.5;
    align-items: center;
    > *:not(:last-child) {
      margin-right: 8px;
    }
    .icon {
      display: block;
    }
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
  }
  &-name {
    font-weight: bold;
    font-size: 1rem;
    .disabled & {
      color: blueviolet;
    }
  }
  &-author {
    max-width: 30%;
  }
  &-desc {
    margin-left: 3.5rem;
    line-height: 2rem;
    color: #60646d;
    &::after {
      content: "\200b";
    }
    .removed & {
      display: none;
    }
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
</style>
