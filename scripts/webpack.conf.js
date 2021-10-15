const { modifyWebpackConfig, shallowMerge, defaultOptions } = require('@gera2ld/plaid');
const { isProd } = require('@gera2ld/plaid/util');
const fs = require('fs');
const webpack = require('webpack');
const WrapperWebpackPlugin = require('wrapper-webpack-plugin');
const HTMLInlineCSSWebpackPlugin = isProd && require('html-inline-css-webpack-plugin').default;
const projectConfig = require('./plaid.conf');
const mergedConfig = shallowMerge(defaultOptions, projectConfig);

const INIT_FUNC_NAME = 'VMInitInjection';
// Copied from gulpfile.js: strip alphabetic suffix
const VM_VER = require('../package.json').version.replace(/-[^.]*/, '');

const pickEnvs = (items) => {
  return Object.assign({}, ...items.map(x => ({
    [`process.env.${x.key}`]: JSON.stringify(
      'val' in x ? x.val
        : process.env[x.key] ?? x.def
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

const modify = (page, entry, init) => modifyWebpackConfig(
  (config) => {
    config.node = {
      process: false,
      setImmediate: false,
    };
    config.plugins.push(definitions);
    if (!entry) init = page;
    if (init) init(config);
    return config;
  }, {
    projectConfig: {
      ...mergedConfig,
      ...entry && { pages: { [page]: { entry }} },
    },
  },
);

// avoid running webpack bootstrap in a potentially hacked environment
// after documentElement was replaced which triggered reinjection of content scripts
const skipReinjectionHeader = `if (window['${INIT_FUNC_NAME}'] !== 1)`;
const [globalsCommonHeader, globalsInjectedHeader] = [
  './src/common/safe-globals.js',
  './src/injected/safe-injected-globals.js',
].map(path =>
  require('fs').readFileSync(path, {encoding: 'utf8'}).replace(/export const/g, 'const'));

module.exports = Promise.all([
  modify((config) => {
    config.output.publicPath = '/';
    config.plugins.push(new WrapperWebpackPlugin({
      header: `{ ${globalsCommonHeader}`,
      footer: `}`,
      test: /^(?!injected|public).*\.js$/,
    }));
    /* Embedding as <style> to ensure uiTheme option doesn't cause FOUC.
     * Note that in production build there's no <head> in html but document.head is still
     * auto-created per the specification so our styles will be placed correctly anyway. */
    if (isProd) config.plugins.push(new HTMLInlineCSSWebpackPlugin({
      replace: {
        target: '<body>',
        position: 'before',
      },
    }));
    config.plugins.push(new class ListBackgroundScripts {
      apply(compiler) {
        compiler.hooks.afterEmit.tap(this.constructor.name, compilation => {
          const dist = compilation.outputOptions.path;
          const path = `${dist}/manifest.json`;
          const manifest = JSON.parse(fs.readFileSync(path, {encoding: 'utf8'}));
          const bgId = 'background/index';
          const bgEntry = compilation.entrypoints.get(bgId);
          const scripts = bgEntry.chunks.map(c => c.files[0]);
          if (`${manifest.background.scripts}` !== `${scripts}`) {
            manifest.background.scripts = scripts;
            fs.writeFileSync(path,
              JSON.stringify(manifest, null, isProd ? 0 : 2),
              {encoding: 'utf8'});
          }
          try {
            fs.unlinkSync(`${dist}/${bgId}.html`);
          } catch (e) {}
        });
      }
    });
  }),
  modify('injected', './src/injected', (config) => {
    config.plugins.push(
      new WrapperWebpackPlugin({
        header: `${skipReinjectionHeader} { ${globalsCommonHeader};${globalsInjectedHeader}`,
        footer: `}`,
      }));
  }),
  modify('injected-web', './src/injected/web', (config) => {
    config.output.libraryTarget = 'commonjs2';
    config.plugins.push(
      new WrapperWebpackPlugin({
        header: `${skipReinjectionHeader}
          window['${INIT_FUNC_NAME}'] = function () {
            var module = { exports: {} };
            ${globalsCommonHeader}
            ${globalsInjectedHeader}
          `,
        footer: `
            var exports = module.exports;
            return exports.__esModule ? exports['default'] : exports;
          };0;`,
      }),
    );
  }),
]);
