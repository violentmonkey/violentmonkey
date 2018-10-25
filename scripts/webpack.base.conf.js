const webpack = require('webpack');
const { resolve, INIT_FUNC_NAME } = require('./util');

const baseConfig = [
  require('./webpack/common')({
    style: {
      fallback: 'vue-style-loader',
    },
  }),
  require('./webpack/url')(),
  require('./webpack/raw')(),
  require('./webpack/svg')(),
  process.env.RUN_ENV === 'analyze' && require('./webpack/analyze')(),
  require('./webpack/vue')(),
]
.filter(Boolean)
.reduce(
  (config, apply) => (apply && apply(config) || config),
  {
    resolve: {
      alias: {
        '#': resolve('src'),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.INIT_FUNC_NAME': JSON.stringify(INIT_FUNC_NAME),
      }),
    ],
  },
);

module.exports = baseConfig;
