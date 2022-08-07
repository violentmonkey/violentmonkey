const { combineConfigSync } = require('@gera2ld/plaid');
const base = require('@gera2ld/plaid/postcss/base');

module.exports = combineConfigSync({}, [base, (cfg) => {
  cfg.parser = 'postcss-scss';
  cfg.plugins.unshift('postcss-simple-vars');
  return cfg;
}]);
