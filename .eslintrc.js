module.exports = {
  root: true,
  parserOptions: {
    parser: 'babel-eslint',
  },
  extends: [
    'airbnb-base',
    require.resolve('./scripts/eslint/vue'),
  ],
  env: {
    browser: true,
  },
  settings: {
    'import/resolver': {
      'babel-module': {},
    },
  },
  rules: {
    'no-param-reassign': 'off',
    'consistent-return': 'off',
    'no-use-before-define': ['error', 'nofunc'],
    'no-mixed-operators': 'off',
    'no-bitwise': ['error', { int32Hint: true }],
    'arrow-parens': ['error', 'as-needed'],
    'prefer-promise-reject-errors': 'off',
    'prefer-destructuring': ['error', { array: false }],
    'no-console': ['warn', {
      allow: ['error', 'warn', 'info'],
    }],
    indent: ['error', 2, { MemberExpression: 0 }],
    'object-shorthand': ['error', 'always'],
    'no-restricted-syntax': 'off',
    'class-methods-use-this': 'off',
    'import/prefer-default-export': 'off',
  },
  globals: {
    browser: true,
    zip: true,
  },
};
