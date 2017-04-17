<template>
  <div class="script" :class="{disabled:!script.enabled}" draggable="true" @dragstart.prevent="onDragStart">
    <img class="script-icon" :src="safeIcon">
    <div class="script-info flex">
      <a class="script-name ellipsis" target=_blank :href="homepageURL"
      v-text="script.custom.name || getLocaleString('name')"></a>
      <a class="script-support" v-if="script.meta.supportURL" target=_blank :href="script.meta.supportURL">
        <svg class="icon"><use xlink:href="#question" /></svg>
      </a>
      <div class="flex-auto"></div>
      <div class="script-author ellipsis" :title="script.meta.author" v-if="author">
        <span v-text="i18n('labelAuthor')"></span>
        <a :href="'mailto:'+author.email" v-if="author.email" v-text="author.name"></a>
        <span v-if="!author.email" v-text="author.name"></span>
      </div>
      <div class="script-version" v-text="script.meta.version?'v'+script.meta.version:''"></div>
    </div>
    <p class="script-desc ellipsis" v-text="script.custom.description || getLocaleString('description')"></p>
    <div class=buttons>
      <button v-text="i18n('buttonEdit')" @click="onEdit"></button>
      <button @click="onEnable" v-text="labelEnable"></button>
      <button v-text="i18n('buttonRemove')" @click="onRemove"></button>
      <button v-if="canUpdate" :disabled="script.checking"
      v-text="i18n('buttonUpdate')" @click="onUpdate"></button>
      <span v-text="script.message"></span>
    </div>
  </div>
</template>

<script>
import { sendMessage, getLocaleString } from 'src/common';
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
  props: ['script'],
  data() {
    return {
      safeIcon: DEFAULT_ICON,
    };
  },
  computed: {
    canUpdate() {
      const { script } = this;
      return script.update && (
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
      return this.script.enabled ? this.i18n('buttonDisable') : this.i18n('buttonEnable');
    },
  },
  mounted() {
    const { icon } = this.script.meta;
    if (icon && icon !== this.safeIcon) {
      loadImage(icon)
      .then((url) => {
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
      this.$emit('edit', this.script.id);
    },
    onRemove() {
      sendMessage({
        cmd: 'RemoveScript',
        data: this.script.id,
      });
    },
    onEnable() {
      sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: this.script.id,
          enabled: this.script.enabled ? 0 : 1,
        },
      });
    },
    onUpdate() {
      sendMessage({
        cmd: 'CheckUpdate',
        data: this.script.id,
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
      const { el, dragged, offset, elements, lastIndex } = dragging;
      dragged.style.left = `${e.clientX - offset.x}px`;
      dragged.style.top = `${e.clientY - offset.y}px`;
      let hoveredIndex = elements.findIndex((item) => {
        if (!item) return;
        if (item.classList.contains('dragging-moving')) return;
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
.script-info {
  > *:not(:last-child) {
    margin-right: 8px;
  }
}
</style>
