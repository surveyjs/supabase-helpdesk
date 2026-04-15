import { getAiSettings, getAiUsageStats } from '@/lib/actions/ai';
import { AiConfigForm } from './AiConfigForm';

export default async function AdminAiPage() {
  const settings = await getAiSettings();
  const usage = await getAiUsageStats();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">AI Configuration</h1>
      <AiConfigForm settings={settings} usage={usage} />
    </div>
  );
}
