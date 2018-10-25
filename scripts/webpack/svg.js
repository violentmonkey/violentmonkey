// const SpriteLoaderPlugin = require('svg-sprite-loader/plugin');
const { resolve, isProd } = require('../util');
// const extractSVG = isProd;

module.exports = () => config => {
  config.module = {
    ...config.module,
  };
  config.module.rules = [
    ...config.module.rules || [],
    {
      test: /\.svg$/,
      use: [{
        loader: 'svg-sprite-loader',
        options: {
          // extract: extractSVG,
        },
      }],
      include: [resolve('src/resources/svg')],
    },
  ];
  config.plugins = [
    ...config.plugins || [],
    // extractSVG && new SpriteLoaderPlugin(),
  ].filter(Boolean);
};
