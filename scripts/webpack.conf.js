const HtmlWebpackPlugin = require('html-webpack-plugin');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const base = require('./webpack.base.conf');
const { isProd, INIT_FUNC_NAME } = require('./util');
const MINIFY = isProd && {
  collapseWhitespace: true,
  removeAttributeQuotes: true,
  removeComments: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
};
const defaultTemplateOptions = {
  minify: MINIFY,
  template: 'scripts/template.html',
  meta: {
    viewport: 'width=device-width,initial-scale=1.0,user-scalable=no',
  },
  css: [],
  js: [],
};

const targets = module.exports = [];

const pages = {
  'browser': {
    entry: './src/common/browser',
  },
  'background/index': {
    entry: './src/background',
    html: {},
  },
  'options/index': {
    entry: './src/options',
    html: {
      js: [
        '/public/lib/zip.js/zip.js',
      ],
    },
  },
  'confirm/index': {
    entry: './src/confirm',
    html: {},
  },
  'popup/index': {
    entry: './src/popup',
    html: {},
  },
  injected: {
    entry: './src/injected',
  },
};
const entries = Object.entries(pages)
.reduce((res, [key, { entry }]) => Object.assign(res, { [key]: entry }), {});
const htmlPlugins = Object.entries(pages)
.map(([key, { html }]) => {
  let options;
  if (html) {
    options = {
      filename: `${key}.html`,
      chunks: ['browser', key],
      ...defaultTemplateOptions,
    };
    if (typeof html === 'function') {
      options = html(options);
    } else {
      options = {
        ...options,
        ...html,
      };
    }
  }
  if (options) {
    if (options.inlineSource) options.inject = false;
    return new HtmlWebpackPlugin(options);
  }
})
.filter(Boolean);

targets.push({
  ...base,
  entry: entries,
  optimization: {
    ...base.optimization,
    splitChunks: {
      cacheGroups: {
        common: {
          name: 'common',
          minChunks: 2,
          chunks(chunk) {
            return ![
              'browser',
              'injected',
            ].includes(chunk.name);
          },
        },
      },
    },
  },
  plugins: [
    ...base.plugins,
    ...htmlPlugins,
  ],
});

targets.push({
  ...base,
  entry: {
    'injected-web': './src/injected/web',
  },
  output: {
    ...base.output,
    libraryTarget: 'commonjs2',
  },
  plugins: [
    ...base.plugins,
    new WrapperWebpackPlugin({
      header: `\
window.${INIT_FUNC_NAME} = function () {
  var module = { exports: {} };
`,
      footer: `
  var exports = module.exports;
  return exports.__esModule ? exports['default'] : exports;
};0;`,
    }),
  ],
});
