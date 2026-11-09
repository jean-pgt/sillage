import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { api } from './api.mjs';

const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || 'http://localhost:' + port;
const assets = resolve('dist/client');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const { default: app } = await import('../dist/server/server.js');
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== new URL(origin).host) { res.writeHead(421); res.end('Unexpected host'); return; }
    const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const options = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 20000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      options.body = Buffer.concat(chunks);
    }
    const request = new Request(url, options);
    let response;
    if (url.pathname.startsWith('/api/')) response = await api(request, req.socket.remoteAddress);
    else if (url.pathname.startsWith('/assets/')) {
      const file = resolve(assets, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(assets + sep)) { res.writeHead(403); res.end(); return; }
      try { response = new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public,max-age=31536000,immutable' } }); } catch { response = new Response('Not found', { status: 404 }); }
    } else response = await app.fetch(request);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
    if (response.headers.getSetCookie().length) res.setHeader('Set-Cookie', response.headers.getSetCookie());
    res.writeHead(response.status);
    if (req.method === 'HEAD' || !response.body) res.end(); else Readable.fromWeb(response.body).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('Erreur interne'); }
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log('Sillage listening on port ' + port));
