import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  listAgentConfigs,
  loadRecentChatLogsByAgent,
  loadWarRoomSnapshot,
} from "@/lib/ai/records";
import { getAiSettingsSnapshot } from "@/lib/ai/settings";
import { can, homePathForRole } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";

import { AiConsoleClient } from "./ai-console-client";

export const metadata = {
  title: "AI Control Center | DBAIRS Super Admin",
  description:
    "Five independent AI assistants, DeepSeek / OpenAI model access, live test chat and lost-lead analytics.",
};

export const instant = false;

export default async function AdminAiConsolePage() {
  await connection();

  const user = await getSessionUserFromCookies();

  if (!user) {
    redirect("/login?next=/admin/ai-console");
  }

  // 第二道防线：proxy 已按矩阵拦截，这里再确认一次。
  // 线索联系方式属于敏感数据，只有超级管理员可以查看。
  if (!can(user.role, "aiConsole") || user.role !== "super_admin") {
    redirect(`${homePathForRole(user.role)}?denied=aiConsole`);
  }

  const [snapshot, logsByAgent, settings, agents] = await Promise.all([
    loadWarRoomSnapshot("open"),
    loadRecentChatLogsByAgent({ take: 40 }),
    getAiSettingsSnapshot(),
    listAgentConfigs(),
  ]);

  // listAgentConfigs 已保证 5 个助手都存在；直接复用，避免再对 sales 做一次并发 upsert。
  const config = agents.find((agent) => agent.agentName === "sales")!;
  const cloudEnabled = settings.isActive && settings.hasApiKey;

  return (
    <AiConsoleClient
      initialSnapshot={snapshot}
      initialConfig={config}
      initialLogsByAgent={logsByAgent}
      initialSettings={settings}
      initialAgents={agents}
      cloudEnabled={cloudEnabled}
      modelLabel={cloudEnabled ? settings.model : null}
    />
  );
}
