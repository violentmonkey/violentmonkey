const fs = require('fs').promises;
const yaml = require('js-yaml');
const { getVersion, isBeta } = require('./version-helper');

async function readManifest() {
  const input = await fs.readFile('src/manifest.yml', 'utf8');
  const data = yaml.load(input);
  return data;
}

async function buildManifest(base) {
  const data = base ? { ...base } : await readManifest();
  data.version = getVersion();
  if (process.env.TARGET === 'selfHosted') {
    data.browser_specific_settings.gecko.update_url = 'https://raw.githubusercontent.com/rburgessCEStrategy/Injector/updates/updates.json';
  }
  if (isBeta()) {
    // Do not support i18n in beta version
    const name = 'Feature Injector BETA';
    data.name = name;
    data.action.default_title = name;
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
      const manifest = await buildManifest();
      
      // Get the compiled background script file from webpack
      const bgId = 'background/index';
      const bgEntry = compilation.entrypoints.get(bgId);
      
      if (bgEntry) {
        // Get the compiled background script files
        const bgScripts = bgEntry.chunks.flatMap(c => [...c.files]);
        if (bgScripts.length > 0) {
          // Firefox v109+ uses background.scripts array (Manifest V3)
          // Chrome uses background.service_worker
          // Set both for compatibility - each browser will use the appropriate one
          if (!manifest.background) manifest.background = {};
          manifest.background.scripts = bgScripts;
          manifest.background.service_worker = bgScripts[0];
        }
      }
      
      await fs.writeFile(path,
        JSON.stringify(manifest, null, this.minify ? 0 : 2),
        { encoding: 'utf8' });
    });
  }
}

exports.readManifest = readManifest;
exports.buildManifest = buildManifest;
exports.buildUpdatesList = buildUpdatesList;
exports.ListBackgroundScriptsPlugin = ListBackgroundScriptsPlugin;
