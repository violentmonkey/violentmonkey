import { execSync } from 'child_process';
import { cp, mkdir, readFile, writeFile, rm, readdir } from 'fs/promises';
import { resolve, join, relative } from 'path';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';

const DIST_DIR = resolve('dist');
const ASSETS_DIR = resolve('dist-assets');
const target = (process.argv[2] || process.env.TARGET_BROWSER || 'chrome').toLowerCase();

if (!['chrome', 'opera'].includes(target)) {
  throw new Error(`Unsupported TARGET_BROWSER for local MV3 beta build: ${target}`);
}

const UNPACKED_DIR = resolve(`dist-builds/${target}-mv3`);

function run(cmd, env = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });
}

async function createZip(sourceDir, outputPath) {
  const zipWriter = new ZipWriter(new Uint8ArrayWriter());
  async function addDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const zipEntryPath = relative(sourceDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await addDir(fullPath);
      } else {
        const content = await readFile(fullPath);
        await zipWriter.add(zipEntryPath, new Uint8ArrayReader(content));
      }
    }
  }
  await addDir(sourceDir);
  const data = await zipWriter.close();
  await writeFile(outputPath, data);
  console.log(`> Created zip: ${outputPath}`);
}

function getVersion(pkg) {
  const core = pkg.version.match(/\d+\.\d+\.\d+/)?.[0];
  if (!core) {
    throw new Error(`Invalid package version: ${pkg.version}`);
  }
  const beta = Number.parseInt(pkg.beta, 10);
  return beta > 0 ? `${core}.${beta}` : core;
}

async function main() {
  const buildScript = `build:${target}-mv3`;
  const targetLabel = target === 'chrome' ? 'beta' : `beta-${target}`;
  // 1) Build MV3 runtime output and baseline export.
  run(`npm run ${buildScript}`);

  // 2) Apply beta manifest to dist before packaging.
  run('npx gulp manifest', {
    TARGET_BROWSER: target,
    TARGET_MANIFEST: 'mv3',
    BETA: '1',
  });

  // 3) Package zip artifact.
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const version = getVersion(pkg);
  const zipName = `Violentmonkey-beta-webext-${targetLabel}-v${version}.zip`;
  const zipPath = resolve('dist-assets', zipName);
  await mkdir(ASSETS_DIR, { recursive: true });
  await rm(zipPath, { force: true });
  await createZip(DIST_DIR, zipPath);

  // 4) Refresh loose unpacked files in a fixed folder for browser reload.
  await rm(UNPACKED_DIR, { recursive: true, force: true });
  await cp(DIST_DIR, UNPACKED_DIR, { recursive: true });

  console.log(`\nUnpacked (load this in browser): ${UNPACKED_DIR}`);
  console.log(`Zip package: ${zipPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
