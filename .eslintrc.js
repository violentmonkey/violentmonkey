const { readGlobalsFile, restrictedSyntax } = require('./scripts/webpack-util');
const ovr = makeOverrides();

module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-essential',
    'prettier',
  ],
  env: {
    browser: true,
    node: true,
    es2021: true,
  },
  parserOptions: {
    parser: '@babel/eslint-parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['jest'],
  rules: {
    'prettier/prettier': 'off',
    'no-shadow': 2,
    'no-unused-expressions': 2,
    'no-use-before-define': ['error', {
      'functions': false,
      'classes': true,
      'variables': false, // allowing for upper scopes
      'allowNamedExports': true,
    }],
    // copied from airbnb-base, replaced 4 with 8
    'object-curly-newline': ['error', {
      ObjectExpression: { minProperties: 8, multiline: true, consistent: true },
      ObjectPattern: { minProperties: 8, multiline: true, consistent: true },
      ImportDeclaration: { minProperties: 8, multiline: true, consistent: true },
      ExportDeclaration: { minProperties: 8, multiline: true, consistent: true },
    }],
    'semi': ['error'],
  },
  overrides: [{
    // `browser` is a local variable since we remove the global `chrome` and `browser` in injected*
    // to prevent exposing them to userscripts with `@inject-into content`
    files: ['*'],
    excludedFiles: [...ovr.FILES_INJECTED, ...ovr.FILES_SHARED],
    globals: {
      browser: false,
      ...ovr.GLOBALS_COMMON,
    },
  }, {
    files: ovr.FILES_SHARED,
    globals: ovr.GLOBALS_COMMON,
  }, {
    files: ovr.FILES_WEB,
    globals: ovr.GLOBALS_WEB,
  }, {
    files: ovr.FILES_CONTENT,
    globals: ovr.GLOBALS_CONTENT,
  }, {
    files: ovr.FILES_INJECTED,
    excludedFiles: [...ovr.FILES_CONTENT, ...ovr.FILES_WEB],
    // intersection of globals in CONTENT and WEB
    globals: Object.keys(ovr.GLOBALS_CONTENT).reduce((res, key) => (
      Object.assign(res, key in ovr.GLOBALS_WEB && { [key]: false })
    ), {}),
  }, {
    files: [...ovr.FILES_INJECTED, ...ovr.FILES_SHARED],
    rules: ovr.INJECTED_RULES,
  }, {
    files: ovr.FILES_WEB,
    rules: {
      ...ovr.INJECTED_RULES,
      'no-restricted-syntax': [
        ...ovr.INJECTED_RULES['no-restricted-syntax'],
        {
          selector: '[regex], NewExpression[callee.name="RegExp"]',
          message: 'RegExp internally depends on a *ton* of stuff that may be spoofed or broken',
          // https://262.ecma-international.org/12.0/#sec-regexpexec
        },
      ],
    },
  }, {
    // build scripts
    files: [
      '*.js',
      'scripts/*.js',
      'scripts/*.mjs',
    ],
    env: { node: true },
    rules: {
      'global-require': 0,
      'import/newline-after-import': 0,
      'import/no-extraneous-dependencies': 0, // spits errors in github action
      'import/extensions': 0,
    }
  }, {
    files: ['*.vue'],
    rules: {
      'vue/multi-word-component-names': 0,
    },
  }, {
    files: ['test/**'],
    env: {
      'jest/globals': true,
    },
  }],
};

function makeOverrides() {
  /* Note that `injected` uses several more `common` files indirectly, but we check just these
   * two automatically because they are trivial by design and must always pass the check */
  const GLOBALS_SHARED = getGlobals('*');
  const GLOBALS_INJECTED = {
    ...getGlobals('injected'),
    PAGE_MODE_HANDSHAKE: false,
    VAULT_ID: false,
  };
  function getGlobals(path) {
    const res = {};
    const { ast } = readGlobalsFile(path, { ast: true });
    ast.program.body.forEach(body => {
      const { declarations } = body.declaration || body;
      if (!declarations) return;
      declarations.forEach(function processId({
        id: {
          left,
          properties,
          name = left && left.name,
        },
      }) {
        if (name) {
          // const NAME = whatever
          // We consider `let` immutable too to avoid unintentional reassignment
          res[name] = false;
        } else if (properties) {
          // const { NAME1, prototype: { NAME2: ALIAS2 } } = whatever
          properties.forEach(({ value }) => processId({ id: value }));
        }
      });
    });
    return res;
  }

  return {
    FILES_CONTENT: [
      'src/injected/index.js',
      'src/injected/content/**/*.js',
    ],
    FILES_INJECTED: [
      'src/injected/**/*.js',
    ],
    FILES_SHARED: [
      'src/common/browser.js',
      'src/common/consts.js',
      'src/common/safe-globals-shared.js',
    ],
    FILES_WEB: [
      'src/injected/web/**/*.js',
    ],
    GLOBALS_INJECTED,
    GLOBALS_SHARED,
    GLOBALS_COMMON: {
      ...GLOBALS_SHARED,
      ...getGlobals('common'),
      re: false, // transform-modern-regexp with useRe option
    },
    GLOBALS_CONTENT: {
      INIT_FUNC_NAME: false,
      ...GLOBALS_SHARED,
      ...getGlobals('injected/content'),
      ...GLOBALS_INJECTED,
    },
    GLOBALS_WEB: {
      ...GLOBALS_SHARED,
      ...getGlobals('injected/web'),
      ...GLOBALS_INJECTED,
      IS_FIREFOX: false, // passed as a parameter to VMInitInjection in webpack.conf.js
    },
    INJECTED_RULES: {
      'no-restricted-imports': [
        'error', {
          patterns: ['*/common', '*/common/*'],
        }
      ],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
    },
  };
}
