import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES } from "./handler.ts";

// Authentication is verified by @supabase/server before the handler runs.
// The handler derives owner identity from ctx.userClaims and uses the admin
// client only for the server-only idempotency receipt/RPC.
export const authenticatedHandler = withSupabase(
  { auth: "user" },
  async (request, ctx) => await handleRequest(request, ctx),
);

if (import.meta.main) Deno.serve(authenticatedHandler);
