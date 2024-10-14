<template>
  <div class="edit-help mb-2c">
    <div>
      <h3 v-html="i18n('editHelpDocumention')"/>
      <a :href="API_URL" v-bind="EXTERNAL_LINK_PROPS" v-text="API_TEXT"/>
    </div>
    <div class="keyboard">
      <h3 v-text="i18n('editHelpKeyboard')"/>
      <dl v-for="([key, cmd]) of hotkeys" :key>
        <dt class="monospace-font" v-text="key"></dt>
        <dd v-text="cmd"></dd>
      </dl>
    </div>
  </div>
</template>

<script>
import { VM_HOME } from '@/common/consts';
import { EXTERNAL_LINK_PROPS } from '@/common/ui';

const API_URL = VM_HOME + 'api/';
const API_TEXT = API_URL.split('://')[1];
</script>

<script setup>
defineProps({
  hotkeys: Array
});
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
