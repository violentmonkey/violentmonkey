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
      injectTo: item => (item.attributes.src || '').endsWith('/index.js') ? 'body' : 'head',
    }),
  },
}), {});

const splitVendor = prefix => ({
  [prefix]: {
    test: new RegExp(`node_modules[/\\\\]${prefix}.*?\\.js`),
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
      common: {
        name: 'common',
        minChunks: 2,
        enforce: true,
        chunks: 'all',
      },
      ...splitVendor('codemirror'),
      ...splitVendor('tldjs'),
      ...splitVendor('vue'),
    },
  },
};
