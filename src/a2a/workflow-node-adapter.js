const MAX_QUEUE_BODY_BYTES = 2 * 1024 * 1024;

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") {
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_QUEUE_BODY_BYTES) throw new Error("WORKFLOW_QUEUE_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
export async function runWorkflowWebHandler(webHandler, req, res) {
  if (typeof webHandler !== "function") {
    res.statusCode = 503;
    res.end();
    return;
  }
  const host = req.headers.host || "workflow.invalid";
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (value == null) continue;
    headers.set(name, Array.isArray(value) ? value.join(",") : String(value));
  }
  const method = String(req.method || "POST").toUpperCase();
  const body = ["GET", "HEAD"].includes(method) ? null : await readBody(req);
  const request = new Request(`${protocol}://${host}${req.url || "/"}`, {
    method,
    headers,
    ...(body ? { body } : {}),
  });
  const response = await webHandler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  const responseBody = Buffer.from(await response.arrayBuffer());
  res.end(responseBody);
}
