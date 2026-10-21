import {
  addLogs, clear, dropTab, getLogs, getScripts, LOG_ENTRIES_MAX, LOG_ENTRY_MAX, LOG_LIMIT_MAX,
  markFailed, markRun, recordScripts, reserveLoad, setActive, startLoad,
} from '@/background/utils/mcp-observe';
import { __CODE } from '@/common/consts';

const TAB = 1;

beforeEach(clear);

function buildInjectedScript(id, props) {
  return {
    id,
    meta: { name: `script ${id}`, version: '1.0' },
    [RUN_AT]: 'start',
    [__CODE]: [`// script ${id}\n`, 'alert(1)'],
    code: '',
    ...props,
  };
}

describe('loads', () => {
  test('assigns a new id and drops the previous document', () => {
    const first = startLoad(TAB, 'https://a.example/');
    recordScripts(TAB, 0, [buildInjectedScript(1)]);
    markRun(TAB, 0, [1]);
    addLogs(TAB, [{ scriptId: 1, text: 'hello' }]);
    const second = startLoad(TAB, 'https://b.example/');
    expect(second).not.toBe(first);
    expect(getScripts(TAB)).toEqual({
      loadId: second,
      url: 'https://b.example/',
      scripts: [],
    });
    expect(getLogs(TAB).entries).toEqual([]);
  });

  test('uses the id reserved for a reload', () => {
    startLoad(TAB);
    const reserved = reserveLoad(TAB);
    expect(reserveLoad(TAB)).toBe(reserved); // the same reload, not a new one
    expect(getScripts(TAB).loadId).not.toBe(reserved);
    expect(startLoad(TAB)).toBe(reserved);
  });

  test('ignores a reservation that is too old to belong to the new load', () => {
    startLoad(TAB);
    const reserved = reserveLoad(TAB);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 60e3);
    try {
      expect(startLoad(TAB)).not.toBe(reserved);
    } finally {
      Date.now.mockRestore();
    }
  });
});

describe('scripts', () => {
  test('reports pending, then injected', () => {
    startLoad(TAB);
    recordScripts(TAB, 0, [buildInjectedScript(1)]);
    expect(getScripts(TAB).scripts).toEqual([{
      id: 1,
      frameId: 0,
      name: 'script 1',
      version: '1.0',
      runAt: 'start',
      status: 'pending',
    }]);
    markRun(TAB, 0, [1]);
    expect(getScripts(TAB).scripts[0].status).toBe('injected');
  });

  test('reports a script that cannot run in the page realm as failed', () => {
    startLoad(TAB);
    recordScripts(TAB, 0, [buildInjectedScript(1, { code: ID_BAD_REALM })]);
    const [script] = getScripts(TAB).scripts;
    expect(script.status).toBe('failed');
    expect(script.error).toMatch(/page realm/i);
  });

  test('records a script that ran without a previous record', () => {
    startLoad(TAB);
    markRun(TAB, 3, [7]);
    expect(getScripts(TAB).scripts).toEqual([
      { id: 7, frameId: 3, name: '', runAt: '', status: 'injected' },
    ]);
  });

  test('keeps frames apart and resets a frame on a new document', () => {
    startLoad(TAB);
    recordScripts(TAB, 0, [buildInjectedScript(1), buildInjectedScript(2)]);
    recordScripts(TAB, 5, [buildInjectedScript(1)]);
    expect(getScripts(TAB).scripts.map(s => `${s.frameId}:${s.id}`))
    .toEqual(['0:1', '0:2', '5:1']);
    recordScripts(TAB, 5, [buildInjectedScript(2)], { reset: true });
    expect(getScripts(TAB).scripts.map(s => `${s.frameId}:${s.id}`))
    .toEqual(['0:1', '0:2', '5:2']);
  });

  test('marks a script as failed later on', () => {
    startLoad(TAB);
    recordScripts(TAB, 0, [buildInjectedScript(1)]);
    markFailed(TAB, 0, 1, 'executeScript failed');
    expect(getScripts(TAB).scripts[0]).toMatchObject({
      status: 'failed',
      error: 'executeScript failed',
    });
  });

  test('hashes the source only while an agent is watching', () => {
    startLoad(TAB);
    recordScripts(TAB, 0, [buildInjectedScript(1)]);
    expect(getScripts(TAB).scripts[0].codeHash).toBeUndefined();
    setActive(true);
    recordScripts(TAB, 0, [buildInjectedScript(1)], { reset: true });
    const { codeHash } = getScripts(TAB).scripts[0];
    expect(codeHash).toMatch(/^[\da-f]{8}$/);
    recordScripts(TAB, 0, [buildInjectedScript(1, { [__CODE]: ['changed'] })], { reset: true });
    expect(getScripts(TAB).scripts[0].codeHash).not.toBe(codeHash);
  });
});

