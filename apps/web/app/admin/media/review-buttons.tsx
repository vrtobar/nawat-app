'use client';

import { useState, useTransition } from 'react';

import { publishMediaAction, unpublishMediaAction } from './actions';

// useTransition rather than a bare async handler, matching publish-button.tsx:
// it holds the pending state across the revalidation that follows, so the
// button stays disabled until the refreshed queue has rendered instead of
// re-enabling the moment the request returns and inviting a second click on a
// row that is already gone.

export function PublishMediaButton({
  assetId,
  label,
  disabledReason,
}: {
  assetId: string;
  label: string;
  // Non-null when the gate would refuse. Rendered as the reason rather than as
  // a disabled button with no explanation: an unattached asset looks perfectly
  // publishable in this table, and "nothing happens" is the worst answer.
  disabledReason: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (disabledReason !== null) {
    return <span className="text-xs text-gray-500">{disabledReason}</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button
        type="button"
        disabled={pending}
        aria-label={`Publish ${label}`}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await publishMediaAction(assetId);
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

export function UnpublishMediaButton({ assetId, label }: { assetId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button
        type="button"
        disabled={pending}
        aria-label={`Unpublish ${label}`}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await unpublishMediaAction(assetId);
            if (!result.ok) setError(result.message);
          })
        }
        className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? 'Removing…' : 'Unpublish'}
      </button>
    </div>
  );
}
