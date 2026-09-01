import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";
import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · EvoTasks" };

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/my-day");

  return (
    <AuthLayout
      heading="Sign in"
      lede="Your day's tasks, and what you owe."
      footer="No account? Ask an admin to create one for you."
    >
      <LoginForm />
    </AuthLayout>
  );
}
