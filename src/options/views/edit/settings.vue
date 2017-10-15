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
      <tooltip title="@name" placement="right">
        <input type="text" v-model="custom.name" :placeholder="placeholders.name">
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelRunAt')"></label>
      <tooltip title="@run-at" placement="right">
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
      <tooltip title="@homepageURL" placement="right">
        <input type="text" v-model="custom.homepageURL" :placeholder="placeholders.homepageURL">
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelUpdateURL')"></label>
      <tooltip title="@updateURL" placement="right">
        <input type="text" v-model="custom.updateURL" :placeholder="placeholders.updateURL">
      </tooltip>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelDownloadURL')"></label>
      <tooltip title="@downloadURL" placement="right">
        <input type="text" v-model="custom.downloadURL" :placeholder="placeholders.downloadURL">
      </tooltip>
    </div>
    <tooltip class="form-group" title="@include" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelInclude')"></span>
        <label>
          <input type="checkbox" v-model="custom.origInclude">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.include"></textarea>
    </tooltip>
    <tooltip class="form-group" title="@match" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelMatch')"></span>
        <label>
          <input type="checkbox" v-model="custom.origMatch">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.match"></textarea>
    </tooltip>
    <tooltip class="form-group" title="@exclude" placement="right">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelExclude')"></span>
        <label>
          <input type="checkbox" v-model="custom.origExclude">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.exclude"></textarea>
    </tooltip>
    <tooltip class="form-group" title="@exclude-match" placement="right">
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
import { i18n } from 'src/common';
import { objectGet } from 'src/common/object';
import Tooltip from 'src/common/ui/tooltip';

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
        downloadURL: objectGet(value, 'meta.downloadURL') || value.lastInstallURL,
      };
    },
  },
};
</script>

<style>
.edit-settings {
  padding: 8px 16px;
  overflow: auto;
  background: white;
  h4 {
    margin: 2em 0 1em;
  }
}
.form-group {
  position: relative;
  max-width: 600px;
  margin-bottom: .5em;
  &.tooltip {
    display: block;
  }
  input[type=text] {
    width: 100%;
  }
  > * {
    flex: 1;
  }
  > .label {
    flex: 0 0 8em;
  }
  > textarea {
    min-height: 5em;
  }
}
</style>
