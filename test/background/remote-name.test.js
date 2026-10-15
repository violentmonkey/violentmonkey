import {
  getItemFilename,
  getItemFilenameV2,
  getItemFilenameV3,
  getURI,
} from '@/background/sync/remote-name';

const vm3 = (name, uri = 'ns-0aName-0a') => getItemFilenameV3(name, uri);

describe('getItemFilename', () => {
  test('picks the writer FILE_FORMAT names', () => {
    expect(getItemFilename('My Script', 'uri')).toBe(getItemFilenameV2('uri'));
  });
});

describe('getItemFilenameV2', () => {
  test('round-trips the uri through getURI', () => {
    expect(getURI(getItemFilenameV2('ns-0aName-0a'))).toBe('ns-0aName-0a');
  });
});

describe('getItemFilenameV3', () => {
  test('is unique, path-safe, and stable', () => {
    const names = ['My Script', '测试脚本', '사용자 스크립트',
      'a/b:c*d?e"f<g>h|i', 'x'.repeat(300)].map((n, i) => vm3(n, `uri-${i}`));
    expect(new Set(names).size).toBe(names.length);
    names.forEach((name) => {
      expect(name).not.toMatch(/[/\\:*?"<>|]/);
      // eslint-disable-next-line no-control-regex
      expect(name).not.toMatch(/[\0-\x1f]/);
      expect(name.length).toBeLessThan(64);
    });
    expect(vm3('My Script')).toBe(vm3('My Script'));
  });

  test('the uri keeps two identically-named scripts apart', () => {
    expect(vm3('My Script', 'uri-a')).not.toBe(vm3('My Script', 'uri-b'));
  });

  test('slugs the name', () => {
    expect(vm3('My Script')).toBe(vm3('My Script'));
    expect(vm3('My Script')).toMatch(/^vm3-My-Script-[0-9a-f]{8}\.txt$/);
    expect(vm3('测试脚本')).toMatch(/^vm3-测试脚本-[0-9a-f]{8}\.txt$/);
    expect(vm3('사용자 스크립트')).toMatch(/^vm3-사용자-스크립트-[0-9a-f]{8}\.txt$/);
    expect(vm3('Ｈａｌｆｗｉｄｔｈ')).toMatch(/^vm3-Ｈａｌｆｗｉｄｔｈ-/);
    expect(vm3('  spaced  out  ')).toMatch(/^vm3-spaced-out-/);
    expect(vm3('foo--bar')).toMatch(/^vm3-foo--bar-/);
    expect(vm3('a/b:c*d?e"f<g>h|i')).toMatch(/^vm3-a-b-c-d-e-f-g-h-i-/);
  });

  test('drops zero-width and bidi-override characters', () => {
    expect(vm3('A‍B')).toMatch(/^vm3-A-B-/);
    expect(vm3('a‮b')).toMatch(/^vm3-a-b-/);
  });

  test('handles a name with nothing sluggable', () => {
    expect(vm3('Привет')).toMatch(/^vm3--[0-9a-f]{8}\.txt$/);
  });

  test('truncates a long name', () => {
    expect(vm3('x'.repeat(300))).toMatch(new RegExp(`^vm3-${'x'.repeat(40)}-`));
  });
});

describe('getURI', () => {
  test('decodes a v2 name', () => {
    expect(getURI('vm@2-ns-0aName-0a')).toBe('ns-0aName-0a');
  });

  test('returns nothing for names that carry no uri', () => {
    expect(getURI('vm3-My-Script-1a2b3c4d.txt')).toBe('');
    expect(getURI('vm-old-file')).toBe('');
  });
});
