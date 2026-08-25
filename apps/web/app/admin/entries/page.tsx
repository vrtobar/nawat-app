import { getMe, listAdminEntries } from '../../../lib/api/admin';
import { PublishButton } from './publish-button';

// Drafts, newest edit first — the queue the panel exists to work through.
//
// Deliberately read-only apart from publishing. The editor is the next slice;
// this one proves the path a token takes from the session to the API and back,
// on a screen that survives into the finished panel rather than scaffolding
// thrown away afterwards.
export default async function AdminEntriesPage() {
  // Both are authenticated calls; the layout already established there is a
  // session, so a failure here is a genuine error rather than a signed-out user.
  const [me, drafts] = await Promise.all([getMe(), listAdminEntries({ status: 'draft' })]);

  const canPublish = me.role === 'ADMIN';

  return (
    <main className="p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Drafts</h1>
        <span className="text-sm text-gray-500">
          {drafts.meta.total} {drafts.meta.total === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {drafts.data.length === 0 ? (
        // Not an error state. An empty queue is the normal steady state, and
        // for a contributor it also means "none of yours" rather than "none at
        // all" — the API scopes the list to its caller.
        <p className="text-sm text-gray-600">
          No drafts. Entries you create appear here until they are published.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 font-medium">Headword</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Translations</th>
                <th className="py-2 pr-4 font-medium">English</th>
                <th className="py-2 pr-4 font-medium">Last edited</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {drafts.data.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-medium">{entry.nawatContent}</td>
                  <td className="py-2 pr-4 text-gray-600">{entry.type}</td>
                  <td className="py-2 pr-4 text-gray-600">{entry.translationCount}</td>
                  {/* Informational, never a gate: ADR 0015 §2 exempts dictionary
                      entries from the English-to-publish rule, so an entry with
                      Spanish alone publishes fine. */}
                  <td className="py-2 pr-4 text-gray-600">
                    {entry.hasEnglish ? 'Complete' : 'Missing'}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    {canPublish && (
                      <PublishButton id={entry.id} nawatContent={entry.nawatContent} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
