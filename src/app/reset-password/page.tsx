import { ResetPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata = {
  title: "Reset Password | DB AIRS",
  description: "Choose a new password for your DB AIRS account.",
};

export const instant = false;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;

  return <ResetPasswordForm token={readParam(params.token)} />;
}
