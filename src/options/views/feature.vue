<template>
  <component :is="tag" :class="{ feature: featured }" @click="onClick">
    <slot></slot>
  </component>
</template>

<script>
import options from '@/common/options';
import { objectGet } from '@/common/object';
import { store } from '../utils';

const FEATURES_KEY = 'features';
store.features = options.get(FEATURES_KEY);
options.hook((data) => {
  const features = data[FEATURES_KEY];
  if (features) {
    store.features = features;
  }
});
options.ready.then(() => reset('sync'));

function reset(version) {
  if (objectGet(store, 'features.version') !== version) {
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
      return this.store.features && !objectGet(this.store, ['features', 'data', this.name]);
    },
  },
  methods: {
    onClick() {
      const { features } = this.store;
      if (objectGet(features, 'version')) {
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
