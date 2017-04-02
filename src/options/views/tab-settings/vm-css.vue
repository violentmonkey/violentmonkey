<template>
  <section v-feature="'css'">
    <h3>
      <span class="feature-text" v-text="i18n('labelCustomCSS')"></span>
    </h3>
    <p v-html="i18n('descCustomCSS')"></p>
    <textarea v-model="css"></textarea>
    <button v-text="i18n('buttonSaveCustomCSS')" @click="onSave"></button>
  </section>
</template>

<script>
import { i18n } from 'src/common';
import options from 'src/common/options';
import { showMessage } from '../../utils';

export default {
  data() {
    return {
      css: options.get('customCSS'),
    };
  },
  methods: {
    onSave() {
      options.set('customCSS', (this.css || '').trim());
      showMessage({ text: i18n('msgSavedCustomCSS') });
    },
  },
};
</script>
