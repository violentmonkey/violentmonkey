const { isProd } = require('@gera2ld/plaid/util');

/**
 * For each entry, `key` is the chunk name, `value` has following properties:
 * - value.entry: webpack entry.
 * - value.html: options object passed to HtmlWebpackPlugin.
 * - value.html.inlineSource: if true, JS and CSS files will be inlined in HTML.
 */
const htmlFactory = extra => options => ({
  ...options,
  title: 'Violentmonkey',
  ...extra,
  chunks: ['browser', ...options.chunks],
});
exports.pages = {
  'browser': {
    entry: './src/common/browser',
  },
  'background/index': {
    entry: './src/background',
    html: htmlFactory(),
  },
  'options/index': {
    entry: './src/options',
    html: htmlFactory({
      js: [
        '/public/lib/zip.js/zip.js',
      ],
    }),
  },
  'confirm/index': {
    entry: './src/confirm',
    html: htmlFactory(),
  },
  'popup/index': {
    entry: './src/popup',
    html: htmlFactory(),
  },
  injected: {
    entry: './src/injected',
  },
};

exports.devServer = false;
exports.devtool = isProd ? false : 'inline-source-map';
exports.optimization = {
  runtimeChunk: false,
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
};
