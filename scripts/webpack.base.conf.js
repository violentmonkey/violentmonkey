const path = require('path');
const webpack = require('webpack');
const MinifyPlugin = require('babel-minify-webpack-plugin');
const vueLoaderConfig = require('./vue-loader.conf');
const { isDev, isProd, styleRule, definitions } = require('./utils');

const DIST = 'dist';
const definePlugin = new webpack.DefinePlugin(definitions);

function resolve(dir) {
  return path.join(__dirname, '..', dir);
}

module.exports = {
  output: {
    path: resolve(DIST),
    publicPath: '/',
    filename: '[name].js',
  },
  resolve: {
    // Tell webpack to look for peer dependencies in `node_modules`
    // when packages are linked from outside directories
    modules: [resolve('node_modules')],
    extensions: ['.js', '.vue'],
    alias: {
      src: resolve('src'),
    }
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: vueLoaderConfig
      },
      {
        test: /\.js$/,
        loader: 'babel-loader',
        include: [resolve('src'), resolve('test')]
      },
      {
        test: /\.svg$/,
        loader: 'svg-sprite-loader',
        include: [resolve('src/resources/icons')],
      },
      styleRule({
        fallback: 'vue-style-loader',
        loaders: ['postcss-loader'],
      }),
    ],
  },
  // cheap-module-eval-source-map is faster for development
  devtool: isDev ? '#inline-source-map' : false,
  plugins: [
    definePlugin,
    isProd && new MinifyPlugin(),
  ].filter(Boolean),
};
