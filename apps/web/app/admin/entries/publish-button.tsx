'use client';

import { useState, useTransition } from 'react';

import { publishEntryAction } from './actions';

// The one interactive element on the page.
//
// useTransition rather than a bare async handler: it keeps the pending state
// tied to the revalidation that follows the action, so the button stays
// disabled until the refreshed list has actually rendered rather than
// re-enabling the instant the request returns.
export function PublishButton({ id, nawatContent }: { id: string; nawatContent: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button
        type="button"
        disabled={pending}
        aria-label={`Publish ${nawatContent}`}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await publishEntryAction(id);
            if (!result.ok) setError(result.message);
          })
        }
        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  );
}
