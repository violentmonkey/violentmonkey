const { MV3 } = require('./common');

/** Injects only `index.js` into `body` to avoid FOUC. */
class GroupAssetsPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('GroupAssetsPlugin', (compilation) => {
      compiler.webpack.html.HtmlModulesPlugin.getCompilationHooks(compilation)
      .transformHtml.tap('GroupAssetsPlugin', (html, { outputName }) => {
        const name = outputName.split('/')[0];
        // strip redundant path to own folder
        html = html.replaceAll(`../${name}/`, '');
        // move index.js to <body>
        html = html.replace(/(<script src=[^>]*?index\.js.*<\/script>)(.*<\/head><body>)/, '$2$1');
        // get data from service worker before running any other script
        if (MV3) html = html.replace('<script', `<script src=/get-data.js?${name}></script>$&`);
        return html;
      });
    });
  }
}

module.exports = GroupAssetsPlugin;
