// Dev-server proxy that points the frontend at api.ordpool.space, so we can
// iterate against real production data without waiting for a Pages build.
//
// Use:  npm run start:against-prod
// Then: http://localhost:4200/

module.exports = [
  {
    context: ['/api/v1/**'],
    target: 'https://api.ordpool.space',
    secure: false,
    ws: true,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    context: ['/api/**'],
    target: 'https://api.ordpool.space',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    context: ['/content/**', '/preview/**', '/stamp-content/**', '/atomical-content/**'],
    target: 'https://api.ordpool.space',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    context: ['/r/**', '/blockheight', '/blockhash', '/blockhash/**', '/blocktime'],
    target: 'https://ordinals.com',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
];
