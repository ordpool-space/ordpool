import { renderInscriptionViaBackend } from './render-inscription-via-backend';

describe('renderInscriptionViaBackend', () => {

  // Media / rich content -> served by the backend (subject to the /preview route).
  const backendTypes = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/apng', 'image/svg+xml',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/flac',
    'model/gltf+json', 'model/gltf-binary', 'model/stl',
    'application/pdf',
    'text/markdown',
    'text/html',
  ];

  it.each(backendTypes)('serves %s from the backend', (ct) => {
    expect(renderInscriptionViaBackend(ct)).toBe(true);
  });

  // Inert content -> rendered client-side.
  const clientSideTypes = [
    'text/plain',
    'application/json',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/yaml',
    'application/pgp-signature',
    'application/octet-stream',
    'application/cbor',
    'font/woff2',
    'font/otf',
  ];

  it.each(clientSideTypes)('renders %s client-side', (ct) => {
    expect(renderInscriptionViaBackend(ct)).toBe(false);
  });

  it('strips charset params before matching', () => {
    expect(renderInscriptionViaBackend('image/png; charset=binary')).toBe(true);
    expect(renderInscriptionViaBackend('text/html;charset=utf-8')).toBe(true);
    expect(renderInscriptionViaBackend('text/markdown;charset=utf-8')).toBe(true);
    expect(renderInscriptionViaBackend('text/plain;charset=utf-8')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(renderInscriptionViaBackend('IMAGE/PNG')).toBe(true);
    expect(renderInscriptionViaBackend('Text/HTML')).toBe(true);
    expect(renderInscriptionViaBackend('Application/JSON')).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(renderInscriptionViaBackend('  image/webp  ')).toBe(true);
  });

  it.each([undefined, null, ''])('returns false for %p', (ct) => {
    expect(renderInscriptionViaBackend(ct as string | undefined | null)).toBe(false);
  });
});
