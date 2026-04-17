import { createServiceRoleClient } from '@/lib/supabase/server';

export async function getErrorTemplate(
  key: string,
  placeholders: Record<string, string>,
): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single();

  let template = data?.value ?? '';
  for (const [k, v] of Object.entries(placeholders)) {
    template = template.replaceAll(`{{${k}}}`, v);
  }
  return template;
}
