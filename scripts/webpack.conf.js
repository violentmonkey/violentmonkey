const path = require('path');
const webpack = require('webpack');
const FriendlyErrorsPlugin = require('friendly-errors-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const utils = require('./utils');
const vueLoaderConfig = require('./vue-loader.conf');
const IS_DEV = process.env.NODE_ENV !== 'production';
const DIST = 'dist';

function resolve (dir) {
  return path.join(__dirname, '..', dir)
}

const base = {
  output: {
    path: path.resolve(DIST),
    publicPath: '/',
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.js', '.vue', '.json'],
    alias: {
      src: resolve('src'),
    }
  },
  module: {
    rules: [
      // {
      //   test: /\.(js|vue)$/,
      //   loader: 'eslint-loader',
      //   enforce: 'pre',
      //   include: [resolve('src'), resolve('test')],
      //   options: {
      //     formatter: require('eslint-friendly-formatter')
      //   }
      // },
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
    ].concat(utils.styleLoaders({
      sourceMap: false,
      extract: !IS_DEV,
    })),
  },
  // cheap-module-eval-source-map is faster for development
  devtool: IS_DEV ? '#inline-source-map' : false,
};

const targets = module.exports = [];

targets.push(Object.assign({}, base, {
  entry: {
    'background/app': 'src/background/app.js',
    'options/app': 'src/options/app.js',
    'popup/app': 'src/popup/app.js',
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {},
    }),
    // split vendor js into its own file
    new webpack.optimize.CommonsChunkPlugin({
      name: 'vendor',
    }),
    new HtmlWebpackPlugin({
      filename: 'background/index.html',
      template: 'src/background/index.html',
      inject: true,
      chunks: ['vendor', 'background/app'],
      chunksSortMode: 'dependency'
    }),
    new HtmlWebpackPlugin({
      filename: 'options/index.html',
      template: 'src/options/index.html',
      inject: true,
      chunks: ['vendor', 'options/app'],
      chunksSortMode: 'dependency'
    }),
    new HtmlWebpackPlugin({
      filename: 'popup/index.html',
      template: 'src/popup/index.html',
      inject: true,
      chunks: ['vendor', 'popup/app'],
      chunksSortMode: 'dependency'
    }),
    // new FriendlyErrorsPlugin(),
    ... IS_DEV ? [
    ] : [
      // extract css into its own file
      new ExtractTextPlugin('[name].css'),
      // generate dist index.html with correct asset hash for caching.
      // you can customize output by editing /index.html
      // see https://github.com/ampedandwired/html-webpack-plugin
      // new HtmlWebpackPlugin({
      //   filename: 'index.html',
      //   template: 'src/public/index.ejs',
      //   inject: true,
      //   minify: {
      //     removeComments: true,
      //     collapseWhitespace: true,
      //     removeAttributeQuotes: true
      //     // more options:
      //     // https://github.com/kangax/html-minifier#options-quick-reference
      //   },
      //   // necessary to consistently work with multiple chunks via CommonsChunkPlugin
      //   chunksSortMode: 'dependency'
      // }),
      new webpack.optimize.UglifyJsPlugin({
        compress: {
          warnings: false
        }
      }),
    ],
  ],
}));

targets.push(Object.assign({}, base, {
  entry: {
    injected: 'src/injected.js',
  },
  plugins: IS_DEV ? [] : [
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        warnings: false
      }
    }),
  ],
}));
