import { memoize } from './util';

const loadZip = memoize(async () => {
  const zip = await import(/* webpackChunkName: 'zip' */ '@zip.js/zip.js/dist/zip');
  return zip;
});

export default loadZip;
