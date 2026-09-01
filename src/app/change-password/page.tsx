import { requireUser } from "@/lib/guards";
import { AuthLayout } from "@/components/auth-layout";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Set your password · EvoTasks" };

export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <AuthLayout
      heading={user.mustChangePassword ? "Set your password" : "Change your password"}
      lede={
        user.mustChangePassword
          ? "Pick something only you know before you start."
          : "You will stay signed in on this device."
      }
    >
      <ChangePasswordForm forced={user.mustChangePassword} />
    </AuthLayout>
  );
}
