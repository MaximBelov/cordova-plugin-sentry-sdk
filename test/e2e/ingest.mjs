// A Sentry ingest endpoint of one's own: it takes the envelopes an app posts, keeps them, and answers 200. An app whose DSN points
// here sends everything it would send to Sentry, with no account and no secret, so a test can read what the plugin put in it.
import { createServer } from 'node:http';
import { parseEnvelope } from './envelope.mjs';

/** { port, received, close }. `received` fills as envelopes arrive: { project, key, envelope, at }. */
export function startIngest({ port = 0, host = '0.0.0.0' } = {}) {
  const received = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://ingest');
      const route = /^\/api\/(\d+)\/envelope\/?$/.exec(url.pathname);
      if (request.method !== 'POST' || !route) {
        response.writeHead(404).end();
        return;
      }
      try {
        // sentry-java authenticates in a header, sentry-cocoa in the query: both mean the DSN's public key.
        const auth = String(request.headers['x-sentry-auth'] ?? '');
        const key = /sentry_key=(\w+)/.exec(auth)?.[1] ?? url.searchParams.get('sentry_key');
        received.push({ project: route[1], key, envelope: parseEnvelope(Buffer.concat(chunks)), at: Date.now() });
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      } catch (error) {
        console.error(`ingest: an envelope that cannot be read: ${error.message}`);
        response.writeHead(400).end();
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () =>
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}
