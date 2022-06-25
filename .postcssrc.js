const { readManifest } = require('./scripts/manifest-helper');
const cfg = require('@gera2ld/plaid/postcss/precss')({});

module.exports = async () => {
  const manifest = await readManifest();
  const minChrome = parseInt(manifest.minimum_chrome_version);
  const minFirefox = parseInt(manifest.browser_specific_settings.gecko.strict_min_version);
  if (minChrome < 76 || minFirefox < 67) {
    // Disabling `prefers-color-scheme` polyfill because we use our own one
    cfg.plugins.forEach((p, i) => {
      if ((p.postcss || {}).postcssPlugin === 'precss') {
        cfg.plugins[i] = require('precss')({
          features: { 'prefers-color-scheme-query': false },
        });
      }
    });
  }
  return cfg;
};
