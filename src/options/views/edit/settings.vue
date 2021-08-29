<template>
  <div class="edit-settings" ref="container">
    <h4 v-text="i18n('editLabelSettings')"></h4>
    <div class="form-group condensed">
      <label>
        <input type="checkbox" v-model="config.shouldUpdate">
        <span v-text="i18n('labelAllowUpdate')"></span>
      </label>
      <span v-text="i18n('labelNotifyThisUpdated')"/>
      <label class="ml-1" :key="value" v-for="([text, value]) of [
        [i18n('genericOn'), '1'],
        [i18n('genericOff'), '0'],
        [i18n('genericUseGlobal'), ''],
      ]"><!-- make sure to place the input and span on one line with a space between -->
        <input type="radio" :value="value" v-model="config.notifyUpdates"> <span v-text="text"/>
      </label>
    </div>
    <h4 v-text="i18n('editLabelMeta')"></h4>
    <tooltip content="@run-at" placement="right" class="form-group fit-width">
      <label v-text="i18n('labelRunAt')"/>
      <select v-model="custom.runAt">
        <option value="" v-text="i18n('labelRunAtDefault')"></option>
        <option value="document-start">document-start</option>
        <option value="document-body">document-body</option>
        <option value="document-end">document-end</option>
        <option value="document-idle">document-idle</option>
      </select>
    </tooltip>
    <tooltip content="@noframes" placement="right" class="form-group fit-width">
      <label v-text="i18n('labelNoFrames')"/>
      <select v-model="custom.noframes">
        <option value="" v-text="i18n('labelRunAtDefault')"/>
        <option value="0" v-text="i18n('genericOn')"/>
        <option value="1" v-text="i18n('genericOff')"/>
      </select>
    </tooltip>
    <tooltip v-for="([ name, label ]) in textInputs" :key="name"
             :content="`@${name}`" placement="right"
             class="form-group mr-tooltip">
        <label v-text="label"/>
        <input type="text" v-model="custom[name]" :placeholder="placeholders[name]">
    </tooltip>
    <div class="form-group" v-for="([ name, orig, label ]) in textAreas" :key="name">
      <div>
        <span v-text="label"/>
        <label class="ml-2">
          <input type="checkbox" v-model="custom[orig]">
          <span v-text="i18n('labelKeepOriginal')"/>
        </label>
      </div>
      <textarea v-model="custom[name]" spellcheck="false" ref="area"/>
    </div>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { i18n } from '#/common';
import { objectGet } from '#/common/object';
import { autofitElementsHeight } from '#/common/ui';

export default {
  props: ['active', 'settings', 'value'],
  components: {
    Tooltip,
  },
  computed: {
    custom() {
      return this.settings.custom || {};
    },
    config() {
      return this.settings.config || {};
    },
    placeholders() {
      const { value } = this;
      return {
        name: objectGet(value, 'meta.name'),
        homepageURL: objectGet(value, 'meta.homepageURL'),
        updateURL: objectGet(value, 'meta.updateURL') || i18n('hintUseDownloadURL'),
        downloadURL: objectGet(value, 'meta.downloadURL') || objectGet(value, 'custom.lastInstallURL'),
      };
    },
    textInputs() {
      return [
        ['name', i18n('labelName')],
        ['homepageURL', i18n('labelHomepageURL')],
        ['updateURL', i18n('labelUpdateURL')],
        ['downloadURL', i18n('labelDownloadURL')],
      ];
    },
    textAreas() {
      return [
        ['include', 'origInclude', i18n('labelInclude')],
        ['match', 'origMatch', i18n('labelMatch')],
        ['exclude', 'origExclude', i18n('labelExclude')],
        ['excludeMatch', 'origExcludeMatch', i18n('labelExcludeMatch')],
      ];
    },
  },
  watch: {
    active(val) {
      if (val) {
        this.$refs.container.querySelector('input').focus();
        autofitElementsHeight(this.$refs.area);
      }
    },
  },
};
</script>

<style>
$leftColWidth: 11em;
.edit-settings {
  &.edit-body { // using 2 classes to ensure we override .edit-body in index.vue
    column-width: 50em;
    column-gap: 4em;
    padding-left: 4em;
    padding-right: 4em;
  }
  h4 {
    margin: 2em 0 1em;
  }
  .form-group {
    display: flex;
    position: relative;
    margin-bottom: .5em;
    break-inside: avoid-column;
    align-items: center;
    input[type=checkbox] + span {
      user-select: none;
    }
    input[type=text] {
      display: block;
      width: 100%;
    }
    &:not(.condensed) {
      > :nth-child(1) {
        display: flex;
        flex: 0 0 $leftColWidth;
        flex-direction: column;
      }
      > :nth-child(2):not(select) {
        flex-grow: 1;
      }
    }
    &.fit-width {
      display: block;
      width: fit-content;
      > :nth-child(1) {
        display: inline-block;
        width: $leftColWidth;
      }
    }
  }
  label:focus-within span {
    text-decoration: underline;
  }
}
.mr-tooltip {
  margin-right: 6em;
}
</style>
