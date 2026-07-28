const { alias, extensions } = require('./scripts/common');
const { getBrowserTargets } = require('./scripts/manifest-helper');

const isTest = process.env.BABEL_ENV === 'test';

module.exports = {
  targets: getBrowserTargets(),
  presets: [
    ['@babel/preset-env', {
      ...!isTest && {
        modules: false,
      },
      useBuiltIns: false,
      bugfixes: true,
      // debug: true,
      loose: true,
    }],
  ],
  plugins: [
    isTest && ['@babel/plugin-transform-runtime', {
      useESModules: false,
      version: '^7.5.0',
    }],
    isTest && ['babel-plugin-module-resolver', {
      alias,
      extensions,
    }],
    './scripts/babel-plugin-safe-bind.js',
    ['babel-plugin-transform-regex', {
      removeImport: true,
      disableUnicodeSets: true,
    }],
  ].filter(Boolean),
};
