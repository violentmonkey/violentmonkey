import { createSearchRules } from '@/options/utils/search';

test('createSearchRules', () => {
  expect(createSearchRules('')).toMatchSnapshot();
  expect(createSearchRules('#a #b !#c hello')).toMatchSnapshot();
  expect(createSearchRules('#a-b #b name:hello world')).toMatchSnapshot();
  expect(createSearchRules('#a.b #b name:"hello world"')).toMatchSnapshot();
  expect(createSearchRules('#a.b #b name+re:"hello world"')).toMatchSnapshot();
  expect(createSearchRules('#a.b #b !name+re:"hello world"')).toMatchSnapshot();
  expect(createSearchRules('"#a.b" !"#b"')).toMatchSnapshot();
  expect(createSearchRules('/regexp/ code:/regexp/u /not regexp/')).toMatchSnapshot();
  expect(createSearchRules('foobar re:foobar name+re:foobar code+re:foobar')).toMatchSnapshot();
});
