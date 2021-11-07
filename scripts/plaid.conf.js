const { isProd } = require('@gera2ld/plaid/util');

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
};
exports.styleOptions = {
  /* Files in extensions aren't cached so there's no point in extracting separate css,
   * other than minifying, but the gain is negligible. P.S. Extracting+inlining back in html
   * doesn't keep the correct order of style elements which breaks appearance when
   * using style-ext-html-webpack-plugin or html-inline-css-webpack-plugin. */
  extract: false,
};
