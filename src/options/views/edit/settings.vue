<template>
  <div class="edit-settings">
    <h4 v-text="i18n('editLabelSettings')"></h4>
    <div class="form-group">
      <label>
        <input type="checkbox" v-model="config.shouldUpdate">
        <span v-text="i18n('labelAllowUpdate')"></span>
      </label>
    </div>
    <h4 v-text="i18n('editLabelMeta')"></h4>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelName')"></label>
      <tooltip content="@name" placement="right">
        <input type="text" v-model="custom.name" :placeholder="placeholders.name">
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelRunAt')"></label>
      <tooltip content="@run-at" placement="right">
        <select v-model="custom.runAt">
          <option value="" v-text="i18n('labelRunAtDefault')"></option>
          <option value="document-start">document-start</option>
          <option value="document-end">document-end</option>
          <option value="document-idle">document-idle</option>
        </select>
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelHomepageURL')"></label>
      <tooltip content="@homepageURL" placement="right">
        <input type="text" v-model="custom.homepageURL" :placeholder="placeholders.homepageURL">
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelUpdateURL')"></label>
      <tooltip content="@updateURL" placement="right">
        <input type="text" v-model="custom.updateURL" :placeholder="placeholders.updateURL">
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelDownloadURL')"></label>
      <tooltip content="@downloadURL" placement="right">
        <input type="text" v-model="custom.downloadURL" :placeholder="placeholders.downloadURL">
      </tooltip>
    </div>
    <tooltip class="form-group" content="@include" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelInclude')"></span>
        <label>
          <input type="checkbox" v-model="custom.origInclude">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.include"></textarea>
    </tooltip>
    <tooltip class="form-group" content="@match" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelMatch')"></span>
        <label>
          <input type="checkbox" v-model="custom.origMatch">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.match"></textarea>
    </tooltip>
    <tooltip class="form-group" content="@exclude" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelExclude')"></span>
        <label>
          <input type="checkbox" v-model="custom.origExclude">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.exclude"></textarea>
    </tooltip>
    <tooltip class="form-group" content="@exclude-match" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelExcludeMatch')"></span>
        <label>
          <input type="checkbox" v-model="custom.origExcludeMatch">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.excludeMatch"></textarea>
    </tooltip>
  </div>
</template>

<script>
import Tooltip from 'vueleton/lib/tooltip/bundle';
import { i18n } from '#/common';
import { objectGet } from '#/common/object';

export default {
  props: ['value', 'settings'],
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
  },
};
</script>

<style>
.edit-settings {
  h4 {
    margin: 2em 0 1em;
  }
  .form-group {
    display: block;
    position: relative;
    max-width: 600px;
    margin-bottom: .5em;
    &.vl-tooltip {
      display: block;
    }
    input[type=text] {
      display: block;
      width: 100%;
    }
    > textarea {
      min-height: 5em;
    }
  }
}
</style>
