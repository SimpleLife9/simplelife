/**
 * Tie the Service Worker registration URL to the actual compiled app shell.
 * Vite hashes these entry assets on every build; a changed app bundle therefore
 * changes the worker script URL and makes the browser run the SW update lifecycle.
 */
export function getAppShellBuildIdentity(documentRef = globalThis.document) {
  if (!documentRef?.querySelector) return '';

  const scriptSource = documentRef
    .querySelector('script[type="module"][src]')
    ?.getAttribute('src') || '';
  const stylesheetSources = Array.from(
    documentRef.querySelectorAll?.('link[rel="stylesheet"][href]') || [],
  ).map((link) => link.getAttribute('href') || '');

  return [scriptSource, ...stylesheetSources]
    .filter((source) => typeof source === 'string' && source.startsWith('/'))
    .sort()
    .join('|');
}

export function createServiceWorkerScriptUrl(origin, buildIdentity) {
  const url = new URL('/sw.js', origin);
  if (typeof buildIdentity === 'string' && buildIdentity.trim()) {
    url.searchParams.set('build', buildIdentity.trim());
  }
  return url.toString();
}
