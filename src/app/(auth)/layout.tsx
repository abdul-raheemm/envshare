import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-primary">EnvShare</h1>
          <p className="mt-1 text-sm text-muted">
            Share environment variables securely with your team
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}