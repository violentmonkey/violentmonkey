const acorn = require('acorn');
const unsafeEnvironment = [
  'src/injected/**/*.js',
];
// some functions are used by `injected`
const unsafeSharedEnvironment = [
  'src/common/browser.js',
  'src/common/consts.js',
  'src/common/index.js',
  'src/common/object.js',
  'src/common/util.js',
];
const commonGlobals = getGlobals('src/common/safe-globals.js');
const injectedGlobals = {
  ...commonGlobals,
  ...getGlobals('src/injected/safe-injected-globals.js'),
};

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
    excludedFiles: [...unsafeEnvironment, ...unsafeSharedEnvironment],
    globals: {
      browser: false,
      ...commonGlobals,
    },
  }, {
    files: unsafeEnvironment,
    globals: injectedGlobals,
    rules: {
      // Whitelisting our safe globals
      'no-restricted-globals': ['error',
        ...require('confusing-browser-globals').filter(x => injectedGlobals[x] == null),
      ],
      /* Our .browserslistrc targets old browsers so the compiled code for {...objSpread} uses
         babel's polyfill that calls methods like `Object.assign` instead of our safe `assign`.
         Ideally, `eslint-plugin-compat` should be used but I couldn't make it work. */
      'no-restricted-syntax': ['error', {
        selector: 'ObjectExpression > ExperimentalSpreadProperty',
        message: 'Object spread in an unsafe environment',
      }, {
        selector: 'OptionalCallExpression',
        message: 'Optional call in an unsafe environment',
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

function getGlobals(fileName) {
  const text = require('fs').readFileSync(fileName, { encoding: 'utf8' });
  const res = {};
  acorn.parse(text, { ecmaVersion: 2018, sourceType: 'module' }).body.forEach(body => {
    (body.declaration || body).declarations.forEach(function processId({ id: { name, properties } }) {
      if (name) {
        // const NAME = whatever
        res[name] = false;
      } else if (properties) {
        // const { NAME1, prototype: { NAME2: ALIAS2 } } = whatever
        properties.forEach(({ value }) => processId({ id: value }));
      }
    });
  });
  return res;
}
