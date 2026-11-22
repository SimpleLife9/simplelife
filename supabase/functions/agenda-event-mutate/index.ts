import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES } from "./handler.ts";

// Keep the SDK's deeply generic SupabaseContext out of the domain handler's
// inferred callback signature; JWT verification remains in withSupabase.
async function handleAuthenticatedEventMutation(
  request: Request,
  ctx: unknown,
): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}

export const authenticatedHandler = withSupabase(
  { auth: "user" },
  handleAuthenticatedEventMutation,
);

if (import.meta.main) Deno.serve(authenticatedHandler);
