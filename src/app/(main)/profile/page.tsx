import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { DisplayNameForm } from './DisplayNameForm';
import { ChangePasswordForm } from './ChangePasswordForm';
import { DeleteAccountButton } from './DeleteAccountButton';
import { EditorPreferenceForm } from './EditorPreferenceForm';

export default async function ProfilePage() {
  const user = await requireAuth();
  const supabase = await createServerClient();

  const profileSelect = 'id, email, display_name, role, team_id, created_at, editor_view_mode';
  const { data: profileWithEditorMode, error: profileError } = await supabase
    .from('profiles')
    .select(profileSelect)
    .eq('id', user.id)
    .single();

  // Older local DBs may not have editor_view_mode yet; fall back without it.
  let profile = profileWithEditorMode;
  if (profileError?.code === '42703') {
    const { data: profileWithoutEditorMode } = await supabase
      .from('profiles')
      .select('id, email, display_name, role, team_id, created_at')
      .eq('id', user.id)
      .single();
    profile = profileWithoutEditorMode ? { ...profileWithoutEditorMode, editor_view_mode: null } : null;
  }

  if (!profile) redirect('/login');

  // Fetch team name if user has a team
  let teamName: string | null = null;
  if (profile.team_id) {
    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', profile.team_id)
      .single();
    teamName = team?.name ?? null;
  }

  // Check if display name uniqueness is enforced
  const { data: uniqueSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'enforce_display_name_uniqueness')
    .single();
  const enforceUniqueness = uniqueSetting?.value === 'true';

  // Check auth mode (external mode hides password form)
  const { data: authModeSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'auth_mode')
    .single();
  const isExternalAuth = authModeSetting?.value === 'external';

  // Check if user authenticated via social OAuth provider (hide password change)
  const isSocialAuth = user.app_metadata?.provider && user.app_metadata.provider !== 'email';
  const showPasswordForm = !isExternalAuth && !isSocialAuth;

  const isAgentOrAdmin = profile.role === 'agent' || profile.role === 'admin';

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Profile</h1>

      {/* Account info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Account Information</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">Email</dt>
            <dd className="text-gray-900" data-testid="profile-email">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Role</dt>
            <dd className="text-gray-900 capitalize" data-testid="profile-role">{profile.role}</dd>
          </div>
          {teamName && (
            <div>
              <dt className="text-gray-500">Team</dt>
              <dd className="text-gray-900" data-testid="profile-team">{teamName}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Member since</dt>
            <dd className="text-gray-900" data-testid="profile-created">
              {new Date(profile.created_at).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </div>

      {/* Display name form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Display Name</h2>
        <DisplayNameForm
          currentName={profile.display_name ?? ''}
          enforceUniqueness={enforceUniqueness}
        />
      </div>

      {/* Change password (only in built-in auth mode for email users) */}
      {showPasswordForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h2>
          <ChangePasswordForm />
        </div>
      )}

      {/* Editor preference */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Editor Preference</h2>
        <EditorPreferenceForm
          currentMode={(profile.editor_view_mode as 'both' | 'preview' | 'editor' | null) ?? 'both'}
        />
      </div>

      {/* Delete account */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Delete Account</h2>
        {isAgentOrAdmin ? (
          <p className="text-sm text-gray-500">
            Agents and admins cannot delete their account. You must be demoted to a regular user first.
          </p>
        ) : (
          <DeleteAccountButton />
        )}
      </div>
    </div>
  );
}
