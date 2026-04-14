import { createServerClient } from '@/lib/supabase/server';
import {
  createKbCategory,
  renameKbCategory,
  deleteKbCategory,
  reorderKbCategories,
} from '@/lib/actions/admin';

export default async function AdminKbCategoriesPage() {
  const supabase = await createServerClient();

  const { data: categories } = await supabase
    .from('kb_categories')
    .select('id, name, display_order')
    .order('display_order');

  const orderedIds = (categories ?? []).map((c) => c.id);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">KB Categories</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {(!categories || categories.length === 0) ? (
          <p className="text-gray-500 text-sm">No KB categories defined.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {categories.map((cat, index) => (
              <li key={cat.id} className="py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-900 min-w-24">
                  {cat.name}
                </span>
                <span className="text-xs text-gray-400">order: {cat.display_order}</span>

                {/* Reorder buttons */}
                {index > 0 && (
                  <form action={reorderKbCategories}>
                    <input
                      type="hidden"
                      name="ordered_ids"
                      value={JSON.stringify(moveItem(orderedIds, index, index - 1))}
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
                      aria-label={`Move ${cat.name} up`}
                    >
                      ↑
                    </button>
                  </form>
                )}
                {index < (categories.length - 1) && (
                  <form action={reorderKbCategories}>
                    <input
                      type="hidden"
                      name="ordered_ids"
                      value={JSON.stringify(moveItem(orderedIds, index, index + 1))}
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
                      aria-label={`Move ${cat.name} down`}
                    >
                      ↓
                    </button>
                  </form>
                )}

                {/* Rename form */}
                <form action={renameKbCategory} className="flex gap-1 items-center">
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
                <form action={deleteKbCategory}>
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
        <form action={createKbCategory} className="flex gap-2 items-end">
          <div>
            <label htmlFor="new-cat-name" className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              id="new-cat-name"
              type="text"
              name="name"
              required
              maxLength={100}
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Category name"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}

function moveItem<T>(arr: T[], fromIdx: number, toIdx: number): T[] {
  const result = [...arr];
  const [removed] = result.splice(fromIdx, 1);
  result.splice(toIdx, 0, removed);
  return result;
}
