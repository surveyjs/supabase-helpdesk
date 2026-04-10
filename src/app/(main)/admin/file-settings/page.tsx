import { createServerClient } from '@/lib/supabase/server';
import { updateFileSettings, resetFileTypesToDefault } from '@/lib/actions/admin';

export default async function AdminFileSettingsPage() {
  const supabase = await createServerClient();

  const [allowedTypesRes, maxSizeRes, maxFilesRes] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'allowed_file_types').single(),
    supabase.from('app_settings').select('value').eq('key', 'max_file_size_mb').single(),
    supabase.from('app_settings').select('value').eq('key', 'max_files_per_post').single(),
  ]);

  const allowedTypes: string[] = allowedTypesRes.data
    ? JSON.parse(allowedTypesRes.data.value)
    : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'txt'];
  const maxSize = maxSizeRes.data?.value ?? '10';
  const maxFiles = maxFilesRes.data?.value ?? '5';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">File Uploads</h1>

      <form action={updateFileSettings} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        {/* Allowed file types */}
        <div>
          <label htmlFor="allowed_file_types" className="block text-sm font-medium text-gray-700 mb-1">
            Allowed file types
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Comma-separated list of file extensions (without dots).
          </p>
          <textarea
            id="allowed_file_types"
            name="allowed_file_types"
            rows={3}
            defaultValue={allowedTypes.join(', ')}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {allowedTypes.map((ext) => (
              <span
                key={ext}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
              >
                .{ext}
              </span>
            ))}
          </div>
        </div>

        {/* Maximum file size */}
        <div>
          <label htmlFor="max_file_size_mb" className="block text-sm font-medium text-gray-700 mb-1">
            Maximum file size (MB)
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Between 1 and 50 MB.
          </p>
          <input
            id="max_file_size_mb"
            type="number"
            name="max_file_size_mb"
            min={1}
            max={50}
            defaultValue={maxSize}
            required
            className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* Maximum files per post */}
        <div>
          <label htmlFor="max_files_per_post" className="block text-sm font-medium text-gray-700 mb-1">
            Maximum files per post
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Between 1 and 20.
          </p>
          <input
            id="max_files_per_post"
            type="number"
            name="max_files_per_post"
            min={1}
            max={20}
            defaultValue={maxFiles}
            required
            className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>

        <button
          type="submit"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
        >
          Save
        </button>
      </form>

      {/* Reset to defaults */}
      <form action={resetFileTypesToDefault} className="mt-4">
        <button
          type="submit"
          className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
        >
          Reset file types to defaults
        </button>
      </form>
    </div>
  );
}
