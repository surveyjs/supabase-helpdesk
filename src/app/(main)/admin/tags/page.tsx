import { createServerClient } from '@/lib/supabase/server';
import {
  createTag,
  renameTag,
  updateTagColor,
  deleteTag,
} from '@/lib/actions/admin';

function getContrastColor(hex: string): string {
  const c = hex.replace('#', '');
  const srgb = [0, 2, 4].map((i) => {
    const v = parseInt(c.substring(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const ratioWhite = 1.05 / (L + 0.05);
  const ratioDark = (L + 0.05) / 0.05;
  return ratioWhite >= ratioDark ? '#FFFFFF' : '#000000';
}

export default async function AdminTagsPage() {
  const supabase = await createServerClient();

  const { data: tags } = await supabase
    .from('tags')
    .select('id, name, color')
    .order('name');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Tags</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {(!tags || tags.length === 0) ? (
          <p className="text-gray-500 text-sm">No tags defined.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {tags.map((tag) => (
              <li key={tag.id} className="py-3 flex flex-wrap items-center gap-3">
                {/* Tag pill */}
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.name}
                </span>

                {/* Rename form */}
                <form action={renameTag} className="flex gap-1 items-center">
                  <input type="hidden" name="tag_id" value={tag.id} />
                  <input
                    type="text"
                    name="name"
                    defaultValue={tag.name}
                    maxLength={50}
                    className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    aria-label={`Rename ${tag.name}`}
                  />
                  <button type="submit" className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700">
                    Rename
                  </button>
                </form>

                {/* Change color */}
                <form action={updateTagColor} className="flex gap-1 items-center">
                  <input type="hidden" name="tag_id" value={tag.id} />
                  <input
                    type="color"
                    name="color"
                    defaultValue={tag.color}
                    className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                    aria-label={`Color for ${tag.name}`}
                  />
                  <button type="submit" className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700">
                    Update Color
                  </button>
                </form>

                {/* Delete */}
                <form action={deleteTag}>
                  <input type="hidden" name="tag_id" value={tag.id} />
                  <button
                    type="submit"
                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    aria-label={`Delete ${tag.name}`}
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add new tag */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Add New Tag</h2>
        <form action={createTag} className="flex gap-2 items-end">
          <div>
            <label htmlFor="new-tag-name" className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              id="new-tag-name"
              type="text"
              name="name"
              maxLength={50}
              required
              className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Tag name…"
            />
          </div>
          <div>
            <label htmlFor="new-tag-color" className="block text-xs font-medium text-gray-500 mb-1">Color</label>
            <input
              id="new-tag-color"
              type="color"
              name="color"
              defaultValue="#6B7280"
              className="w-10 h-9 rounded border border-gray-300 cursor-pointer"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Add Tag
          </button>
        </form>
      </div>
    </div>
  );
}
