/* Tiny static server for the repo root: the service worker and manifest only work over http. `node tests/serve.js [port]` */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.webmanifest':'application/manifest+json', '.png':'image/png', '.json':'application/json', '.svg':'image/svg+xml' };
function serve(port = 0){
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p); if (!f.startsWith(ROOT)){ rsp.writeHead(403); return rsp.end(); }
      fs.readFile(f, (err, buf) => { if (err){ rsp.writeHead(404); return rsp.end('not found'); } rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); rsp.end(buf); });
    }).listen(port, '127.0.0.1', () => res({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() }));
  });
}
module.exports = { serve };
if (require.main === module) serve(+process.argv[2] || 8765).then(s => console.log('serving', s.url));
