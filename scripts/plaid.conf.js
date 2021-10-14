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
  'confirm',
  'options',
  'popup',
].reduce((res, name) => Object.assign(res, {
  [`${name}/index`]: {
    entry: `./src/${name}`,
    html: options => ({
      ...options,
      title: 'Violentmonkey',
      injectTo: item => (item.attributes.src || '').endsWith('/index.js') ? 'body' : 'head',
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
    // apply `postcss-combine-media-query`
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
exports.styleOptions = {
  extract: true, // Will be embedded as <style> to ensure uiTheme option doesn't cause FOUC
};
