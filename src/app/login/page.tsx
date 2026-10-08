import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";
import { googleSignInEnabled } from "@/lib/auth";
import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · EvoTasks" };

const GOOGLE_ERRORS: Record<string, string> = {
  "google-domain": "Use your @evolutiongolf.co.uk Google account.",
  "google-no-account": "There's no active account for that email. Ask an admin to add you.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await currentUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/my-day");

  return (
    <AuthLayout
      heading="Sign in"
      lede="Your day's tasks, and what you owe."
      footer="No account? Ask an admin to create one for you."
    >
      <LoginForm
        googleEnabled={googleSignInEnabled}
        initialError={error ? (GOOGLE_ERRORS[error] ?? "Sign-in failed. Try again.") : null}
      />
    </AuthLayout>
  );
}
