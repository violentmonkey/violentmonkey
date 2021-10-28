const { modifyWebpackConfig, shallowMerge, defaultOptions } = require('@gera2ld/plaid');
const { isProd } = require('@gera2ld/plaid/util');
const fs = require('fs');
const webpack = require('webpack');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const HTMLInlineCSSWebpackPlugin = isProd && require('html-inline-css-webpack-plugin').default;
const TerserPlugin = isProd && require('terser-webpack-plugin');
const deepmerge = isProd && require('deepmerge');
const { ListBackgroundScriptsPlugin } = require('./manifest-helper');
const projectConfig = require('./plaid.conf');
const mergedConfig = shallowMerge(defaultOptions, projectConfig);

const INIT_FUNC_NAME = 'VMInitInjection';
// Copied from gulpfile.js: strip alphabetic suffix
const VM_VER = require('../package.json').version.replace(/-[^.]*/, '');
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

const definitions = new webpack.DefinePlugin({
  ...pickEnvs([
    { key: 'DEBUG', def: false },
    { key: 'VM_VER', val: VM_VER },
    { key: 'SYNC_GOOGLE_CLIENT_ID' },
    { key: 'SYNC_GOOGLE_CLIENT_SECRET' },
    { key: 'SYNC_ONEDRIVE_CLIENT_ID' },
    { key: 'SYNC_ONEDRIVE_CLIENT_SECRET' },
  ]),
  'process.env.INIT_FUNC_NAME': JSON.stringify(INIT_FUNC_NAME),
});

// avoid running webpack bootstrap in a potentially hacked environment
// after documentElement was replaced which triggered reinjection of content scripts
const skipReinjectionHeader = `if (window['${INIT_FUNC_NAME}'] !== 1)`;
// {entryName: path}
const entryGlobals = {
  common: './src/common/safe-globals.js',
  injected: './src/injected/safe-injected-globals.js',
};

/**
 * Adds a watcher for files in entryGlobals to properly recompile the project on changes.
 */
const addWrapper = (config, name, callback) => {
  if (!callback) { callback = name; name = ''; }
  const globals = Object.entries(entryGlobals).filter(([key]) => name === key || !name);
  const dirs = globals.map(([key]) => key).join('|');
  config.module.rules.push({
    test: new RegExp(`/(${dirs})/index\\.js$`.replace(/\//g, /[/\\]/.source)),
    use: [{
      loader: './scripts/fake-dep-loader.js',
      options: {
        files: globals.map(([, path]) => path),
      },
    }],
  });
  const reader = () => (
    globals.map(([, path]) => (
      fs.readFileSync(path, { encoding: 'utf8' })
      .replace(/export\s+(?=const\s)/g, '')
    ))
  ).join('\n');
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
    config.plugins.push(new ListBackgroundScriptsPlugin());
  }),

  modify('injected', './src/injected', (config) => {
    addWrapper(config, getGlobals => ({
      header: () => `${skipReinjectionHeader} { ${getGlobals()}`,
      footer: '}',
    }));
  }),

  modify('injected-web', './src/injected/web', (config) => {
    config.output.libraryTarget = 'commonjs2';
    addWrapper(config, getGlobals => ({
      header: () => `${skipReinjectionHeader}
        window['${INIT_FUNC_NAME}'] = function () {
          var module = { exports: {} };
          ${getGlobals()}`,
      footer: `
          module = module.exports;
          return module.__esModule ? module.default : module;
        };0;`,
    }));
  }),
]);
