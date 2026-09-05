import {
  protectedResourceMetadata,
  readAuthConfig,
} from "../src/mcp/auth.js";

export default function oauthProtectedResource(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end();
    return;
  }
  try {
    const config = readAuthConfig();
    if (!config) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "TREE_BRAIN_OAUTH_NOT_CONFIGURED" } }));
      return;
    }
    res.statusCode = 200;
    res.setHeader("cache-control", "public, max-age=300");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(JSON.stringify(protectedResourceMetadata(config)));
  } catch (error) {
    res.statusCode = Number(error?.statusCode) || 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { code: "TREE_BRAIN_OAUTH_NOT_CONFIGURED" } }));
  }
}
