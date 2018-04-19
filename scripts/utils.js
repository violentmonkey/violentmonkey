const ExtractTextPlugin = require('extract-text-webpack-plugin');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const INIT_FUNC_NAME = 'VMInitInjection';

function styleLoader({
  loaders = [],
  extract = isProd,
  minimize = isProd,
  fallback = 'style-loader',
} = {}) {
  const cssLoader = {
    loader: 'css-loader',
    options: {
      minimize,
      importLoaders: 1,
      sourceMap: false,
    },
  };
  return extract ? ExtractTextPlugin.extract({
    fallback,
    use: [cssLoader, ...loaders],
  }) : [
    fallback,
    cssLoader,
    ...loaders,
  ];
}

function styleRule(options = {}) {
  return {
    test: /\.css$/,
    use: styleLoader(options),
  };
}

function merge(obj1, obj2) {
  if (!obj2) return obj1;
  if (Array.isArray(obj1)) return obj1.concat(obj2);
  const obj = Object.assign({}, obj1);
  Object.keys(obj2).forEach(key => {
    if (typeof obj[key] === 'object') {
      obj[key] = merge(obj[key], obj2[key]);
    } else {
      obj[key] = obj2[key];
    }
  });
  return obj;
}

exports.isDev = isDev;
exports.isProd = isProd;
exports.isTest = isTest;
exports.styleLoader = styleLoader;
exports.styleRule = styleRule;
exports.merge = merge;
exports.INIT_FUNC_NAME = INIT_FUNC_NAME;
exports.definitions = {
  'process.env': {
    NODE_ENV: JSON.stringify(process.env.NODE_ENV),
    DEBUG: isDev ? 'true' : 'false', // whether to log message errors
    INIT_FUNC_NAME: JSON.stringify(INIT_FUNC_NAME),
  },
};
