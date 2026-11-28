import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_BODY_BYTES } from "./handler.ts";

// JWT verification is intentionally disabled: the handler requires the separate
// high-entropy Vault token and then invokes internal service-only RPC/function paths.
if (import.meta.main) Deno.serve((request) => handleRequest(request));
