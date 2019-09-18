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
  globals: {
    browser: true,
    zip: true,
  },
};
