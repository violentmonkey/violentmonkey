<template>
  <div class="edit-help mb-2c">
    <div>
      <h3 v-html="i18n('editHelpDocumention')"/>
      <a href="https://violentmonkey.github.io/api/"
         rel="noopener noreferrer" target="_blank">violentmonkey.github.io/api/</a>
    </div>
    <div class="keyboard">
      <h3 v-text="i18n('editHelpKeyboard')"/>
      <dl v-for="([key, cmd]) of hotkeys" :key="key">
        <dt class="monospace-font" v-text="key"></dt>
        <dd v-text="cmd"></dd>
      </dl>
    </div>
  </div>
</template>

<script>
export default {
  props: ['hotkeys'],
};
</script>

<style>
.edit-help {
  h3 {
    margin: .5em 0;
  }
  .keyboard {
    column-width: 25em;
    h3 {
      column-span: all;
    }
    dl {
      display: flex;
      align-items: center;
      padding: .25em 0;
    }
    dt {
      text-align: right;
      padding-right: .5em;
      flex: 0 40%;
      font-weight: bold;
    }
  }
}
</style>
