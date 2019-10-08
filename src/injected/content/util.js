import { append, createElement } from '../utils/helpers';

const { remove } = Element.prototype;

export function inject(code, sourceUrl) {
  const script = document::createElement('script');
  // avoid string concatenation of |code| as it can be extremely long
  script::append(
    'document.currentScript.remove();',
    ...typeof code === 'string' ? [code] : code,
    ...sourceUrl ? ['\n//# sourceURL=', sourceUrl] : [],
  );
  document.documentElement::append(script);
  script::remove();
}
