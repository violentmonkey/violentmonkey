import js from '@eslint/js';
import globals from 'globals';
import vue from 'eslint-plugin-vue';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-config-prettier';
import babelParser from '@babel/eslint-parser';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { readGlobalsFile, restrictedSyntax } = require('./scripts/webpack-util.js');

const ovr = makeOverrides();

export default [
  // Ignore files
  {
    ignores: [
      'dist/**',
      '.git/**',
      'node_modules/**',
      'Release/**',
      'build/**',
      '**/*.js',
      '!src/**',
      '!test/**',
      '!scripts/*',
      '!gulpfile.js',
      'src/public/**',
    ],
  },
  // Main config
  {
    files: ['**/*.js', '**/*.vue', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        // `browser` is a local variable since we remove the global `chrome` and `browser`
        browser: false,
        ...ovr.GLOBALS_COMMON,
      },
    },
    plugins: {
      vue,
      jest,
    },
    rules: {
      ...js.configs.recommended.rules,
      'prettier/prettier': 'off',
      'no-constant-condition': 'off',
      'no-shadow': 2,
      'no-unused-expressions': 2,
      'no-use-before-define': ['error', {
        'functions': false,
        'classes': true,
        'variables': false,
        'allowNamedExports': true,
      }],
      'object-curly-newline': ['error', {
        ObjectExpression: { minProperties: 8, multiline: true, consistent: true },
        ObjectPattern: { minProperties: 8, multiline: true, consistent: true },
        ImportDeclaration: { minProperties: 8, multiline: true, consistent: true },
        ExportDeclaration: { minProperties: 8, multiline: true, consistent: true },
      }],
      'semi': ['error'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // Shared files
  {
    files: ovr.FILES_SHARED,
    languageOptions: {
      globals: ovr.GLOBALS_COMMON,
    },
  },
  // Web files
  {
    files: ovr.FILES_WEB,
    languageOptions: {
      globals: ovr.GLOBALS_WEB,
    },
  },
  // Content files
  {
    files: ovr.FILES_CONTENT,
    languageOptions: {
      globals: ovr.GLOBALS_CONTENT,
    },
  },
  // Injected files (excluding content and web)
  {
    files: ovr.FILES_INJECTED,
    languageOptions: {
      globals: Object.keys(ovr.GLOBALS_CONTENT).reduce((res, key) => (
        Object.assign(res, key in ovr.GLOBALS_WEB && { [key]: false })
      ), {}),
    },
  },
  // Injected and Shared rules
  {
    files: [...ovr.FILES_INJECTED, ...ovr.FILES_SHARED],
    rules: ovr.INJECTED_RULES,
  },
  // Web file restricted syntax
  {
    files: ovr.FILES_WEB,
    rules: {
      ...ovr.INJECTED_RULES,
      'no-restricted-syntax': [
        ...ovr.INJECTED_RULES['no-restricted-syntax'],
        {
          selector: '[regex], NewExpression[callee.name="RegExp"]',
          message: 'RegExp internally depends on a *ton* of stuff that may be spoofed or broken',
        },
      ],
    },
  },
  // Build scripts
  {
    files: [
      '*.js',
      '*.mjs',
      '*.cjs',
      'scripts/*.js',
      'scripts/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'global-require': 0,
      'import/newline-after-import': 0,
      'import/no-extraneous-dependencies': 0,
      'import/extensions': 0,
    }
  },
  // Vue files with proper parser
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: require('vue-eslint-parser'),
      parserOptions: {
        parser: babelParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        browser: false,
        ...ovr.GLOBALS_COMMON,
      },
    },
    plugins: {
      vue,
    },
    rules: {
      ...js.configs.recommended.rules,
      'prettier/prettier': 'off',
      'no-constant-condition': 'off',
      'no-shadow': 2,
      'no-unused-expressions': 2,
      'no-use-before-define': ['error', {
        'functions': false,
        'classes': true,
        'variables': false,
        'allowNamedExports': true,
      }],
      'object-curly-newline': ['error', {
        ObjectExpression: { minProperties: 8, multiline: true, consistent: true },
        ObjectPattern: { minProperties: 8, multiline: true, consistent: true },
        ImportDeclaration: { minProperties: 8, multiline: true, consistent: true },
        ExportDeclaration: { minProperties: 8, multiline: true, consistent: true },
      }],
      'semi': ['error'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 0,
    },
  },
  // Specific override for message.vue to allow prop mutation
  {
    files: ['src/common/ui/message.vue'],
    rules: {
      'vue/no-mutating-props': 'off',
    },
  },
  // Test files
  {
    files: ['test/**'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        test: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      jest,
    },
    rules: {
      // Jest-specific rules can go here if needed
    },
  },
];

function makeOverrides() {
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
          res[name] = false;
        } else if (properties) {
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
      re: false,
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
      IS_FIREFOX: false,
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
