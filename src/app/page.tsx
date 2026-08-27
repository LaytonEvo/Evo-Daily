import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";

export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/my-day" : "/login");
}
