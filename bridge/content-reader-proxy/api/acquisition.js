import { getVercelOidcToken } from "@vercel/oidc";
import { createProxyHandler } from "../src/proxy.js";

// Resolve the token inside each request. Vercel supplies it through the
// Function request context, not at module initialization.
export default createProxyHandler({ tokenResolver: getVercelOidcToken });
