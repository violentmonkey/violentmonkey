export function mergeCookieHeaders(current = '', extra = '') {
  const added = new Map();
  for (const part of extra.split(';')) {
    const pos = part.indexOf('=');
    if (pos > 0) added.set(part.slice(0, pos).trim(), part.trim());
  }
  const kept = current.split(';').map(part => part.trim()).filter(part => {
    const pos = part.indexOf('=');
    return pos > 0 && !added.has(part.slice(0, pos).trim());
  });
  return kept.concat([...added.values()]).join('; ');
}
