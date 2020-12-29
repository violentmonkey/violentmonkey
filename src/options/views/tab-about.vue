<template>
  <div class="tab-about">
    <h1 class="mt-0">
      <span class="mr-1" v-text="name"></span>
      <small v-text="`v${version}`"></small>
    </h1>
    <p class="mb-2" v-text="i18n('extDescription')"></p>
    <div class="mb-2">
      <a href="https://violentmonkey.github.io/donate/" target="_blank" rel="noopener noreferrer" v-text="i18n('labelDonate')"></a><span class="text-red"> &hearts;</span>
    </div>
    <div class="mb-1">
      <label v-text="i18n('labelRelated')"></label>
      <ul>
        <li><a href="https://violentmonkey.github.io" target="_blank" rel="noopener noreferrer" v-text="i18n('labelHomepage')"></a></li>
        <li><a href="https://github.com/violentmonkey/violentmonkey/issues" target="_blank" rel="noopener noreferrer" v-text="i18n('labelFeedback')"></a></li>
        <li><a href="https://github.com/violentmonkey/violentmonkey/graphs/contributors" target="_blank" rel="noopener noreferrer" v-text="i18n('labelContributors')"></a></li>
        <li><a href="https://violentmonkey.github.io/privacy/" target="_blank" rel="noopener noreferrer" v-text="i18n('labelPrivacyPolicy')"></a></li>
      </ul>
    </div>
    <div class="mb-1">
      <label v-text="i18n('labelCurrentLang')"></label>
      <span class="current" v-text="language"></span> |
      <a href="https://violentmonkey.github.io/localization/" target="_blank" rel="noopener noreferrer" v-text="i18n('labelHelpTranslate')"></a>
    </div>
  </div>
</template>

<script>


export default {
  data() {
    const manifest = browser.runtime.getManifest();
    return {
      name: manifest.name,
      version: manifest.version,
      language: browser.i18n.getUILanguage(),
    };
  },
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
