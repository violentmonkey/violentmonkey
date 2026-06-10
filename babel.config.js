const { alias, extensions } = require('./scripts/common');
const fs = require('node:fs');
const yaml = require('js-yaml');

const manifest = yaml.load(fs.readFileSync('src/manifest.yml', 'utf8'));
const isTest = process.env.BABEL_ENV === 'test';

module.exports = {
  targets: [
    `Chrome >= ${parseInt(manifest.minimum_chrome_version)}`,
    `Firefox >= ${parseInt(manifest.browser_specific_settings.gecko.strict_min_version)}`,
  ].join(','),
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
    ['@babel/plugin-transform-runtime', {
      useESModules: !isTest,
      version: '^7.5.0',
    }],
    ['babel-plugin-module-resolver', {
      alias,
      extensions,
    }],
    './scripts/babel-plugin-safe-bind.js',
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    ['transform-modern-regexp', { useRe: true }],
  ],
};
