import { signAddon } from 'amo-upload';
import { mkdir, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { buildUpdatesList, readManifest } from './manifest-helper.js';
import { hasAsset, notifyReleaseStatus } from './release-helper.mjs';
import { getVersion, isBeta } from './version-helper.js';

const version = getVersion();
const beta = isBeta();

async function handleAddon() {
  const manifest = await readManifest();
  const fileName = `violentmonkey-${version}${beta ? 'b' : ''}.xpi`;
  const url = `https://github.com/violentmonkey/violentmonkey/releases/download/v${version}/${fileName}`;

  if (await hasAsset(fileName)) {
    // Throw an error so `updates.json` won't be updated in the next step.
    throw new Error('File already downloaded, skipping');
  }

  const tempFile = join(
    process.env.TEMP_DIR,
    Math.random().toString(36).slice(2, 8).toString(),
  );
  const releaseUrl = `https://github.com/violentmonkey/violentmonkey/releases/tag/v${version}`;
  await signAddon({
    apiKey: process.env.AMO_KEY,
    apiSecret: process.env.AMO_SECRET,
    addonId: manifest.browser_specific_settings.gecko.id,
    addonVersion: version,
    channel: beta ? 'unlisted' : 'listed',
    compatibility: {
      android: { min: '121.0a1' },
      firefox: { min: '57.0' },
    },
    ...(process.env.AMO_PUBLISH
      ? {
          distFile: beta
            ? join(process.env.TEMP_DIR, process.env.ASSET_SELF_HOSTED_ZIP)
            : join(process.env.ASSETS_DIR, process.env.ASSET_ZIP),
          sourceFile: join(process.env.TEMP_DIR, process.env.SOURCE_ZIP),
          approvalNotes: `\
yarn && yarn build
`,
          releaseNotes: {
            'en-US': `\
Please follow the link below to view the change log:

${releaseUrl}
`,
          },
        }
      : {}),
    output: tempFile,

    // Don't poll since the review process takes quite a long time
    pollRetry: 0,
  });

  const xpiFile = join(process.env.ASSETS_DIR, fileName);
  await mkdir(process.env.ASSETS_DIR, { recursive: true });
  await rename(tempFile, xpiFile);

  const updates = await buildUpdatesList(version, url);
  await writeFile(
    join(process.env.TEMP_DIR, 'updates/updates.json'),
    JSON.stringify(updates, null, 2),
    'utf8',
  );
}

async function main() {
  let error;
  try {
    await handleAddon();
  } catch (err) {
    if (err?.message === 'Polling skipped') {
      error = beta ? new Error('Pending review') : undefined;
    } else {
      error = err;
    }
  }
  if (error) throw error;
}

main().then(
  () => {
    notifyReleaseStatus({
      title: `AMO Release Success: ${process.env.RELEASE_NAME}`,
      description: `See the changelog at https://github.com/violentmonkey/violentmonkey/releases/tag/v${process.env.VERSION}.`,
    });
  },
  (err) => {
    // if (err instanceof FatalError) {
    notifyReleaseStatus({
      title: `AMO Release Failure: ${process.env.RELEASE_NAME}`,
      description: [
        'An error occurred:',
        '',
        `> ${err}`,
        ...(process.env.ACTION_BUILD_URL
          ? ['', `See ${process.env.ACTION_BUILD_URL} for more details.`]
          : []),
      ].join('\n'),
      success: false,
    });
    // }
    console.error(err);
    process.exitCode = 1;
  },
);
