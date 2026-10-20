describe('background initialization', () => {
  let state;

  beforeEach(() => {
    jest.isolateModules(() => {
      state = require('@/background/utils/init');
    });
  });

  test('waits for dependencies before resolving', async () => {
    let complete;
    const dependency = new Promise(resolve => { complete = resolve; });
    state.initDependency(dependency);
    const ready = state.init;
    let settled = false;
    ready.then(() => { settled = true; });
    const finishing = state.resolveInit();
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await finishing;
    await ready;
    expect(state.init).toBeNull();
  });

  test.each(['rejected promise', 'throwing initializer'])('rejects waiting commands after a %s', async kind => {
    const failure = new Error('Initialization failed');
    let result;
    state.init.catch(error => { result = error; });
    state.initDependency(kind === 'rejected promise'
      ? Promise.reject(failure)
      : () => { throw failure; });
    await state.resolveInit().catch(() => {});
    expect(result).toBe(failure);
  });
});
