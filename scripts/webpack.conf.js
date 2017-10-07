const path = require('path');
const webpack = require('webpack');
const FriendlyErrorsPlugin = require('friendly-errors-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const base = require('./webpack.base.conf');
const { IS_DEV, merge } = require('./utils');

const entry = {
  'background/app': 'src/background/app.js',
  'options/app': 'src/options/app.js',
  'confirm/app': 'src/confirm/app.js',
  'popup/app': 'src/popup/app.js',
  injected: 'src/injected/index.js',
};

const targets = [];
module.exports = targets;

targets.push(merge(base, {
  entry,
  plugins: [
    new webpack.optimize.CommonsChunkPlugin({
      name: 'common',
      chunks: Object.keys(entry).filter(name => name !== 'injected'),
      minChunks: (m, c) => c >= 2,
    }),
    new webpack.optimize.CommonsChunkPlugin({
      name: 'browser',
      chunks: ['common', 'injected'],
      minChunks: (m, c) => c >= 2,
    }),
    new HtmlWebpackPlugin({
      filename: 'background/index.html',
      chunks: ['browser', 'common', 'background/app'],
    }),
    new HtmlWebpackPlugin({
      filename: 'options/index.html',
      template: 'src/options/index.html',
      chunks: ['browser', 'common', 'options/app'],
    }),
    new HtmlWebpackPlugin({
      filename: 'confirm/index.html',
      template: 'src/public/index.html',
      chunks: ['browser', 'common', 'confirm/app'],
    }),
    new HtmlWebpackPlugin({
      filename: 'popup/index.html',
      template: 'src/popup/index.html',
      chunks: ['browser', 'common', 'popup/app'],
    }),
    // new FriendlyErrorsPlugin(),
    !IS_DEV && new ExtractTextPlugin('[name].css'),
    new webpack.NormalModuleReplacementPlugin(/\.\/rules\.json$/, resource => {
      resource.request = path.resolve(__dirname, '../src/resources/empty-rules.json');
    }),
  ].filter(Boolean),
}));

targets.push(merge(base, {
  entry: {
    'injected-web': 'src/injected/web',
  },
  output: {
    libraryTarget: 'commonjs2',
  },
  plugins: [
    new WrapperWebpackPlugin({
      header: `\
window.VM_initializeWeb = function () {
  var module = { exports: {} };
`,
      footer: `
  var exports = module.exports;
  return exports.__esModule ? exports['default'] : exports;
};`,
    }),
  ],
}));
