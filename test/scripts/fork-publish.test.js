const { publishRelease } = require('../../scripts/fork-publish');
const { assetNames } = require('../../scripts/fork-release');

let repos;
const notFound = () => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 }));
const assets = assetNames.map(name => ({ name, data: Buffer.from('extension') }));

beforeEach(() => {
  repos = {
    getReleaseByTag: jest.fn(notFound),
    getLatestRelease: jest.fn(notFound),
    createRelease: jest.fn(async () => ({ data: { id: 42, assets: [] } })),
    uploadReleaseAsset: jest.fn(async () => ({})),
    deleteReleaseAsset: jest.fn(async () => ({})),
    updateRelease: jest.fn(async () => ({ data: { html_url: 'https://github.com/release' } })),
  };
});

function publish() {
  return publishRelease({ repos, version: '3.0.0.2', sha: 'abc123', assets });
}

test('makes all downloads available before exposing a latest release', async () => {
  await publish();
  expect(repos.createRelease).toHaveBeenCalledWith(expect.objectContaining({
    tag_name: 'astrophage-v3.0.0.2', target_commitish: 'abc123', draft: true,
  }));
  expect(repos.uploadReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({
    release_id: 42, name: assets[0].name, data: assets[0].data,
  }));
  expect(repos.updateRelease).toHaveBeenCalledWith(expect.objectContaining({
    release_id: 42, draft: false, prerelease: false, make_latest: 'true',
  }));
  expect(repos.updateRelease.mock.invocationCallOrder[0]).toBeGreaterThan(repos.uploadReleaseAsset.mock.invocationCallOrder[0]);
});

test('a failed upload leaves the release hidden', async () => {
  repos.uploadReleaseAsset.mockRejectedValue(new Error('upload failed'));
  await expect(publish()).rejects.toThrow('upload failed');
  expect(repos.updateRelease).not.toHaveBeenCalled();
});

test('an older run cannot replace the current release', async () => {
  repos.getLatestRelease.mockResolvedValue({ data: { tag_name: 'astrophage-v3.0.0.10' } });
  await expect(publish()).rejects.toThrow('Refusing to replace');
  expect(repos.createRelease).not.toHaveBeenCalled();
  expect(repos.uploadReleaseAsset).not.toHaveBeenCalled();
});

test('rerunning a published version leaves downloads and latest unchanged', async () => {
  repos.getReleaseByTag.mockResolvedValue({ data: { id: 42, draft: false } });
  await publish();
  expect(repos.uploadReleaseAsset).not.toHaveBeenCalled();
  expect(repos.updateRelease).not.toHaveBeenCalled();
});

test('an interrupted draft can be completed with replacement assets', async () => {
  repos.getReleaseByTag.mockResolvedValue({
    data: { id: 42, draft: true, assets: [{ id: 19, name: assets[0].name }] },
  });
  await publish();
  expect(repos.createRelease).not.toHaveBeenCalled();
  expect(repos.deleteReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 19 }));
  expect(repos.updateRelease).toHaveBeenCalled();
});

test('authentication failures are not treated as an empty release list', async () => {
  repos.getLatestRelease.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  await expect(publish()).rejects.toThrow('Forbidden');
  expect(repos.createRelease).not.toHaveBeenCalled();
});

test('an incomplete download set is never published', async () => {
  await expect(publishRelease({ repos, version: '3.0.0.2', sha: 'abc', assets: assets.slice(1) }))
  .rejects.toThrow('Incomplete release assets');
  expect(repos.createRelease).not.toHaveBeenCalled();
});

test('update feeds have the media types expected by browser updaters', async () => {
  await publish();
  for (const [name, type] of [['updates-crx.xml', 'application/xml'], ['updates.json', 'application/json']]) {
    expect(repos.uploadReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({
      name, headers: { 'content-type': type },
    }));
  }
});
