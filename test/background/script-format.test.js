import {
  getScriptData,
  parseScriptData,
  serializeScriptData,
} from '@/background/sync/script-format';

const code = '// ==UserScript==\n// @name Test\n// ==/UserScript==\nconsole.log("hi {not json}");\n\nfunction f() {}\n';

const script = {
  custom: { foo: 'bar with "quotes" and {braces}' },
  config: { enabled: 1 },
  props: { lastUpdated: 123, id: 1, position: 2 },
};

describe('getScriptData', () => {
  test('builds a version-2 payload with the syncable properties', () => {
    expect(getScriptData(script, { code })).toEqual({
      version: 2,
      custom: script.custom,
      config: script.config,
      props: { lastUpdated: 123 },
      code,
    });
  });
});

describe('serializeScriptData', () => {
  const data = getScriptData(script, { code });

  test('old format: a single JSON object with code embedded', () => {
    const raw = serializeScriptData(data, false);
    expect(raw).toBe(JSON.stringify(data));
  });

  test('new format: JSON header, blank line, then raw code', () => {
    const raw = serializeScriptData(data, true);
    const i = raw.indexOf('\n\n');
    expect(i).toBeGreaterThan(-1);
    const header = JSON.parse(raw.slice(0, i));
    expect(header).toEqual({
      version: 2,
      custom: data.custom,
      config: data.config,
      props: data.props,
    });
    expect(raw.slice(i + 2)).toBe(code);
  });

});

describe('parseScriptData', () => {
  test('round-trips the old format', () => {
    const data = getScriptData(script, { code });
    const raw = serializeScriptData(data, false);
    const parsed = parseScriptData(raw);
    expect(parsed.code).toBe(code);
    expect(parsed.config).toEqual(data.config);
    expect(parsed.custom).toEqual(data.custom);
    expect(parsed.props).toEqual(data.props);
  });

  test('round-trips the new format', () => {
    const data = getScriptData(script, { code });
    const raw = serializeScriptData(data, true);
    const parsed = parseScriptData(raw);
    expect(parsed.code).toBe(code);
    expect(parsed.config).toEqual(data.config);
    expect(parsed.custom).toEqual(data.custom);
    expect(parsed.props).toEqual(data.props);
  });

  test('falls back to treating the whole content as raw code when not JSON', () => {
    const raw = 'not json at all';
    expect(parseScriptData(raw)).toEqual({ code: raw });
  });

  test('treats valid non-object JSON as raw code', () => {
    const raw = '["not metadata"]';
    expect(parseScriptData(raw)).toEqual({ code: raw });
  });

  test('treats a header containing a blank line as invalid and falls back to raw code', () => {
    const raw = '{\n"version": 2\n\n}\n\nsome code';
    expect(parseScriptData(raw)).toEqual({ code: raw });
  });

});
