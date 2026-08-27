import { requireUser } from "@/lib/guards";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Set your password · EvoTasks" };

export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <main className="flex min-h-dvh flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">
          {user.mustChangePassword ? "Set your password" : "Change your password"}
        </h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          {user.mustChangePassword
            ? "Pick something only you know before you start."
            : "You will stay signed in on this device."}
        </p>
        <ChangePasswordForm forced={user.mustChangePassword} />
      </div>
    </main>
  );
}
