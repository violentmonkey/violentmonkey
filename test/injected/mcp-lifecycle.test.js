import { restoreMcp } from '@/injected/content/mcp';
import { sendCmd } from '@/injected/content/util';

jest.mock('@/injected/content/mcp', () => ({ restoreMcp: jest.fn() }));
jest.mock('@/injected/content/bridge', () => ({ onScripts: [], addHandlers: jest.fn() }));
jest.mock('@/injected/content/gm-api-content', () => ({ sendSetPopup: jest.fn() }));
jest.mock('@/injected/content/util', () => ({ nextTask: jest.fn(), sendCmd: jest.fn() }));

test('only a trusted BFCache pageshow restores MCP, without triggering reinjection', () => {
  const originalOn = global.on;
  const listen = jest.fn();
  const persisted = jest.spyOn(PageTransitionEvent.prototype, 'persisted', 'get');
  global.on = listen;
  try {
    jest.isolateModules(() => { require('@/injected/content/cmd-run'); });
    const onShown = listen.mock.calls.find(([name]) => name === 'pageshow')[1];
    persisted.mockReturnValue(true);
    onShown.call(window, { isTrusted: false });
    expect(restoreMcp).not.toHaveBeenCalled();
    persisted.mockReturnValue(false);
    onShown.call(window, { isTrusted: true });
    expect(restoreMcp).not.toHaveBeenCalled();
    persisted.mockReturnValue(true);
    onShown.call(window, { isTrusted: true });
    expect(restoreMcp).toHaveBeenCalledTimes(1);
    expect(sendCmd).toHaveBeenCalledTimes(1);
    expect(sendCmd).toHaveBeenCalledWith('Run', expect.objectContaining({ reset: 'bfcache' }));
  } finally {
    global.on = originalOn;
    persisted.mockRestore();
  }
});
