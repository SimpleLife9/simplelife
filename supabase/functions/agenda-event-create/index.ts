import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES } from "./handler.ts";

// Keep the SDK's deeply generic SupabaseContext out of the domain handler's
// inferred callback signature. The runtime context is narrowed at this single
// authenticated adapter boundary; auth is still enforced by withSupabase.
async function handleAuthenticatedEventCreate(
  request: Request,
  ctx: unknown,
): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}

export const authenticatedHandler = withSupabase(
  { auth: "user" },
  handleAuthenticatedEventCreate,
);

if (import.meta.main) Deno.serve(authenticatedHandler);
