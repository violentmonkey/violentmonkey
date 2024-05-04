import { createSearchRules } from '@/options/utils/search';

test('createSearchRules', () => {
  expect(createSearchRules('')).toMatchSnapshot();
  expect(createSearchRules('#a #b !#c hello "CaseSensitive" CaseInsensitive')).toMatchSnapshot();
  expect(createSearchRules('#a-b #b name:hello world')).toMatchSnapshot();
  expect(createSearchRules('#a.b #b name:"hello world"')).toMatchSnapshot();
  expect(createSearchRules('#a.b #b name+re:"hello world"')).toMatchSnapshot();
  expect(createSearchRules('#a.b #b !name+re:"hello world"')).toMatchSnapshot();
  expect(createSearchRules('"#a.b" !"#b"')).toMatchSnapshot();
  expect(createSearchRules(String.raw`/\d+\D+/ code:/\d+\D+/u /not regexp/`)).toMatchSnapshot();
  expect(createSearchRules('foobar re:foobar name+re:foobar code+re:foobar')).toMatchSnapshot();
});
