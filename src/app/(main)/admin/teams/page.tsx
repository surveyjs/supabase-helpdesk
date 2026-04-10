import { createServerClient } from '@/lib/supabase/server';
import {
  createTeam,
  renameTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
} from '@/lib/actions/admin';

export default async function AdminTeamsPage() {
  const supabase = await createServerClient();

  const { data: teams } = await supabase.from('teams').select('id, name').order('name');

  // Get member counts and member details for each team
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

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Teams</h1>

      <div className="space-y-4 mb-6">
        {teamsWithMembers.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-gray-500 text-sm">No teams defined.</p>
          </div>
        ) : (
          teamsWithMembers.map((team) => (
            <div key={team.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-sm font-medium text-gray-900">{team.name}</span>
                <span className="text-xs text-gray-500">
                  ({team.members.length} member{team.members.length !== 1 ? 's' : ''})
                </span>

                {/* Rename */}
                <form action={renameTeam} className="flex gap-1 items-center">
                  <input type="hidden" name="team_id" value={team.id} />
                  <input
                    type="text"
                    name="name"
                    defaultValue={team.name}
                    maxLength={100}
                    className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    aria-label={`Rename ${team.name}`}
                  />
                  <button type="submit" className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700">
                    Rename
                  </button>
                </form>

                {/* Delete */}
                <form action={deleteTeam}>
                  <input type="hidden" name="team_id" value={team.id} />
                  <button
                    type="submit"
                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    aria-label={`Delete ${team.name}`}
                  >
                    Delete
                  </button>
                </form>
              </div>

              {/* Members */}
              <details open>
                <summary className="text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer mb-2">
                  Members
                </summary>
                {team.members.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-2">No members</p>
                ) : (
                  <ul className="space-y-1 mb-3">
                    {team.members.map((member) => (
                      <li key={member.id} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-900">
                          {member.display_name ?? member.email}
                        </span>
                        <span className="text-gray-400 text-xs">{member.email}</span>
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

                {/* Add member */}
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
              </details>
            </div>
          ))
        )}
      </div>

      {/* Create new team */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Create New Team</h2>
        <form action={createTeam} className="flex gap-2 items-end">
          <div>
            <label htmlFor="new-team-name" className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              id="new-team-name"
              type="text"
              name="name"
              maxLength={100}
              required
              className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Team name…"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Create Team
          </button>
        </form>
      </div>
    </div>
  );
}
