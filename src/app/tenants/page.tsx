import { redirect } from "next/navigation";

export default function LegacyTenantsPage() {
  redirect("/admin/tenants");
}
