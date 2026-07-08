/**
 * Decides whether an inscription preview is served from the backend
 * `/preview/<id>` route (an `<iframe src>`) instead of being rendered
 * client-side from the browser-parsed witness bytes.
 *
 * Anything that can display media or rich content -- images, video, audio,
 * pdf, 3d models, markdown, html, svg -- is served by the backend. Inert
 * content (plain text, json, css, javascript) and unmapped binary types
 * render client-side from the parsed inscription.
 */
export function renderInscriptionViaBackend(contentType: string | undefined | null): boolean {
  if (!contentType) {
    return false;
  }
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return ct.startsWith('image/')
    || ct.startsWith('video/')
    || ct.startsWith('audio/')
    || ct.startsWith('model/')
    || ct === 'application/pdf'
    || ct === 'text/markdown'
    || ct === 'text/html';
}
