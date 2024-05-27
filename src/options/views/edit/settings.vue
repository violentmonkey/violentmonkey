<template>
  <div class="edit-settings">
    <h4 v-text="i18n('editLabelSettings')"></h4>
    <div class="mb-2">
      <label>
        <input type="checkbox" v-model="config.enabled">
        <span v-text="i18n('buttonEnable')"/>
      </label>
    </div>
    <VMSettingsUpdate v-bind="{script}"/>
    <table>
      <tr>
        <td v-text="i18n('labelTags')"></td>
        <td>
          <input type="text" v-model="custom.tags" :disabled="readOnly">
        </td>
      </tr>
    </table>
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

<script setup>
import { computed, shallowRef } from 'vue';
import { getScriptHome, i18n } from '@/common';
import { KNOWN_INJECT_INTO } from '@/common/consts';
import { objectPick } from '@/common/object';
import VMSettingsUpdate from './settings-update';
import {
  kDownloadURL, kExclude, kExcludeMatch, kHomepageURL, kIcon, kInclude, kMatch, kName, kOrigExclude,
  kOrigExcludeMatch, kOrigInclude, kOrigMatch, kUpdateURL,
} from '../../utils';

const props = defineProps({
  script: Object,
  readOnly: Boolean,
});
const KII = shallowRef(KNOWN_INJECT_INTO);

const highlightMetaKeys = str => str.match(/^(.*?)(@[-a-z]+)(.*)/)?.slice(1) || [str, '', ''];
const config = computed(() => props.script.config);
const custom = computed(() => props.script.custom);
const placeholders = computed(() => {
  const { script } = props;
  const { meta } = script;
  return {
    ...objectPick(meta, [kIcon, kName]),
    [kHomepageURL]: getScriptHome(script),
    [kUpdateURL]: meta[kUpdateURL] || i18n('hintUseDownloadURL'),
    [kDownloadURL]: meta[kDownloadURL] || script.custom.lastInstallURL,
  };
});
const textInputs = [
  [kName, i18n('labelName')],
  [kHomepageURL, i18n('labelHomepageURL')],
  [kUpdateURL, i18n('labelUpdateURL')],
  [kDownloadURL, i18n('labelDownloadURL')],
  [kIcon, i18n('labelIconURL')],
];
const textAreas = [
  [kInclude, kOrigInclude, ...highlightMetaKeys(i18n('labelInclude'))],
  [kMatch, kOrigMatch, ...highlightMetaKeys(i18n('labelMatch'))],
  [kExclude, kOrigExclude, ...highlightMetaKeys(i18n('labelExclude'))],
  [kExcludeMatch, kOrigExcludeMatch, ...highlightMetaKeys(i18n('labelExcludeMatch'))],
];
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
