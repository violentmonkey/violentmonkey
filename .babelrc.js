const path = require('path');
const { defaultOptions } = require('@gera2ld/plaid/util');

defaultOptions.alias = {
  '@': path.resolve('src'),
};

module.exports = {
  extends: require.resolve('@gera2ld/plaid/config/babelrc'),
  presets: [
    ['@babel/preset-env', {
      ...process.env.BABEL_ENV !== 'test' && {
        modules: false,
      },
      useBuiltIns: false,
      loose: true,
    }],
  ],
  plugins: [
    './scripts/babel-plugin-safe-bind.js',
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    ['transform-modern-regexp', { useRe: true }],
  ],
};
