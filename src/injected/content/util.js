export function inject(code, sourceUrl) {
  const script = document.createElement('script');
  // avoid string concatenation of |code| as it can be extremely long
  script.append(
    'document.currentScript.remove();',
    ...typeof code === 'string' ? [code] : code,
    ...sourceUrl ? ['\n//# sourceURL=', sourceUrl] : [],
  );
  document.documentElement.appendChild(script);
  script.remove();
}
