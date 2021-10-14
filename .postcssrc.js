const cfg = require('@gera2ld/plaid/postcss/precss')({});
cfg.plugins[1] = require('precss')({
  features: { 'prefers-color-scheme-query': false },
});
module.exports = cfg;
