import { createServerClient } from '@/lib/supabase/server';
import { addTeamMember, removeTeamMember } from '@/lib/actions/admin';
import { TeamsSurveyForm } from './TeamsSurveyForm';

export default async function AdminTeamsPage() {
  const supabase = await createServerClient();

  const { data: teams } = await supabase.from('teams').select('id, name').order('name');

  const teamsWithMembers = await Promise.all(
    (teams ?? []).map(async (team) => {
      const { data: members } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .eq('team_id', team.id)
        .order('display_name');
      return { ...team, members: members ?? [] };
    }),
  );

  const initial = (teams ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Teams</h1>
      <p className="text-sm text-gray-600 mb-4">
        Add, rename, or remove teams. Click <strong>Complete</strong> to save all changes. Teams with members cannot be removed.
      </p>

      <TeamsSurveyForm initial={initial} />

      <h2 className="text-lg font-medium text-gray-800 mt-8 mb-3">Team Members</h2>
      <div className="space-y-4">
        {teamsWithMembers.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-gray-500 text-sm">No teams defined.</p>
          </div>
        ) : (
          teamsWithMembers.map((team) => (
            <div key={team.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-medium text-gray-900">{team.name}</span>
                <span className="text-xs text-gray-500">
                  ({team.members.length} member{team.members.length !== 1 ? 's' : ''})
                </span>
              </div>

              {team.members.length === 0 ? (
                <p className="text-sm text-gray-500 mb-2">No members</p>
              ) : (
                <ul className="space-y-1 mb-3">
                  {team.members.map((member) => (
                    <li key={member.id} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-900">
                        {member.display_name ?? member.email}
                      </span>
                      <span className="text-gray-500 text-xs">{member.email}</span>
                      <form action={removeTeamMember} className="inline">
                        <input type="hidden" name="user_id" value={member.id} />
                        <button
                          type="submit"
                          className="text-xs text-red-500 hover:text-red-700"
                          aria-label={`Remove ${member.display_name ?? member.email} from team`}
                        >
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              <form action={addTeamMember} className="flex gap-2 items-end">
                <input type="hidden" name="team_id" value={team.id} />
                <div>
                  <label htmlFor={`add-member-${team.id}`} className="block text-xs font-medium text-gray-500 mb-1">
                    Add Member by Email
                  </label>
                  <input
                    id={`add-member-${team.id}`}
                    type="email"
                    name="email"
                    required
                    className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    placeholder="user@example.com"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  Add
                </button>
              </form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