describe('logs', () => {
  test('assigns a monotonic seq and pages by cursor', () => {
    startLoad(TAB);
    addLogs(TAB, [
      { scriptId: 1, text: 'a' },
      { scriptId: 1, text: 'b' },
      { scriptId: 2, text: 'c' },
    ]);
    const page = getLogs(TAB, { limit: 2 });
    expect(page.entries.map(e => e.text)).toEqual(['a', 'b']);
    expect(page.nextSeq).toBe(page.entries[1].seq);
    const rest = getLogs(TAB, { afterSeq: page.nextSeq });
    expect(rest.entries.map(e => e.text)).toEqual(['c']);
    expect(rest.nextSeq).toBe(rest.entries[0].seq);
  });

  test('filters by script', () => {
    startLoad(TAB);
    addLogs(TAB, [
      { scriptId: 1, text: 'a' },
      { scriptId: 2, text: 'b' },
    ]);
    expect(getLogs(TAB, { scriptId: 2 }).entries.map(e => e.text)).toEqual(['b']);
  });

  test('collapses identical consecutive lines', () => {
    startLoad(TAB);
    addLogs(TAB, [
      { scriptId: 1, text: 'again' },
      { scriptId: 1, text: 'again' },
      { scriptId: 1, text: 'other' },
      { scriptId: 1, text: 'again' },
    ]);
    expect(getLogs(TAB).entries.map(e => [e.text, e.count]))
    .toEqual([['again', 2], ['other', undefined], ['again', undefined]]);
  });

  test('truncates oversized entries', () => {
    startLoad(TAB);
    addLogs(TAB, [{ scriptId: 1, text: 'x'.repeat(LOG_ENTRY_MAX + 10) }]);
    const [entry] = getLogs(TAB).entries;
    expect(entry.text).toHaveLength(LOG_ENTRY_MAX);
    expect(entry.truncated).toBe(true);
  });

  test('drops the oldest entries and reports how many', () => {
    startLoad(TAB);
    for (let i = 0; i < LOG_ENTRIES_MAX + 5; i += 1) {
      addLogs(TAB, [{ scriptId: 1, text: `line ${i}` }]);
    }
    const page = getLogs(TAB, { limit: LOG_LIMIT_MAX });
    expect(page.dropped).toBe(5);
    expect(page.entries).toHaveLength(LOG_LIMIT_MAX);
    expect(page.entries[0].text).toBe('line 5');
    // the counter is a delta since the last call
    expect(getLogs(TAB).dropped).toBe(0);
  });

  test('counts entries dropped before they reached the buffer', () => {
    startLoad(TAB);
    addLogs(TAB, [{ scriptId: 1, text: 'a' }], 3);
    expect(getLogs(TAB).dropped).toBe(3);
  });

  test('returns nothing for a document that is gone', () => {
    startLoad(TAB);
    const oldLoad = getScripts(TAB).loadId;
    addLogs(TAB, [{ scriptId: 1, text: 'a' }]);
    startLoad(TAB);
    addLogs(TAB, [{ scriptId: 1, text: 'b' }]);
    const res = getLogs(TAB, { sinceLoadId: oldLoad });
    expect(res.entries).toEqual([]);
    expect(res.nextSeq).toBe(getLogs(TAB).entries[0].seq);
    expect(getLogs(TAB, { sinceLoadId: getScripts(TAB).loadId }).entries)
    .toHaveLength(1);
  });
});

test('dropTab forgets the tab', () => {
  startLoad(TAB);
  addLogs(TAB, [{ scriptId: 1, text: 'a' }]);
  dropTab(TAB);
  expect(getLogs(TAB).entries).toEqual([]);
  expect(getScripts(TAB).scripts).toEqual([]);
});
