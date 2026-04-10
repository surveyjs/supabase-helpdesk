import { requireAdmin } from '@/lib/supabase/auth';
import { createServerClient } from '@/lib/supabase/server';
import Link from 'next/link';
import {
  createCategory,
  renameCategory,
  deleteCategory,
} from '@/lib/actions/admin';

export default async function AdminCategoriesPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .order('name');

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/types" className="text-sm text-blue-600 hover:text-blue-800">← Back</Link>
        <h1 className="text-2xl font-semibold text-gray-900">Manage Categories</h1>
      </div>

      <nav className="flex gap-4 mb-6 text-sm">
        <Link href="/admin/types" className="text-blue-600 hover:text-blue-800">Types</Link>
        <span className="font-medium text-gray-900">Categories</span>
        <Link href="/admin/tags" className="text-blue-600 hover:text-blue-800">Tags</Link>
        <Link href="/admin/teams" className="text-blue-600 hover:text-blue-800">Teams</Link>
      </nav>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {(!categories || categories.length === 0) ? (
          <p className="text-gray-500 text-sm">No categories defined.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {categories.map((cat) => (
              <li key={cat.id} className="py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-900">{cat.name}</span>

                {/* Rename form */}
                <form action={renameCategory} className="flex gap-1 items-center">
                  <input type="hidden" name="category_id" value={cat.id} />
                  <input
                    type="text"
                    name="name"
                    defaultValue={cat.name}
                    maxLength={100}
                    className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    aria-label={`Rename ${cat.name}`}
                  />
                  <button type="submit" className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700">
                    Rename
                  </button>
                </form>

                {/* Delete */}
                <form action={deleteCategory}>
                  <input type="hidden" name="category_id" value={cat.id} />
                  <button
                    type="submit"
                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    aria-label={`Delete ${cat.name}`}
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add new category */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Add New Category</h2>
        <form action={createCategory} className="flex gap-2 items-end">
          <div>
            <label htmlFor="new-category-name" className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              id="new-category-name"
              type="text"
              name="name"
              maxLength={100}
              required
              className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Category name…"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Add Category
          </button>
        </form>
      </div>
    </div>
  );
}
