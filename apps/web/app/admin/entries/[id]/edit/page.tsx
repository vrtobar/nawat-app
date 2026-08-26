import { notFound } from 'next/navigation';

import { getAdminEntry, getMe } from '../../../../../lib/api/admin';
import { ApiError } from '../../../../../lib/api/client';
import { listDialects } from '../../../../../lib/api/dictionary';
import { EntryEditor } from './entry-editor';

type Params = { id: string };

// The editor behind a row in the draft queue.
//
// A 404 here means either "no such entry" or "not yours" and the page cannot
// tell which — the API answers both the same way on purpose, so that an
// endpoint scoped to its caller is not also an existence oracle. notFound() is
// the honest rendering of what is known.
export default async function EditEntryPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;

  let entry;
  try {
    entry = await getAdminEntry(id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'ENTRY_NOT_FOUND')) {
      notFound();
    }
    throw error;
  }

  // Fetched after the entry rather than alongside it: both are only needed if
  // the entry resolved, and a 404 should not also pay for two requests whose
  // results are discarded.
  const [me, dialects] = await Promise.all([getMe(), listDialects()]);

  return (
    <main className="p-6">
      <h1 className="mb-6 text-lg font-semibold">{entry.nawatContent}</h1>
      <EntryEditor entry={entry} dialects={dialects} me={me} />
    </main>
  );
}
