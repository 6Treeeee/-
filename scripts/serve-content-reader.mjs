import { createServer } from "node:http";
import handler from "../api/index.js";

const host = process.env.CONTENT_READER_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTENT_READER_PORT ?? 8787);
const server = createServer(async (incoming, outgoing) => {
  const target = new URL(incoming.url, `http://${incoming.headers.host || `${host}:${port}`}`);
  let body = null;
  if (!["GET", "HEAD", "OPTIONS"].includes(incoming.method)) {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { body = null; }
    }
  }
  const req = {
    method: incoming.method,
    headers: incoming.headers,
    query: Object.fromEntries(target.searchParams.entries()),
    body
  };
  let statusCode = 200;
  const res = {
    setHeader: (name, value) => outgoing.setHeader(name, value),
    status(value) { statusCode = value; return this; },
    json(value) {
      outgoing.statusCode = statusCode;
      outgoing.setHeader("Content-Type", "application/json; charset=utf-8");
      outgoing.end(JSON.stringify(value));
      return value;
    },
    end() { outgoing.statusCode = statusCode; outgoing.end(); }
  };
  await handler(req, res);
});
server.listen(port, host, () => console.info(JSON.stringify({ event: "content_reader.local.started", host, port })));
