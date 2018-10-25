const UglifyJsPlugin = require('uglifyjs-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const OptimizeCSSAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const { isProd, styleRule, resolve, DIST } = require('../util');

module.exports = options => config => {
  const { style } = options;
  const defaultStyleOptions = {
    loaders: ['postcss-loader'],
  };
  config.mode = isProd ? 'production' : 'development';
  if (!isProd) config.devtool = 'inline-source-map';
  config.output = {
    path: resolve(DIST),
    publicPath: '/',
    filename: '[name].js',
    ...config.output,
  };
  config.resolve = {
    // Tell webpack to look for peer dependencies in `node_modules`
    // when packages are linked from outside directories
    modules: [resolve('node_modules')],
    extensions: ['.js'],
    ...config.resolve,
  },
  config.module = {
    ...config.module,
  };
  config.module.rules = [
    ...config.module.rules || [],
    {
      test: /\.js$/,
      use: 'babel-loader',
      include: [resolve('src'), resolve('test')],
    },
    // CSS modules: src/**/*.module.css
    styleRule({
      ...defaultStyleOptions,
      ...style,
      modules: true,
    }, {
      test: /\.module\.css$/,
      exclude: [resolve('node_modules')],
    }),
    // normal CSS files: src/**/*.css
    styleRule({ ...defaultStyleOptions, ...style }, {
      exclude: [
        /\.module\.css$/,
        resolve('node_modules'),
      ],
    }),
    // library CSS files: node_modules/**/*.css
    styleRule(style, {
      include: [resolve('node_modules')],
    }),
  ];
  config.optimization = {
    ...config.optimization,
  };
  config.optimization.minimizer = [
    ...config.optimization.minimizer || [],
    isProd && new UglifyJsPlugin({
      cache: true,
      parallel: true,
      sourceMap: true // set to true if you want JS source maps
    }),
    isProd && new OptimizeCSSAssetsPlugin(),
  ].filter(Boolean);
  config.plugins = [
    ...config.plugins || [],
    isProd && new MiniCssExtractPlugin(),
  ].filter(Boolean);
};
