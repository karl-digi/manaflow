import { WebShell } from "@/components/web-ui/WebShell";
import { RivetChatSidebar } from "@/components/rivet-demo/RivetChatSidebar";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/r")({
  component: RivetChatLayout,
});

function RivetChatLayout() {
  const match = useMatch({
    from: "/_layout/r/$chatId",
    shouldThrow: false,
  });
  const activeChatId = match?.params.chatId;

  return (
    <WebShell sidebar={<RivetChatSidebar activeChatId={activeChatId} />}>
      <Outlet />
    </WebShell>
  );
}
