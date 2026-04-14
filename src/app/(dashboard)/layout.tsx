import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { getUserContext } from '@/lib/auth/server';

/**
 * Dashboard layout — authenticated shell with sidebar and header.
 *
 * This is a server component that:
 * 1. Reads the user's claims from request headers (set by middleware)
 * 2. Wraps children in AuthProvider so client components can access user context
 * 3. Renders the sidebar + header shell
 *
 * All routes under (dashboard) share this layout — including:
 * /my-clients, /portfolio, /clients/[clientId]/*, /admin/*
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUserContext();

  return (
    <AuthProvider user={user}>
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto bg-gray-50">
            {children}
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
