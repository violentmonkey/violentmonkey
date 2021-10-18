const { isProd } = require('@gera2ld/plaid/util');
const OptimizeCssAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const TerserPlugin = isProd && require('terser-webpack-plugin');

/**
 * For each entry, `key` is the chunk name, `value` has following properties:
 * - value.entry: webpack entry.
 * - value.html: options object passed to HtmlWebpackPlugin.
 * - value.html.inlineSource: if true, JS and CSS files will be inlined in HTML.
 */
exports.pages = [
  'background',
  'confirm',
  'options',
  'popup',
].reduce((res, name) => Object.assign(res, {
  [`${name}/index`]: {
    entry: `./src/${name}`,
    html: options => ({
      ...options,
      title: 'Violentmonkey',
      injectTo: item => ((item.attributes.src || '').endsWith('/index.js') ? 'body' : 'head'),
    }),
  },
}), {});

const minimizerOptions = {
  cache: true,
  parallel: true,
  sourceMap: true,
  terserOptions: {
    output: {
      ascii_only: true,
    },
  },
};

const splitVendor = prefix => ({
  [prefix]: {
    test: new RegExp(`node_modules[/\\\\]${prefix}`),
    name: `public/lib/${prefix}`,
    chunks: 'all',
    priority: 100,
  },
});

exports.devServer = false;
exports.devtool = isProd ? false : 'inline-source-map';
exports.optimization = {
  runtimeChunk: false,
  splitChunks: {
    cacheGroups: {
      'common-ui': {
        name: 'common-ui',
        test: new RegExp([
          /\bsvg/,
          /src\/common\/(ui|keyboard|load-script-icon)/,
          'node_modules/@violentmonkey/shortcut',
          'node_modules/vue',
        ].map(re => re.source || re).join('|').replace(/\\?\//g, '[/\\\\]')),
        chunks: 'all',
        minChunks: 2,
        priority: 100,
      },
      common: {
        name: 'common',
        minChunks: 2,
        enforce: true,
        chunks: 'all',
      },
      ...splitVendor('codemirror'),
      ...splitVendor('tldjs'),
    },
  },
  minimizer: isProd && [
    /* Combining @media (prefers-color-scheme: dark) into one query.
     * WARNING! html-inline-css-webpack-plugin doesn't detect CSS from mini-css-extract-plugin
     * in `watch` build so it's only enabled in prod. If we see a difference between the two,
     * we should remove this plugin or fix the above-mentioned problem. */
    new OptimizeCssAssetsPlugin({
      cssProcessor: require('postcss')([
        require('postcss-combine-media-query'),
        require('cssnano'),
      ]),
    }),
    // Minifying Violentmonkey code
    new TerserPlugin({
      chunkFilter: ({ name }) => !name.startsWith('public/'),
      ...minimizerOptions,
      terserOptions: {
        ...minimizerOptions.terserOptions,
        compress: {
          ecma: 6,
          // 'safe' since we don't rely on function prototypes
          unsafe_arrows: true,
        },
      },
    }),
    // Minifying non-Violentmonkey code
    new TerserPlugin({
      chunkFilter: ({ name }) => name.startsWith('public/'),
      ...minimizerOptions,
    }),
  ],
};
