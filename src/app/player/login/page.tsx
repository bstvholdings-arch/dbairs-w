import { redirect } from "next/navigation";

import { PlayerAuthForm } from "@/components/player/player-auth-form";
import { getPlayerSessionFromCookies } from "@/lib/player-session";

export const metadata = {
  title: "Player Login | DB AIRS",
  description: "Sign in to your DB AIRS player wallet and game history.",
};

export const instant = false;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function safeNextPath(value: string) {
  const next = value.trim();

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "";
  }

  return next;
}

export default async function PlayerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    site?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(readParam(params.next));
  const session = await getPlayerSessionFromCookies();

  if (session) {
    redirect(nextPath || "/");
  }

  return (
    <PlayerAuthForm
      mode="login"
      nextPath={nextPath}
      site={readParam(params.site)}
      referralCode=""
    />
  );
}
