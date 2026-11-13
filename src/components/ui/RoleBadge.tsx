type Role = 'admin' | 'agent' | string;

export function RoleBadge({ role }: { role: Role | null }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200">
        Admin
      </span>
    );
  }
  if (role === 'agent') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-300">
        Agent
      </span>
    );
  }
  return null;
}
