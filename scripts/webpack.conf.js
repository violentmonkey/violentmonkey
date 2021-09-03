const { modifyWebpackConfig, shallowMerge, defaultOptions } = require('@gera2ld/plaid');
const { isProd } = require('@gera2ld/plaid/util');
const webpack = require('webpack');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const projectConfig = require('./plaid.conf');
const mergedConfig = shallowMerge(defaultOptions, projectConfig);

const INIT_FUNC_NAME = 'VMInitInjection';
// Copied from gulpfile.js: strip alphabetic suffix
const VM_VER = require('../package.json').version.replace(/-[^.]*/, '');

const pickEnvs = (items) => {
  return Object.assign({}, ...items.map(x => ({
    [`process.env.${x.key}`]: JSON.stringify(
      'val' in x ? x.val
        : process.env[x.key] ?? x.def
    ),
  })));
};

const definitions = new webpack.DefinePlugin({
  ...pickEnvs([
    { key: 'DEBUG', def: false },
    { key: 'VM_VER', val: VM_VER },
    { key: 'SYNC_GOOGLE_CLIENT_ID' },
    { key: 'SYNC_GOOGLE_CLIENT_SECRET' },
    { key: 'SYNC_ONEDRIVE_CLIENT_ID' },
    { key: 'SYNC_ONEDRIVE_CLIENT_SECRET' },
  ]),
  'process.env.INIT_FUNC_NAME': JSON.stringify(INIT_FUNC_NAME),
});
const minimizerOptions = {
  cache: true,
  parallel: true,
  sourceMap: true,
  terserOptions: {
    output: {
      ascii_only: true,
    },
  },
};
const minimizer = isProd && [
  new TerserPlugin({
    chunkFilter: ({ name }) => !name.startsWith('public/'),
    ...minimizerOptions,
    terserOptions: {
      ...minimizerOptions.terserOptions,
      compress: {
        ecma: 6,
        // 'safe' since we don't rely on function prototypes
        unsafe_arrows: true,
      },
    },
  }),
  new TerserPlugin({
    chunkFilter: ({ name }) => name.startsWith('public/'),
    ...minimizerOptions,
  }),
];

const modify = (page, entry, init) => modifyWebpackConfig(
  (config) => {
    config.plugins.push(definitions);
    if (!entry) init = page;
    if (init) init(config);
    return config;
  }, {
    projectConfig: {
      ...mergedConfig,
      ...entry && { pages: { [page]: { entry }} },
      optimization: {
        ...mergedConfig.optimization,
        minimizer,
      },
    },
  },
);

// avoid running webpack bootstrap in a potentially hacked environment
// after documentElement was replaced which triggered reinjection of content scripts
const skipReinjectionHeader = `if (window['${INIT_FUNC_NAME}'] !== 1)`;
module.exports = Promise.all([
  modify((config) => {
    config.output.publicPath = '/';
  }),
  modify('injected', './src/injected', (config) => {
    config.plugins.push(
      new WrapperWebpackPlugin({
        header: skipReinjectionHeader,
      }));
  }),
  modify('injected-web', './src/injected/web', (config) => {
    config.output.libraryTarget = 'commonjs2';
    config.plugins.push(
      new WrapperWebpackPlugin({
        header: `${skipReinjectionHeader}
          window['${INIT_FUNC_NAME}'] = function () {
            var module = { exports: {} };
          `,
        footer: `
            var exports = module.exports;
            return exports.__esModule ? exports['default'] : exports;
          };0;`,
      }),
    );
  }),
]);
