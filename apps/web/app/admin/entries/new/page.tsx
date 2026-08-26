import { listDialects } from '../../../../lib/api/dictionary';
import { NewEntryForm } from './new-entry-form';

// The authoring form. CONTRIBUTOR+ like the rest of /admin — the layout
// establishes the session, and every route behind it authorizes independently
// from the token's subject, so the gate here is UX rather than security.
//
// Dialects are fetched server-side and handed down rather than loaded by the
// form: they are reference data, identical for every author, and fetching them
// in the component would put a loading state in front of a select that is
// never going to be empty.
export default async function NewEntryPage() {
  const dialects = await listDialects();

  return (
    <main className="p-6">
      <h1 className="mb-6 text-lg font-semibold">New entry</h1>
      <NewEntryForm dialects={dialects} />
    </main>
  );
}
