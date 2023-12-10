const HtmlWebpackPlugin = require('html-webpack-plugin');

class GroupAssetsPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('GroupAssetsPlugin', (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).alterAssetTagGroups.tapAsync(
        'GroupAssetsPlugin', (data, callback) => {
          this.groupAssets(data);
          // console.log('grouped', data);
          callback(null, data);
        }
      );
    });
  }

  groupAssets(data) {
    const { injectTo } = data.plugin.options;
    if (typeof injectTo === 'function') {
      const groups = { head: [], body: [] };
      [
        ['head', data.headTags],
        ['body', data.bodyTags],
      ].forEach(([defaultGroup, items]) => {
        items.forEach(item => {
          const groupName = injectTo(item, defaultGroup);
          const group = groups[groupName] || groups[defaultGroup];
          group.push(item);
        });
      });
      data.headTags = groups.head;
      data.bodyTags = groups.body;
    }
  }
}

module.exports = GroupAssetsPlugin;
