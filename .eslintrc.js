const acorn = require('acorn');
const FILES_INJECTED = [`src/injected/**/*.js`];
const FILES_CONTENT = [`src/injected/content/**/*.js`];
const FILES_WEB = [`src/injected/web/**/*.js`];
  // some functions are used by `injected`
const FILES_SHARED = [
  'src/common/browser.js',
  'src/common/consts.js',
  'src/common/index.js',
  'src/common/object.js',
  'src/common/util.js',
];

const GLOBALS_COMMON = getGlobals('src/common/safe-globals.js');
const GLOBALS_INJECTED = getGlobals(`src/injected/safe-globals-injected.js`);
const GLOBALS_CONTENT = {
  ...getGlobals(`src/injected/content/safe-globals-content.js`),
  ...GLOBALS_INJECTED,
};
const GLOBALS_WEB = {
  ...getGlobals(`src/injected/web/safe-globals-web.js`),
  ...GLOBALS_INJECTED,
  IS_FIREFOX: false, // passed as a parameter to VMInitInjection in webpack.conf.js
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
    excludedFiles: [...FILES_INJECTED, ...FILES_SHARED],
    globals: {
      browser: false,
      ...GLOBALS_COMMON,
    },
  }, {
    files: FILES_SHARED,
    globals: GLOBALS_COMMON,
  }, {
    files: FILES_WEB,
    globals: GLOBALS_WEB,
  }, {
    files: FILES_CONTENT,
    globals: GLOBALS_CONTENT,
  }, {
    files: FILES_INJECTED,
    excludedFiles: [...FILES_CONTENT, ...FILES_WEB],
    // intersection of globals in CONTENT and WEB
    globals: Object.keys(GLOBALS_CONTENT).reduce((res, key) => (
      Object.assign(res, key in GLOBALS_WEB && { [key]: false })
    ), {}),
  }, {
    files: [...FILES_INJECTED, ...FILES_SHARED],
    rules: {
      /* Our .browserslistrc targets old browsers so the compiled code for {...objSpread} uses
         babel's polyfill that calls methods like `Object.assign` instead of our safe `assign`.
         Ideally, `eslint-plugin-compat` should be used but I couldn't make it work. */
      'no-restricted-syntax': ['error', {
        selector: 'ObjectExpression > ExperimentalSpreadProperty',
        message: 'Object spread adds a polyfill in injected* even if unused by it',
      }, {
        selector: 'OptionalCallExpression',
        message: 'Optional call uses .call(), which may be spoofed/broken in an unsafe environment',
        // TODO: write a Babel plugin to use safeCall for this.
      }, {
        selector: 'ArrayPattern',
        message: 'Destructuring via Symbol.iterator may be spoofed/broken in an unsafe environment',
      }, {
        selector: ':matches(ArrayExpression, CallExpression) > SpreadElement',
        message: 'Spreading via Symbol.iterator may be spoofed/broken in an unsafe environment',
      }],
    },
  }, {
    // build scripts
    files: [
      '*.js',
      'scripts/*.js',
    ],
    env: { node: true },
    rules: {
      'global-require': 0,
      'import/newline-after-import': 0,
      'import/no-extraneous-dependencies': 0, // spits errors in github action
    }
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
  const tree = acorn.parse(text, { ecmaVersion: 2018, sourceType: 'module' });
  tree.body.forEach(body => {
    const { declarations } = body.declaration || body;
    if (!declarations) return;
    declarations.forEach(function processId({ id: { left, properties, name = left && left.name } }) {
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
