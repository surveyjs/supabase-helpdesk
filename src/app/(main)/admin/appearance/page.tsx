import { getBranding } from '@/lib/branding-server';
import { AppearanceSurveyForm } from './AppearanceSurveyForm';

export default async function AdminAppearancePage() {
  const b = await getBranding();
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Appearance</h1>
      <AppearanceSurveyForm
        values={{ product_name: b.productName, logo_url: b.logoUrl, primary_color: b.primaryColor }}
      />
    </div>
  );
}
