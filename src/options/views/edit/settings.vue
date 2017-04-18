<template>
  <div class="edit-settings">
    <h4 v-text="i18n('editLabelSettings')"></h4>
    <div class="form-group">
      <label>
        <input type="checkbox" v-model="more.update">
        <span v-text="i18n('labelAllowUpdate')"></span>
      </label>
    </div>
    <h4 v-text="i18n('editLabelMeta')"></h4>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelName')"></label>
      <input type="text" v-model="custom.name" :placeholder="placeholders.name">
      <div class="hint">@name</div>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelRunAt')"></label>
      <select v-model="custom.runAt">
        <option value="" v-text="i18n('labelRunAtDefault')"></option>
        <option value="start">document-start</option>
        <option value="idle">document-idle</option>
        <option value="end">document-end</option>
      </select>
      <div class="hint">@run-at</div>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelHomepageURL')"></label>
      <input type="text" v-model="custom.homepageURL" :placeholder="placeholders.homepageURL">
      <div class="hint">@homepageURL</div>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelUpdateURL')"></label>
      <input type="text" v-model="custom.updateURL" :placeholder="placeholders.updateURL">
      <div class="hint">@updateURL</div>
    </div>
    <div class="form-group flex">
      <label class="label" v-text="i18n('labelDownloadURL')"></label>
      <input type="text" v-model="custom.downloadURL" :placeholder="placeholders.downloadURL">
      <div class="hint">@downloadURL</div>
    </div>
    <div class="form-group">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelInclude')"></span>
        <label>
          <input type="checkbox" v-model="custom.origInclude">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.include"></textarea>
      <div class="hint">@include</div>
    </div>
    <div class="form-group">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelMatch')"></span>
        <label>
          <input type="checkbox" v-model="custom.origMatch">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.match"></textarea>
      <div class="hint">@match</div>
    </div>
    <div class="form-group">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelExclude')"></span>
        <label>
          <input type="checkbox" v-model="custom.origExclude">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.exclude"></textarea>
      <div class="hint">@exclude</div>
    </div>
    <div class="form-group">
      <div class="flex">
        <span class="flex-auto" v-text="i18n('labelExcludeMatch')"></span>
        <label>
          <input type="checkbox" v-model="custom.origExcludeMatch">
          <span v-text="i18n('labelKeepOriginal')"></span>
        </label>
      </div>
      <textarea v-model="custom.excludeMatch"></textarea>
      <div class="hint">@exclude-match</div>
    </div>
  </div>
</template>

<script>
import { i18n } from 'src/common';

export default {
  props: ['script', 'settings'],
  computed: {
    custom() {
      return this.settings.custom || {};
    },
    more() {
      return this.settings.more || {};
    },
    placeholders() {
      const { script } = this;
      return {
        name: script.meta.name,
        homepageURL: script.meta.homepageURL,
        updateURL: script.meta.updateURL || i18n('hintUseDownloadURL'),
        downloadURL: script.meta.downloadURL || script.lastInstallURL,
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
  > * {
    max-width: 600px;
  }
}
.form-group {
  position: relative;
  margin-bottom: .5em;
  > .label {
    flex: 0 0 8em;
  }
  > input[type=text] {
    flex: 1;
  }
  > textarea {
    min-height: 5em;
  }
  > .hint {
    display: none;
    position: absolute;
    top: 50%;
    left: 100%;
    transform: translate(10px,-50%);
    padding: 8px;
    white-space: nowrap;
    border-radius: 6px;
    background: rgba(0,0,0,.8);
    color: white;
    font-size: 12px;
    &::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      transform: translate(-100%, -50%);
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-right: 8px solid rgba(0,0,0,.8);
    }
  }
  &:hover > .hint {
    display: block;
  }
}
</style>
