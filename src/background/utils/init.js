export const extensionRoot = browser.runtime.getURL('/');

export const preInitialize = [];
export const postInitialize = [];

export async function initialize(main) {
  const run = init => (typeof init === 'function' ? init() : init);
  await Promise.all(preInitialize.map(run));
  await run(main);
  await Promise.all(postInitialize.map(run));
  preInitialize.length = 0;
  postInitialize.length = 0;
}
