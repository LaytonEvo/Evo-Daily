import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · EvoTasks" };

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/my-day");

  return (
    <main className="flex min-h-dvh flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">EvoTasks</h1>
          <p className="mt-2 text-sm text-muted-foreground">Evolution Golf</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          No account? Ask an admin to create one for you.
        </p>
      </div>
    </main>
  );
}
