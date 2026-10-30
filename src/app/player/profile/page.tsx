import { redirect } from "next/navigation";

import {
  PlayerProfileClient,
  type PlayerProfileTab,
} from "./player-profile-client";
import { getPlayerProfileData } from "@/lib/player-profile";
import { getPlayerSessionFromCookies } from "@/lib/player-session";

export const metadata = {
  title: "Player Center | DB AIRS",
  description:
    "Manage your DB AIRS wallet, deposit history, security and referral rewards.",
};

export const instant = false;

const TABS: PlayerProfileTab[] = ["wallet", "history", "security", "referral"];

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readTab(value: string): PlayerProfileTab {
  return TABS.find((item) => item === value) ?? "wallet";
}

export default async function PlayerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const session = await getPlayerSessionFromCookies();

  if (!session) {
    const tab = readParam(params.tab);
    redirect(
      `/player/login?next=${encodeURIComponent(
        tab ? `/player/profile?tab=${tab}` : "/player/profile",
      )}`,
    );
  }

  const profile = await getPlayerProfileData(session);

  return (
    <PlayerProfileClient
      profile={profile}
      initialTab={readTab(readParam(params.tab))}
    />
  );
}
