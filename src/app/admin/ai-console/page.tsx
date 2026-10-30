import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAiRuntimeConfig } from "@/lib/ai/provider";
import {
  getAgentConfigSnapshot,
  loadRecentChatLogs,
  loadWarRoomSnapshot,
} from "@/lib/ai/records";
import { can, homePathForRole } from "@/lib/rbac";
import { getSessionUserFromCookies } from "@/lib/session";

import { AiConsoleClient } from "./ai-console-client";

export const metadata = {
  title: "AI Console | DBAIRS Super Admin",
  description:
    "Sales AI chat, lost-lead failure-reason analytics and one-click tactic generation for the sales System Prompt.",
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

  const [snapshot, config, logs] = await Promise.all([
    loadWarRoomSnapshot("open"),
    getAgentConfigSnapshot("sales"),
    loadRecentChatLogs({ agentType: "sales", take: 20 }),
  ]);

  const runtime = getAiRuntimeConfig();

  return (
    <AiConsoleClient
      initialSnapshot={snapshot}
      initialConfig={config}
      initialLogs={logs}
      cloudEnabled={runtime.configured}
      modelLabel={runtime.configured ? runtime.model : null}
    />
  );
}
