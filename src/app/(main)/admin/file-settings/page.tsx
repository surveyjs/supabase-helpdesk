import { createServerClient } from '@/lib/supabase/server';
import { FileSettingsSurveyForm } from './FileSettingsSurveyForm';

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
      <FileSettingsSurveyForm
        values={{
          allowed_file_types: allowedTypes.join(', '),
          max_file_size_mb: maxSize,
          max_files_per_post: maxFiles,
        }}
      />
    </div>
  );
}
