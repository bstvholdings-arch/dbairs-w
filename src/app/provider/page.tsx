import { redirect } from "next/navigation";

/**
 * /provider 没有品牌 code，单独打开没有意义（品牌墙只链接 /provider/[code]）。
 * 直接回大厅，避免玩家停在默认 404 上。
 */
export default function ProviderIndexPage() {
  redirect("/");
}
