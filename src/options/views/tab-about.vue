<template>
  <div class="tab-about">
    <h1>
      <span v-text="i18n('labelAbout')"></span>
      <small v-text="`v${version}`"></small>
    </h1>
    <p class="mb-2" v-text="i18n('extDescription')"></p>
    <div class="mb-1">
      <label v-text="i18n('labelRelated')"></label>
      <a href="https://violentmonkey.github.io" target="_blank" v-text="i18n('labelHomepage')"></a> |
      <a href="https://github.com/violentmonkey/violentmonkey/issues" target="_blank" v-text="i18n('labelFeedback')"></a>
    </div>
    <div class="mb-1">
      <label v-text="i18n('labelAuthor')"></label>
      <span v-html="i18n('anchorAuthor')"></span> | <a href="https://violentmonkey.github.io/donate/" target="_blank" v-text="i18n('labelDonate')"></a> <span class="text-red">&hearts;</span>
    </div>
    <div class="mb-1">
      <label v-text="i18n('labelTranslator')"></label>
      <span v-html="i18n('anchorTranslator')"></span>
    </div>
    <div class="mb-1">
      <label v-text="i18n('labelCurrentLang')"></label>
      <span class="text-green" v-text="language"></span> |
      <a href="https://violentmonkey.github.io/localization/" target="_blank">
        Help with translation
      </a>
    </div>
  </div>
</template>

<script>
const data = {
  version: browser.runtime.getManifest().version,
  language: navigator.language,
};

export default {
  data() {
    return data;
  },
};
</script>
