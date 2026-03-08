import { stackServerApp } from "@/lib/utils/stack";
import { StackHandler } from "@stackframe/stack";
import { redirect } from "next/navigation";

export default async function Handler(props: {
  params: Promise<{ stack: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;

  // If force=true, redirect to the force-sign-in API route which handles sign-out
  // This is used by the desktop app to show the account picker
  if (searchParams.force === "true") {
    redirect("/api/auth/force-sign-in");
  }

  return <StackHandler fullPage app={stackServerApp} routeProps={props} />;
}
