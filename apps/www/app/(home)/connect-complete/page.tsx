import { OpenCmuxClient } from "../handler/after-sign-in/OpenCmuxClient";
import { env } from "@/lib/utils/www-env";

export const dynamic = "force-dynamic";

export default function ConnectCompletePage({
  params,
}: {
  params: { teamSlugOrId: string };
}) {
  const protocol = env.NEXT_PUBLIC_CMUX_PROTOCOL ?? "cmux-next";
  const href = `${protocol}://github-connect-complete?team=${encodeURIComponent(
    params.teamSlugOrId
  )}`;
  return <OpenCmuxClient href={href} />;
}
