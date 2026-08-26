'use client';

import { useState, useTransition } from 'react';

import { unpublishEntryAction } from './actions';

// Taking an entry back off the public dictionary.
//
// A separate component from PublishButton rather than a shared toggle, because
// the two are not symmetrical in the way that matters here: publishing adds
// something readers can see, and unpublishing REMOVES something they may
// already be reading. That asymmetry earns the confirmation step, and a single
// parameterised button would either impose it on both or on neither.
export function UnpublishButton({ id, nawatContent }: { id: string; nawatContent: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const unpublish = () =>
    startTransition(async () => {
      setError(null);
      const result = await unpublishEntryAction(id);
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
      }
      // On success the row leaves this view with the revalidated list, so there
      // is no state left to reset.
    });

  if (!confirming) {
    return (
      <button
        type="button"
        disabled={pending}
        aria-label={`Unpublish ${nawatContent}`}
        onClick={() => setConfirming(true)}
        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        Unpublish
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button
        type="button"
        disabled={pending}
        aria-label={`Confirm unpublishing ${nawatContent}`}
        onClick={unpublish}
        className="rounded border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? 'Unpublishing…' : 'Confirm'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(false)}
        className="text-xs text-gray-500 hover:underline disabled:opacity-50"
      >
        Cancel
      </button>
    </span>
  );
}
