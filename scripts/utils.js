const ExtractTextPlugin = require('extract-text-webpack-plugin');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const IS_DEV = process.env.NODE_ENV === 'development';

function styleLoader({ loaders = [], extract = !IS_DEV, minimize = !IS_DEV, fallback = 'style-loader' } = {}) {
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

exports.IS_DEV = IS_DEV;
exports.styleLoader = styleLoader;
exports.styleRule = styleRule;
