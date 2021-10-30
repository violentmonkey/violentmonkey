const { modifyWebpackConfig, shallowMerge, defaultOptions } = require('@gera2ld/plaid');
const { isProd } = require('@gera2ld/plaid/util');
const fs = require('fs');
const webpack = require('webpack');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const HTMLInlineCSSWebpackPlugin = isProd && require('html-inline-css-webpack-plugin').default;
const TerserPlugin = isProd && require('terser-webpack-plugin');
const deepmerge = isProd && require('deepmerge');
const { ListBackgroundScriptsPlugin } = require('./manifest-helper');
const ProtectWebpackBootstrapPlugin = require('./webpack-protect-bootstrap-plugin');
const projectConfig = require('./plaid.conf');
const mergedConfig = shallowMerge(defaultOptions, projectConfig);

// Avoiding collisions with globals of a content-mode userscript
const INIT_FUNC_NAME = `Violentmonkey:${
  Buffer.from(
    new Uint32Array(2)
    .map(() => Math.random() * (2 ** 32))
    .buffer,
  ).toString('base64')
}`;
const VAULT_ID = '__VAULT_ID__';
// eslint-disable-next-line import/no-dynamic-require
const VM_VER = require(`${defaultOptions.distDir}/manifest.json`).version;
const WEBPACK_OPTS = {
  node: {
    global: false,
    process: false,
    setImmediate: false,
  },
  performance: {
    maxEntrypointSize: 1e6,
    maxAssetSize: 0.5e6,
  },
};
const MIN_OPTS = {
  cache: true,
  parallel: true,
  sourceMap: true,
  terserOptions: {
    compress: {
      // `terser` often inlines big one-time functions inside a small "hot" function
      reduce_funcs: false,
      reduce_vars: false,
    },
    output: {
      ascii_only: true,
    },
  },
};
const MIN_OPTS_PUBLIC = isProd && {
  chunkFilter: ({ name }) => name.startsWith('public/'),
  ...MIN_OPTS,
};
const MIN_OPTS_MAIN = isProd && deepmerge.all([{}, MIN_OPTS, {
  chunkFilter: ({ name }) => !name.startsWith('public/'),
  terserOptions: {
    compress: {
      ecma: 8, // ES2017 Object.entries and so on
      passes: 2, // necessary now since we removed plaid's minimizer
      unsafe_arrows: true, // it's 'safe' since we don't rely on function prototypes
    },
  },
}]);

const pickEnvs = (items) => {
  return Object.assign({}, ...items.map(x => ({
    [`process.env.${x.key}`]: JSON.stringify(
      'val' in x ? x.val
        : process.env[x.key] ?? x.def,
    ),
  })));
};

const defsObj = {
  ...pickEnvs([
    { key: 'DEBUG', def: false },
    { key: 'VM_VER', val: VM_VER },
    { key: 'SYNC_GOOGLE_CLIENT_ID' },
    { key: 'SYNC_GOOGLE_CLIENT_SECRET' },
    { key: 'SYNC_ONEDRIVE_CLIENT_ID' },
    { key: 'SYNC_ONEDRIVE_CLIENT_SECRET' },
  ]),
  'process.env.INIT_FUNC_NAME': JSON.stringify(INIT_FUNC_NAME),
  'process.env.VAULT_ID_NAME': JSON.stringify(VAULT_ID),
  'process.env.VAULT_ID': VAULT_ID,
};
const defsRe = new RegExp(`\\b(${Object.keys(defsObj).join('|').replace(/\./g, '\\.')})\\b`, 'g');
const definitions = new webpack.DefinePlugin(defsObj);

// avoid running webpack bootstrap in a potentially hacked environment
// after documentElement was replaced which triggered reinjection of content scripts
const skipReinjectionHeader = `if (window['${INIT_FUNC_NAME}'] !== 1)`;
// {entryName: path}
const entryGlobals = {
  common: [
    './src/common/safe-globals.js',
  ],
  'injected/content': [
    './src/injected/safe-globals-injected.js',
    './src/injected/content/safe-globals-content.js',
  ],
  'injected/web': [
    './src/injected/safe-globals-injected.js',
    './src/injected/web/safe-globals-web.js',
  ],
};

/**
 * Adds a watcher for files in entryGlobals to properly recompile the project on changes.
 */
const addWrapper = (config, name, callback) => {
  config.module.rules.push({
    test: new RegExp(`/${name}/.*?\\.js$`.replace(/\//g, /[/\\]/.source)),
    use: [{
      loader: './scripts/fake-dep-loader.js',
      options: { files: entryGlobals[name] },
    }],
  });
  const reader = () => (
    entryGlobals[name]
    .map(path => fs.readFileSync(path, { encoding: 'utf8' }))
    .join('\n')
    .replace(/export\s+(?=(const|let)\s)/g, '')
    .replace(defsRe, s => defsObj[s])
  );
  config.plugins.push(new WrapperWebpackPlugin(callback(reader)));
};

const modify = (page, entry, init) => modifyWebpackConfig(
  (config) => {
    Object.assign(config, WEBPACK_OPTS);
    config.plugins.push(definitions);
    config.optimization.minimizer.find((m, i, arr) => (
      m.constructor.name === 'TerserPlugin' && arr.splice(i, 1)
    ));
    config.optimization.minimizer.push(...!isProd ? [] : [
      new TerserPlugin(MIN_OPTS_PUBLIC),
      new TerserPlugin(MIN_OPTS_MAIN),
    ]);
    if (!entry) init = page;
    if (init) init(config);
    return config;
  }, {
    projectConfig: {
      ...mergedConfig,
      ...entry && { pages: { [page]: { entry } } },
    },
  },
);

module.exports = Promise.all([
  modify((config) => {
    addWrapper(config, 'common', getGlobals => ({
      header: () => `{ ${getGlobals()}`,
      footer: '}',
      test: /^(?!injected|public).*\.js$/,
    }));
    /* Embedding as <style> to ensure uiTheme option doesn't cause FOUC.
     * Note that in production build there's no <head> in html but document.head is still
     * auto-created per the specification so our styles will be placed correctly anyway. */
    if (isProd) {
      config.plugins.push(new HTMLInlineCSSWebpackPlugin({
        replace: {
          target: '<body>',
          position: 'before',
        },
      }));
      config.plugins.find(p => (
        p.constructor.name === 'MiniCssExtractPlugin'
        && Object.assign(p.options, { ignoreOrder: true })
      ));
    }
    config.plugins.push(new ListBackgroundScriptsPlugin({
      minify: false, // keeping readable
    }));
  }),

  modify('injected', './src/injected', (config) => {
    config.plugins.push(new ProtectWebpackBootstrapPlugin());
    addWrapper(config, 'injected/content', getGlobals => ({
      header: () => `${skipReinjectionHeader} { ${getGlobals()}`,
      footer: '}',
    }));
  }),

  modify('injected-web', './src/injected/web', (config) => {
    // TODO: replace WebPack's Object.*, .call(), .apply() with safe calls
    config.output.libraryTarget = 'commonjs2';
    config.plugins.push(new ProtectWebpackBootstrapPlugin());
    addWrapper(config, 'injected/web', getGlobals => ({
      header: () => `${skipReinjectionHeader}
        window['${INIT_FUNC_NAME}'] = function (${VAULT_ID}, IS_FIREFOX) {
          const module = { __proto__: null };
          ${getGlobals()}`,
      footer: `
          const { exports } = module;
          return exports.__esModule ? exports.default : exports;
        };0;`,
    }));
  }),
]);
