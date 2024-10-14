<template>
  <div class="tab-about mb-2c">
    <h1 class="mt-0 mr-1c">
      <span v-text="name"></span>
      <small v-text="`v${version}`"></small>
    </h1>
    <p v-text="i18n('extDescription')"></p>
    <div>
      <label v-text="i18n('labelRelated')"></label>
      <ul>
        <li v-for="(text, url) in LINKS" :key="url">
          <a :href="url" v-bind="EXTERNAL_LINK_PROPS" v-text="text"/>
        </li>
      </ul>
    </div>
    <div>
      <label v-text="i18n('labelCurrentLang')"></label>
      <span class="current" v-text="language"></span> |
      <a :href="VM_HOME + 'localization/'" v-bind="EXTERNAL_LINK_PROPS" v-text="i18n('labelHelpTranslate')"/>
    </div>
  </div>
</template>

<script setup>
import { i18n } from '@/common';
import { VM_HOME } from '@/common/consts';
import { EXTERNAL_LINK_PROPS } from '@/common/ui';

const name = extensionManifest.name;
const version = process.env.VM_VER;
const language = browser.i18n.getUILanguage();
const GITHUB = 'https://github.com/violentmonkey/violentmonkey/';
const LINKS = {
  [VM_HOME]: i18n('labelHomepage'),
  [GITHUB + 'issues']: i18n('labelFeedback'),
  [GITHUB + 'graphs/contributors']: i18n('labelContributors'),
  [VM_HOME + 'privacy/']: i18n('labelPrivacyPolicy'),
};
</script>

<style>
.current {
  color: green;
  @media (prefers-color-scheme: dark) {
    color: greenyellow;
  }
}
</style>
