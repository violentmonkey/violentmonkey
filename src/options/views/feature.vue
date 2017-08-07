<template>
  <component :is="tag" :class="{ feature: featured }" @click="onClick">
    <slot></slot>
  </component>
</template>

<script>
import Vue from 'vue';
import options from 'src/common/options';
import { object } from 'src/common';
import { store } from '../utils';

const FEATURES_KEY = 'features';
store.features = options.get(FEATURES_KEY);
options.hook(data => {
  const features = data[FEATURES_KEY];
  if (features) {
    Vue.set(store, 'features', features);
  }
});
options.ready(() => reset('sync'));
window.store = store;

function reset(version) {
  if (object.get(store, 'features.version') !== version) {
    options.set(FEATURES_KEY, {
      version,
      data: {},
    });
  }
}

export default {
  props: {
    name: {
      type: String,
      required: true,
    },
    tag: {
      type: String,
      default: 'span',
    },
  },
  data() {
    return { store };
  },
  computed: {
    featured() {
      return this.store.features && !object.get(this.store, ['features', 'data', this.name]);
    },
  },
  methods: {
    onClick() {
      const { features } = this.store;
      if (object.get(features, 'version')) {
        features.data[this.name] = 1;
        options.set(FEATURES_KEY, features);
      }
    },
  },
};
</script>

<style>
.feature {
  .feature-text {
    position: relative;
    &::after {
      content: '';
      display: block;
      position: absolute;
      width: 6px;
      height: 6px;
      top: -.1rem;
      left: 100%;
      border-radius: 50%;
      margin-left: .1rem;
      background: red;
    }
  }
}
</style>
