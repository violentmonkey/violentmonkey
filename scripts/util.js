const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const DIST = 'dist';
const INIT_FUNC_NAME = 'VMInitInjection';

function styleLoader(options) {
  const {
    loaders = [],
    extract = isProd,
    fallback = 'style-loader',
    modules = false,
  } = options || {};
  const cssLoader = {
    loader: 'css-loader',
    options: {
      modules,
      importLoaders: 1,
      sourceMap: false,
    },
  };
  return [
    extract ? MiniCssExtractPlugin.loader : fallback,
    cssLoader,
    ...loaders,
  ];
}

function styleRule(options, rule) {
  return {
    test: /\.css$/,
    use: styleLoader(options),
    ...rule,
  };
}

function resolve(dir) {
  return path.join(__dirname, '..', dir);
}

exports.DIST = DIST;
exports.INIT_FUNC_NAME = INIT_FUNC_NAME;
exports.isDev = isDev;
exports.isProd = isProd;
exports.isTest = isTest;
exports.styleLoader = styleLoader;
exports.styleRule = styleRule;
exports.resolve = resolve;
