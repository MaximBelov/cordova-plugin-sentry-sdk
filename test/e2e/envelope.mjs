// A Sentry envelope is what the SDKs post to the ingest endpoint: a header line, then items, each an item header line and a payload.
// Read here for the end-to-end tests, which receive the envelopes an app sends and check what is in them.
import { gunzipSync } from 'node:zlib';

/** { header, items: [{ header, payload: Buffer }] }. Accepts a gzip body, which is what sentry-java sends. */
export function parseEnvelope(raw) {
  let body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (body[0] === 0x1f && body[1] === 0x8b) {
    body = gunzipSync(body);
  }
  let position = 0;
  const line = () => {
    const end = body.indexOf(0x0a, position);
    const stop = end === -1 ? body.length : end;
    const text = body.subarray(position, stop).toString('utf8');
    position = end === -1 ? body.length : end + 1;
    return text;
  };
  const header = JSON.parse(line());
  const items = [];
  while (position < body.length) {
    const text = line();
    if (text === '') {
      continue;
    }
    const itemHeader = JSON.parse(text);
    let payload;
    if (typeof itemHeader.length === 'number') {
      payload = body.subarray(position, position + itemHeader.length);
      position += itemHeader.length;
      if (body[position] === 0x0a) {
        position += 1;
      }
    } else {
      payload = Buffer.from(line(), 'utf8');
    }
    items.push({ header: itemHeader, payload });
  }
  return { header, items };
}

/** The payloads of one item type, parsed as JSON: `itemsOf(envelope, 'event')` are the events in it. */
export function itemsOf(envelope, type) {
  return envelope.items.filter((item) => item.header.type === type).map((item) => JSON.parse(item.payload.toString('utf8')));
}
