import { requireAdmin } from '@/lib/supabase/auth';
import { AdminSidebar } from './AdminSidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="flex gap-6 min-h-[calc(100vh-80px)]">
      <AdminSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
