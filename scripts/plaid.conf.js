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
    html: name !== 'background' && (options => ({
      ...options,
      title: 'Violentmonkey',
      injectTo: item => ((item.attributes.src || '').endsWith('/index.js') ? 'body' : 'head'),
      scriptLoading: 'blocking', // we don't need `defer` and it breaks in some browsers, see #1632
    })),
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
          'src/common/(?!zip)',
          'node_modules/@violentmonkey/shortcut',
          'node_modules/@?vue',
        ].map(re => re.source || re).join('|').replace(/\\?\//g, '[/\\\\]')),
        chunks: c => ![
          'background/index', // only 4kB of common code
          'injected',
          'injected-web',
        ].includes(c.name),
      },
      ...splitVendor('codemirror'),
    },
  },
};
