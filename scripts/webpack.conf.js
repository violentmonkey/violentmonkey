const webpack = require('webpack');
const FriendlyErrorsPlugin = require('friendly-errors-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const base = require('./webpack.base.conf');
const { IS_DEV } = require('./utils');

const entry = {
  'background/app': 'src/background/app.js',
  'options/app': 'src/options/app.js',
  'popup/app': 'src/popup/app.js',
  injected: 'src/injected/index.js',
};

module.exports = Object.assign({}, base, {
  entry,
  plugins: [
    ... base.plugins,
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
    ... IS_DEV ? [
    ] : [
      // extract css into its own file
      new ExtractTextPlugin('[name].css'),
      new webpack.optimize.UglifyJsPlugin({
        compress: {
          warnings: false
        }
      }),
    ],
  ],
  externals: {
    localStorage: 'localStorage',
  },
});
