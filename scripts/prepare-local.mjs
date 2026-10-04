// Workaround for @netlify/blobs 11.1.0's LOCAL simulator only.
// Its GET omits ETag, and its check-then-write is not serialized.
// Production Netlify storage is not changed by this script.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const filename = require.resolve('@netlify/blobs/server').replace(/server\.cjs$/, 'server.js');
let source = fs.readFileSync(filename, 'utf8');
const marker = '// friends-score-local-simulator-fix-v1';
if (!source.includes(marker)) {
  const edits = [
    ['  async get(req) {', `  ${marker}
  async serializeLocal(operation) {
    const previous = this.friendsScoreTail || Promise.resolve();
    let release;
    this.friendsScoreTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  async get(req) { return this.serializeLocal(() => this.getUnlocked(req)); }
  async getUnlocked(req) {`],
    ['      return new Response(buffer, { headers });', '      headers.etag = await _BlobsServer.generateETag(dataPath);\n      return new Response(buffer, { headers });'],
    ['  async put(req) {', '  async put(req) { return this.serializeLocal(() => this.putUnlocked(req)); }\n  async putUnlocked(req) {'],
  ];
  for (const [before,after] of edits) {
    if (!source.includes(before)) throw Error('Local simulator changed; review compatibility fix before continuing.');
    source = source.replace(before,after);
  }
  fs.writeFileSync(filename,source);
}
console.log('Local Blobs simulator: version headers and atomic writes enabled. No cloud resources used.');

// The local CLI must not turn an API 403 into static .html fallback requests.
const proxyFile = new URL('../node_modules/netlify-cli/dist/utils/proxy.js', import.meta.url);
let proxy = fs.readFileSync(proxyFile, 'utf8');
const before = 'if (proxyRes.statusCode === 404 || proxyRes.statusCode === 403) {';
const after = "if ((proxyRes.statusCode === 404 || proxyRes.statusCode === 403) && !(proxyRes.headers['content-type'] || '').includes('application/json')) {";
if (proxy.includes(before)) fs.writeFileSync(proxyFile, proxy.replace(before, after));
else if (!proxy.includes(after)) throw Error('Local CLI changed; review API status fallback fix.');
