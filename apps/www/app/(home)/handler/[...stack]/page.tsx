import { redirect } from "next/navigation";
import { stackServerApp } from "@/lib/utils/stack";
import { StackHandler } from "@stackframe/stack";

type HandlerProps = {
  params: Promise<{ stack?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Handler(props: HandlerProps) {
  const params = await props.params;
  const pathSegments = params.stack ?? [];

  // Check if this is a sign-in route and user is already signed in
  // If so, redirect to after-sign-in to trigger the deeplink flow
  if (pathSegments[0] === "sign-in") {
    const user = await stackServerApp.getUser({ or: "return-null" });
    if (user) {
      // User is already signed in - redirect to after-sign-in to handle deeplink
      redirect("/handler/after-sign-in");
    }
  }

  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}
