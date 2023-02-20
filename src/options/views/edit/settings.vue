<template>
  <div class="edit-settings" ref="container">
    <h4 v-text="i18n('editLabelSettings')"></h4>
    <div class="form-group condensed">
      <label>
        <input type="checkbox" v-model="config.shouldUpdate" :disabled="readOnly">
        <span v-text="i18n('labelAllowUpdate')"></span>
      </label>
      <span v-text="i18n('labelNotifyThisUpdated')"/>
      <label class="ml-1" :key="value" v-for="([text, value]) of [
        [i18n('genericOn'), '1'],
        [i18n('genericOff'), '0'],
        [i18n('genericUseGlobal'), ''],
      ]"><!-- make sure to place the input and span on one line with a space between -->
        <input type="radio" :value="value" v-model="config.notifyUpdates" :disabled="readOnly"> <span v-text="text"/>
      </label>
    </div>
    <h4 v-text="i18n('editLabelMeta')"></h4>
    <!-- Using tables to auto-adjust width, which differs substantially between languages -->
    <table>
      <tr>
        <td>
          <code>@run-at</code>
        </td>
        <td>
          <p v-text="i18n('labelRunAt')"/>
        </td>
        <td>
          <select v-model="custom.runAt" :disabled="readOnly">
            <option value="" v-text="i18n('labelRunAtDefault')"></option>
            <option value="document-start">document-start</option>
            <option value="document-body">document-body</option>
            <option value="document-end">document-end</option>
            <option value="document-idle">document-idle</option>
          </select>
        </td>
      </tr>
      <tr>
        <td>
          <code>@<s style="color: var(--fill-6)">no</s>frames</code>
        </td>
        <td>
          <p v-text="i18n('labelNoFrames')"/>
        </td>
        <td>
          <select v-model="custom.noframes" :disabled="readOnly">
            <option value="" v-text="i18n('labelRunAtDefault')"/>
            <option value="0" v-text="i18n('genericOn')"/>
            <option value="1" v-text="i18n('genericOff')"/>
          </select>
        </td>
      </tr>
      <tr>
        <td>
          <code>@inject-into</code>
        </td>
        <td>
          <p v-text="i18n('labelInjectionMode')"/>
        </td>
        <td>
          <select v-model="custom.injectInto" :disabled="readOnly">
            <option value="" v-text="i18n('labelRunAtDefault')"/>
            <option v-for="(_, mode) in KII" :key="mode" v-text="mode" />
          </select>
        </td>
      </tr>
      <tr v-for="([ name, label ]) in textInputs" :key="name">
        <td>
          <code v-text="`@${name}`"/>
        </td>
        <td>
          <p v-text="label"/>
        </td>
        <td>
          <input type="text" v-model="custom[name]" :placeholder="placeholders[name]" :disabled="readOnly">
        </td>
      </tr>
    </table>
    <table>
      <tr v-for="([ name, orig, labelA, code, labelB ]) in textAreas" :key="name">
        <td>
          <p>
            <span v-text="labelA"/>
            <code v-text="code"/>
            <span v-text="labelB"/>
          </p>
          <label>
            <input type="checkbox" v-model="custom[orig]" :disabled="readOnly">
            <span v-text="i18n('labelKeepOriginal')"/>
          </label>
        </td>
        <td>
          <textarea v-model="custom[name]" spellcheck="false" :rows="calcRows(custom[name])" :disabled="readOnly" />
        </td>
      </tr>
    </table>
  </div>
</template>

<script>
import { getScriptHome, i18n } from '@/common';
import { KNOWN_INJECT_INTO } from '@/common/consts';
import { objectGet } from '@/common/object';
import { focusMe } from '@/common/ui';

const highlightMetaKeys = str => str.match(/^(.*?)(@[-a-z]+)(.*)/)?.slice(1) || [str, '', ''];

export default {
  props: ['active', 'settings', 'value', 'readOnly'],
  data() {
    return {
      KII: KNOWN_INJECT_INTO,
    };
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
        homepageURL: getScriptHome(value),
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
        ['include', 'origInclude', ...highlightMetaKeys(i18n('labelInclude'))],
        ['match', 'origMatch', ...highlightMetaKeys(i18n('labelMatch'))],
        ['exclude', 'origExclude', ...highlightMetaKeys(i18n('labelExclude'))],
        ['excludeMatch', 'origExcludeMatch', ...highlightMetaKeys(i18n('labelExcludeMatch'))],
      ];
    },
  },
  watch: {
    active(val) {
      if (val) {
        focusMe(this.$el);
      }
    },
  },
};
</script>

<style>
$leftColWidth: 12rem;
.edit-settings {
  &.edit-body { // using 2 classes to ensure we override .edit-body in index.vue
    $GAP: 4rem;
    $PAD: 2rem;
    column-width: calc((1920px - $GAP - $PAD * 2) / 2);
    column-gap: $GAP;
    padding-left: $PAD;
    padding-right: $PAD;
  }
  h4 {
    margin: 2em 0 1em;
  }
  table {
    border-spacing: 0 1em;
    break-inside: avoid;
  }
  tr {
    margin-bottom: 1em;
    > td {
      white-space: nowrap;
      break-inside: avoid-column;
      padding-right: 1em;
      > :nth-child(2) {
        margin-left: 4em;
      }
    }
    > :last-child {
      width: 100%;
    }
    input[type=checkbox] + span {
      user-select: none;
    }
    input[type=text] {
      width: 100%;
    }
  }
  tr:focus-within code {
    text-decoration: underline;
  }
  code {
    background: none;
    font-weight: bold;
  }
  svg {
    width: 16px;
    height: 16px;
    vertical-align: text-bottom;
  }
}
</style>
