import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata = {
  title: "Forgot Password | DB AIRS",
  description:
    "Request a secure password reset link for your player or admin account.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
