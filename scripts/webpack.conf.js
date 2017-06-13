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
  'popup/app': 'src/popup/app.js',
  injected: 'src/injected/index.js',
};

const targets = [];
module.exports = targets;

targets.push(merge(base, {
  entry,
  plugins: [
    new webpack.optimize.CommonsChunkPlugin({
      name: 'browser',
      chunks: Object.keys(entry),
    }),
    new webpack.optimize.CommonsChunkPlugin({
      name: 'vendor',
      chunks: Object.keys(entry).filter(key => key !== 'injected'),
      minChunks: 2,
    }),
    new HtmlWebpackPlugin({
      filename: 'background/index.html',
      template: 'src/background/index.html',
      inject: true,
      chunks: ['vendor', 'browser', 'background/app'],
      chunksSortMode: 'dependency'
    }),
    new HtmlWebpackPlugin({
      filename: 'options/index.html',
      template: 'src/options/index.html',
      inject: true,
      chunks: ['vendor', 'browser', 'options/app'],
      chunksSortMode: 'dependency'
    }),
    new HtmlWebpackPlugin({
      filename: 'popup/index.html',
      template: 'src/popup/index.html',
      inject: true,
      chunks: ['vendor', 'browser', 'popup/app'],
      chunksSortMode: 'dependency'
    }),
    // new FriendlyErrorsPlugin(),
    !IS_DEV && new ExtractTextPlugin('[name].css'),
  ].filter(Boolean),
  externals: {
    localStorage: 'localStorage',
  },
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
