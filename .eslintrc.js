module.exports = {
  root: true,
  extends: [
    require.resolve('@gera2ld/plaid/eslint'),
    require.resolve('@gera2ld/plaid-vue/eslint/vue'),
  ],
  parserOptions: {
    ecmaFeatures: {
      legacyDecorators: true,
    },
  },
  rules: {
    'prefer-object-spread': 'off',
  },
  overrides: [{
    // `browser` is a local variable since we remove the global `chrome` and `browser` in injected*
    // to prevent exposing them to userscripts with `@inject-into content`
    files: ['*'],
    excludedFiles: [
      'src/injected/**/*.js',
      'src/injected/*.js',
      'src/common/*.js',
    ],
    globals: {
      browser: true,
    },
  }, {
    // no restrictions in browser.js to check the global `browser`
    files: ['browser.js'],
    globals: {
      browser: true,
    },
  }],
};
