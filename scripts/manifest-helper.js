const fs = require('fs').promises;
const yaml = require('js-yaml');
const { getVersion, isBeta } = require('./version-helper');

async function readManifest() {
  const input = await fs.readFile('src/manifest.yml', 'utf8');
  const data = yaml.safeLoad(input);
  return data;
}

async function buildManifest() {
  const data = await readManifest();
  data.version = getVersion();
  if (process.env.TARGET === 'selfHosted') {
    data.browser_specific_settings.gecko.update_url = 'https://raw.githubusercontent.com/violentmonkey/violentmonkey/updates/updates.json';
  }
  if (isBeta()) {
    // Do not support i18n in beta version
    const name = 'Violentmonkey BETA';
    data.name = name;
    data.browser_action.default_title = name;
  }
  return data;
}

async function buildUpdatesList(version, url) {
  const manifest = await readManifest();
  const data = {
    addons: {
      [manifest.browser_specific_settings.gecko.id]: {
        updates: [
          {
            version,
            update_link: url,
          },
        ],
      },
    },
  };
  return data;
}

class ListBackgroundScriptsPlugin {
  constructor({ minify } = {}) {
    this.minify = minify;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tap(this.constructor.name, async compilation => {
      const dist = compilation.outputOptions.path;
      const path = `${dist}/manifest.json`;
      const manifest = JSON.parse(await fs.readFile(path, { encoding: 'utf8' }));
      const bgId = 'background/index';
      const bgEntry = compilation.entrypoints.get(bgId);
      const scripts = bgEntry.chunks.map(c => c.files[0]);
      if (`${manifest.background.scripts}` !== `${scripts}`) {
        manifest.background.scripts = scripts;
        await fs.writeFile(path,
          JSON.stringify(manifest, null, this.minify ? 0 : 2),
          { encoding: 'utf8' });
      }
      await fs.unlink(`${dist}/${bgId}.html`).catch(() => {});
    });
  }
}

exports.readManifest = readManifest;
exports.buildManifest = buildManifest;
exports.buildUpdatesList = buildUpdatesList;
exports.ListBackgroundScriptsPlugin = ListBackgroundScriptsPlugin;
