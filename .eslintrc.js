// http://eslint.org/docs/user-guide/configuring

module.exports = {
  root: true,
  parser: 'babel-eslint',
  parserOptions: {
    sourceType: 'module'
  },
  env: {
    browser: true,
  },
  extends: 'airbnb-base',
  // required to lint *.vue files
  plugins: [
    'html'
  ],
  // check if imports actually resolve
  'settings': {
    'import/resolver': {
      'webpack': {
        'config': 'scripts/webpack.conf.js'
      }
    }
  },
  // add your custom rules here
  'rules': {
    // don't require .vue extension when importing
    'import/extensions': ['error', 'always', {
      'js': 'never',
      'vue': 'never'
    }],
    // allow debugger during development
    'no-debugger': process.env.NODE_ENV === 'production' ? 2 : 0,
    'no-console': ['error', {
      allow: ['error', 'warn'],
    }],
    'no-param-reassign': ['error', {
      props: false,
    }],
    'array-callback-return': ['off'],
    'consistent-return': ['off'],
    'no-use-before-define': ['error', 'nofunc'],
    'object-shorthand': ['error', 'always'],
    'no-mixed-operators': ['error', {allowSamePrecedence: true}],
    'no-bitwise': ['error', {int32Hint: true}],
    'no-underscore-dangle': ['off'],
    'arrow-parens': 0,
    'indent': ['error', 2, { MemberExpression: 0 }],
  },
  globals: {
    browser: true,
    zip: true,
  },
}
