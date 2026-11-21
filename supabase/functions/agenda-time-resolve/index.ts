import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";

export { handleRequest, MAX_REQUEST_BYTES } from "./handler.ts";

// The gateway verify_jwt check is defense in depth. This user-mode wrapper
// rejects publishable/secret API keys used as bearer credentials.
export const authenticatedHandler = withSupabase(
  { auth: "user" },
  async (request) => await handleRequest(request),
);

if (import.meta.main) Deno.serve(authenticatedHandler);
