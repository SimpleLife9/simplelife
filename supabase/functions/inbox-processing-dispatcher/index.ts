import { withSupabase } from "@supabase/server";
import { handleRequest } from "./handler.ts";
export { handleRequest, MAX_DISPATCH_JOBS, MAX_REQUEST_BYTES } from "./handler.ts";

async function handleSecretInboxDispatcher(request: Request, ctx: unknown): Promise<Response> {
  return handleRequest(request, ctx as Parameters<typeof handleRequest>[1]);
}
export const secretHandler = withSupabase({ auth: "secret" }, handleSecretInboxDispatcher);
if (import.meta.main) Deno.serve(secretHandler);
