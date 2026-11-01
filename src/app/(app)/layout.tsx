import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getCurrentUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <Navbar userName={user.name} />
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}