import { StackServerApp as StackServerAppJs } from "@stackframe/js";
import { env } from "./convex-env";

export const stackServerAppJs = new StackServerAppJs({
  tokenStore: "memory",
  projectId: env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: env.STACK_SECRET_SERVER_KEY,
});
