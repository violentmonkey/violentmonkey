const { modifyWebpackConfig, shallowMerge, defaultOptions } = require('@gera2ld/plaid');
const webpack = require('webpack');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const projectConfig = require('./plaid.conf');

const INIT_FUNC_NAME = 'VMInitInjection';

module.exports = Promise.all([
  modifyWebpackConfig(async (config) => {
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.INIT_FUNC_NAME': JSON.stringify(INIT_FUNC_NAME),
        'process.env.DEBUG': JSON.stringify(process.env.DEBUG || false),
      }),
    );
    return config;
  }),
  modifyWebpackConfig(async (config) => {
    config.output.libraryTarget = 'commonjs2';
    config.plugins.push(
      new WrapperWebpackPlugin({
        header: `\
window.${INIT_FUNC_NAME} = function () {
  var module = { exports: {} };
`,
        footer: `
  var exports = module.exports;
  return exports.__esModule ? exports['default'] : exports;
};0;`,
      }),
    );
    return config;
  }, {
    projectConfig: {
      ...shallowMerge(defaultOptions, projectConfig),
      optimization: {
        runtimeChunk: false,
        splitChunks: false,
      },
      pages: {
        'injected-web': {
          entry: './src/injected/web',
        },
      },
    },
  }),
]);
