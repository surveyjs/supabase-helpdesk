import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAgent } from '@/lib/supabase/auth';
import { renderMarkdown } from '@/lib/utils/markdown';
import { assignTier } from '@/lib/actions/tiers';
import { UserNoteForm } from './UserNoteForm';
import { UserNoteItem } from './UserNoteItem';
import { AdminUserActions } from './AdminUserActions';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const currentUser = await requireAgent();
  const supabase = await createServerClient();

  // Get current user's role
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single();
  const isAdmin = currentProfile?.role === 'admin';

  // Fetch target user profile
  const { data: targetUser } = await supabase
    .from('profiles')
    .select('id, display_name, email, role, team_id, is_blocked, created_at, tier_id, tier_expires_at')
    .eq('id', userId)
    .single();

  if (!targetUser) notFound();

  // Fetch team name
  let teamName: string | null = null;
  if (targetUser.team_id) {
    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', targetUser.team_id)
      .single();
    teamName = team?.name ?? null;
  }

  // Fetch ticket count
  const { count: ticketCount } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', userId);

  // Fetch tier info
  let tierInfo: { key: string; display_name: string; color: string } | null = null;
  if (targetUser.tier_id) {
    const { data: tier } = await supabase
      .from('subscription_tiers')
      .select('key, display_name, color')
      .eq('id', targetUser.tier_id)
      .single();
    tierInfo = tier ?? null;
  }
  const tierExpired = targetUser.tier_expires_at && new Date(targetUser.tier_expires_at) < new Date();

  // Fetch available tiers (for admin assignment)
  let allTiers: { id: string; key: string; display_name: string }[] = [];
  if (isAdmin) {
    const { data: tiers } = await supabase
      .from('subscription_tiers')
      .select('id, key, display_name')
      .order('sort_order');
    allTiers = tiers ?? [];
  }

  // Fetch user notes
  const { data: notes } = await supabase
    .from('user_notes')
    .select('id, body, edited_at, created_at, author_id, author:profiles!user_notes_author_id_fkey(id, display_name)')
    .eq('target_user_id', userId)
    .order('created_at', { ascending: false });

  // Render markdown for notes
  const renderedNotes = await Promise.all(
    (notes ?? []).map(async (note) => ({
      ...note,
      htmlBody: await renderMarkdown(note.body),
      author: Array.isArray(note.author) ? note.author[0] : note.author,
    })),
  );

  const isDeleted = targetUser.display_name?.startsWith('Deleted User #') ?? false;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/agent" className="text-sm text-blue-600 hover:text-blue-800">
          ← Agent Dashboard
        </Link>
        {isAdmin && (
          <Link href="/admin/users" className="text-sm text-blue-600 hover:text-blue-800">
            ← User Management
          </Link>
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {targetUser.display_name ?? 'Unknown User'}
        {targetUser.is_blocked && (
          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            Blocked
          </span>
        )}
        {isDeleted && (
          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            Deleted
          </span>
        )}
      </h1>

      {/* User info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">User Information</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">Email</dt>
            <dd className="text-gray-900" data-testid="user-email">{targetUser.email}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Display Name</dt>
            <dd className="text-gray-900" data-testid="user-display-name">
              {targetUser.display_name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Role</dt>
            <dd className="text-gray-900 capitalize" data-testid="user-role">{targetUser.role}</dd>
          </div>
          {teamName && (
            <div>
              <dt className="text-gray-500">Team</dt>
              <dd className="text-gray-900" data-testid="user-team">{teamName}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Tickets</dt>
            <dd className="text-gray-900" data-testid="user-ticket-count">{ticketCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Member since</dt>
            <dd className="text-gray-900">
              {new Date(targetUser.created_at).toLocaleDateString()}
            </dd>
          </div>
          {tierInfo && (
            <div>
              <dt className="text-gray-500">Subscription Tier</dt>
              <dd className="text-gray-900" data-testid="user-tier">
                <span className={tierExpired ? 'text-gray-400 line-through' : ''}>
                  {tierInfo.display_name} ({tierInfo.key})
                </span>
                {targetUser.tier_expires_at && (
                  <span className={`ml-2 text-xs ${tierExpired ? 'text-red-500' : 'text-gray-500'}`}>
                    {tierExpired ? 'Expired' : 'Expires'} {new Date(targetUser.tier_expires_at).toLocaleDateString()}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6" data-testid="admin-user-actions">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Admin Actions</h2>
          <AdminUserActions
            userId={targetUser.id}
            isBlocked={targetUser.is_blocked}
            role={targetUser.role}
          />

          {/* Tier Assignment */}
          {allTiers.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200" data-testid="admin-tier-assignment">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Subscription Tier</h3>
              <form action={assignTier} className="flex items-end gap-3">
                <input type="hidden" name="user_id" value={targetUser.id} />
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Tier</label>
                  <select name="tier_id" defaultValue={targetUser.tier_id ?? 'none'} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="none">None</option>
                    {allTiers.map((t) => (
                      <option key={t.id} value={t.id}>{t.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Expires At (optional)</label>
                  <input
                    name="expires_at"
                    type="datetime-local"
                    defaultValue={targetUser.tier_expires_at ? new Date(targetUser.tier_expires_at).toISOString().slice(0, 16) : ''}
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                  Assign Tier
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* User Notes */}
      <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="user-notes-section">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          User Notes
          {renderedNotes.length > 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {renderedNotes.length}
            </span>
          )}
        </h2>

        <UserNoteForm targetUserId={userId} />

        {renderedNotes.length === 0 ? (
          <p className="text-sm text-gray-500 mt-4">No notes yet.</p>
        ) : (
          <div className="space-y-4 mt-4">
            {renderedNotes.map((note) => (
              <UserNoteItem
                key={note.id}
                noteId={note.id}
                targetUserId={userId}
                htmlBody={note.htmlBody}
                rawBody={note.body}
                authorName={note.author?.display_name ?? 'Unknown'}
                authorId={note.author_id}
                currentUserId={currentUser.id}
                isAdmin={isAdmin}
                createdAt={note.created_at}
                editedAt={note.edited_at}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
