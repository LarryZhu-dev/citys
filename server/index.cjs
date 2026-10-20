'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app.cjs');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.pck':'application/octet-stream','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
function createServer(options = {}) {
  const app = createApp(options);
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',csp);
    if (req.url.split('?')[0].startsWith('/api/')) return app(req,res);
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
    if (pathname === '/') pathname = '/index.html';
    // Explicit static allowlist prevents accidental publication of server files,
    // local accounts, .env, git metadata, tests or database backups.
    if (!/^\/(?:index\.html|(?:style|online)\.css|(?:js|assets|engine-web)\/[A-Za-z0-9_./-]+)$/.test(pathname) || pathname.split('/').some(p=>p === '..' || p.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
    let file = path.join(root,pathname);
    if (/^\/assets\/ui\/(?:actions|controls|resources|paper|wood|card|red)\.png$/.test(pathname)) file=path.join(root,'godot','art','ui',path.basename(pathname));
    if (/^\/engine-web\/game\.(wasm|pck)$/.test(pathname) && fs.existsSync(file+'.gz')) {
      file += '.gz';
      res.setHeader('Content-Encoding','gzip');
    }
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw new Error('not-file');
      res.setHeader('Content-Type',types[path.extname(pathname)] || 'application/octet-stream');
      res.setHeader('Content-Length',stat.size);
      res.setHeader('Cache-Control','no-cache');
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.app = app;
  return server;
}
if (require.main === module) {
  const server = createServer();
  const host = process.env.HOST || '0.0.0.0', port = Number(process.env.PORT) || 3000;
  server.listen(port,host,()=>console.log(`Game available on http://${host}:${port} (${server.app.store.kind} online storage)`));
  for (const event of ['SIGTERM','SIGINT']) process.on(event,()=>server.close(()=>server.app.store.close().finally(()=>process.exit(0))));
}
module.exports = { createServer };
