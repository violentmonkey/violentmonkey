const unsafeEnvironment = [
  'src/injected/**/*.js',
  // these are used by `injected`
  'src/common/browser.js',
  'src/common/consts.js',
  'src/common/index.js',
  'src/common/object.js',
  'src/common/util.js',
];
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
    excludedFiles: unsafeEnvironment,
    globals: {
      browser: false,
    },
  }, {
    files: unsafeEnvironment,
    rules: {
      /* Our .browserslistrc targets old browsers so the compiled code for {...objSpread} uses
         babel's polyfill that calls methods like `Object.assign` instead of our safe `assign`.
         Ideally, `eslint-plugin-compat` should be used but I couldn't make it work. */
      'no-restricted-syntax': ['error', {
        selector: 'ObjectExpression > ExperimentalSpreadProperty',
        message: 'Object spread in an unsafe environment',
      }],
    },
  }],
  rules: {
    'import/extensions': ['error', 'ignorePackages', {
      js: 'never',
      vue: 'never',
    }],
    // copied from airbnb-base, replaced 4 with 8
    'object-curly-newline': ['error', {
      ObjectExpression: { minProperties: 8, multiline: true, consistent: true },
      ObjectPattern: { minProperties: 8, multiline: true, consistent: true },
      ImportDeclaration: { minProperties: 8, multiline: true, consistent: true },
      ExportDeclaration: { minProperties: 8, multiline: true, consistent: true },
    }],
  },
};
