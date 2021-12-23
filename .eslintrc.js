const { readGlobalsFile } = require('./scripts/webpack-util');

const FILES_INJECTED = [`src/injected/**/*.js`];
const FILES_CONTENT = [
  'src/injected/*.js',
  'src/injected/content/**/*.js',
];
const FILES_WEB = [`src/injected/web/**/*.js`];
/* Note that `injected` uses several more `common` files indirectly, but we check just these
 * two automatically because they are trivial by design and must always pass the check */
const FILES_SHARED = [
  'src/common/browser.js',
  'src/common/consts.js',
];

const GLOBALS_COMMON = getGlobals('src/common/safe-globals.js');
const GLOBALS_INJECTED = getGlobals(`src/injected/safe-globals-injected.js`);
const GLOBALS_CONTENT = {
  INIT_FUNC_NAME: false,
  ...getGlobals(`src/injected/content/safe-globals-content.js`),
  ...GLOBALS_INJECTED,
};
const GLOBALS_WEB = {
  ...getGlobals(`src/injected/web/safe-globals-web.js`),
  ...GLOBALS_INJECTED,
  IS_FIREFOX: false, // passed as a parameter to VMInitInjection in webpack.conf.js
};

const INJECTED_RULES = {
  'no-restricted-imports': ['error', {
    patterns: ['*/common', '*/common/*'],
  }],
  'no-restricted-syntax': [
    'error', {
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
    }, {
      selector: '[callee.object.name="Object"], MemberExpression[object.name="Object"]',
      message: 'Using potentially spoofed methods in an unsafe environment',
      // TODO: auto-generate the rule using GLOBALS
    }, {
      selector: `CallExpression[callee.name="defineProperty"]:not(${[
        '[arguments.2.properties.0.key.name="__proto__"]',
        ':has(CallExpression[callee.name="createNullObj"])'
      ].join(',')})`,
      message: 'Prototype of descriptor may be spoofed/broken in an unsafe environment',
    }
  ],
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
    rules: INJECTED_RULES,
  }, {
    files: FILES_WEB,
    rules: {
      ...INJECTED_RULES,
      'no-restricted-syntax': [
        ...INJECTED_RULES['no-restricted-syntax'],
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

function getGlobals(filename) {
  const res = {};
  const { ast } = readGlobalsFile(filename, { ast: true });
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
        res[name] = false;
      } else if (properties) {
        // const { NAME1, prototype: { NAME2: ALIAS2 } } = whatever
        properties.forEach(({ value }) => processId({ id: value }));
      }
    });
  });
  return res;
}
