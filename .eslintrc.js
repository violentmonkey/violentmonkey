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
  overrides: [{
    // `browser` is a local variable since we remove the global `chrome` and `browser` in injected*
    // to prevent exposing them to userscripts with `@inject-into content`
    files: ['*'],
    excludedFiles: [
      'src/injected/**/*.js',
      'src/common/*.js',
    ],
    globals: {
      browser: false,
    },
  }],
  rules: {
    'import/extensions': ['error', 'ignorePackages', {
      js: 'never',
      vue: 'never',
    }],
  },
};
