import type { AdminMediaAsset, MediaStatus } from '@nahuat/shared';
import Link from 'next/link';

import { getMe } from '../../../lib/api/admin';
import { listMediaForReview } from '../../../lib/api/media';
import { PublishMediaButton, UnpublishMediaButton } from './review-buttons';

// The approval gate, as a page.
//
// ADMIN ONLY, AND CHECKED HERE. app/admin/layout.tsx gates CONTRIBUTOR or
// better, which is the right rank for the entry editor and the wrong one for
// this: publishing is ADMIN on the API, so for a contributor this is a work
// queue holding no work they can perform. Same reasoning that makes the
// pending-translations view admin-only in the entries list.
//
// Nothing here can be reached without it either — the API refuses — so this is
// UX rather than security, in the same sense the layout's gate is.

// The three questions a reviewer actually asks, in the order they ask them.
// The API defaults to the first, so `status`/`isPublished` are sent explicitly
// only where a view departs from it.
type View = {
  key: string;
  label: string;
  status: MediaStatus;
  isPublished: boolean;
  empty: string;
};

const VIEWS: View[] = [
  {
    key: 'awaiting',
    label: 'Awaiting review',
    status: 'READY',
    isPublished: false,
    empty: 'Nothing waiting. Uploads appear here once the processor has finished with them.',
  },
  {
    key: 'published',
    label: 'Published',
    status: 'READY',
    isPublished: true,
    empty: 'Nothing published yet.',
  },
  {
    key: 'failed',
    label: 'Failed',
    status: 'FAILED',
    isPublished: false,
    empty: 'Nothing has failed processing.',
  },
];

function href(view: View): string {
  return view.key === 'awaiting' ? '/admin/media' : `/admin/media?view=${view.key}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// What the asset claims to be, so a reviewer knows which word they are judging.
//
// An unattached asset is a legitimate state rather than an error: uploads are
// not attached at creation, and one may sit unattached indefinitely. It is
// shown plainly because it is also the reason the gate will refuse it.
function AttachedTo({ attachedTo }: { attachedTo: AdminMediaAsset['attachedTo'] }) {
  if (attachedTo === null) {
    return <span className="text-amber-700">Not attached to anything</span>;
  }

  return (
    <Link
      href={`/admin/entries/${encodeURIComponent(attachedTo.id)}/edit`}
      className="font-medium underline"
    >
      {attachedTo.nawatContent}
    </Link>
  );
}

// Played and shown through `previewUrl`, a short-lived presigned GET against
// the PENDING prefix — never through the CDN, which cannot address unapproved
// media at all. That is the whole point of the prefix split, and it is why a
// reviewer can hear a recording that no reader can reach.
//
// Null once published: the preview is signed against `pending/`, and a
// published asset is served from `public/` on the entry itself.
function Preview({ asset }: { asset: AdminMediaAsset }) {
  if (asset.previewUrl === null) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  if (asset.kind === 'AUDIO') {
    return <audio controls preload="none" src={asset.previewUrl} className="h-8 w-56" />;
  }

  // A presigned S3 URL expires in minutes and is unique per request, so
  // next/image would optimise and cache a URL that is dead before its cache
  // entry is — and route every reviewer's preview through the optimiser for an
  // image nobody but an admin will ever load.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={asset.previewUrl} alt="" className="h-16 w-auto rounded border border-gray-200" />
  );
}

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: requested } = await searchParams;
  const view = VIEWS.find((v) => v.key === requested) ?? VIEWS[0]!;

  const me = await getMe();
  if (me.role !== 'ADMIN') {
    return (
      <main className="p-6">
        <h1 className="text-lg font-semibold">Not permitted</h1>
        <p className="mt-2 max-w-prose text-sm text-gray-600">
          Reviewing media is an administrator&apos;s task. Recordings you upload appear here for an
          administrator to approve.
        </p>
        <Link href="/admin/entries" className="mt-4 inline-block text-sm underline">
          Back to entries
        </Link>
      </main>
    );
  }

  const assets = await listMediaForReview({ status: view.status, isPublished: view.isPublished });

  return (
    <main className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">Media</h1>
        <span className="text-sm text-gray-500">
          {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
        </span>
      </div>

      <nav className="mb-4 flex gap-4 border-b border-gray-200 text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href(v)}
            className={
              v.key === view.key
                ? '-mb-px border-b-2 border-gray-900 pb-2 font-medium text-gray-900'
                : 'pb-2 text-gray-500 hover:text-gray-900'
            }
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {assets.length === 0 ? (
        <p className="text-sm text-gray-600">{view.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 font-medium">Preview</th>
                <th className="py-2 pr-4 font-medium">For</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Uploaded by</th>
                <th className="py-2 pr-4 font-medium">Size</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-b border-gray-100 align-middle">
                  <td className="py-2 pr-4">
                    <Preview asset={asset} />
                  </td>
                  <td className="py-2 pr-4">
                    <AttachedTo attachedTo={asset.attachedTo} />
                    {/* Provenance, shown to the reviewer and to nobody else.
                        No public shape selects `notes`, so who is heard in a
                        recording never reaches an anonymous reader — see the
                        note in .claude/media-upload-ui.md. */}
                    {asset.notes && (
                      <p className="mt-1 max-w-prose text-xs text-gray-500">{asset.notes}</p>
                    )}
                    {asset.error && <p className="mt-1 text-xs text-red-700">{asset.error}</p>}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{asset.kind}</td>
                  <td className="py-2 pr-4 text-gray-600">
                    {asset.uploader.name ?? asset.uploader.email}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{formatBytes(asset.sizeBytes)}</td>
                  <td className="py-2">
                    {asset.isPublished ? (
                      <UnpublishMediaButton
                        assetId={asset.id}
                        label={asset.attachedTo?.nawatContent ?? asset.id}
                      />
                    ) : (
                      <PublishMediaButton
                        assetId={asset.id}
                        label={asset.attachedTo?.nawatContent ?? asset.id}
                        // The gate refuses an unattached asset, because approval
                        // writes a URL onto a parent and there is nowhere to put
                        // it. Said here rather than discovered by clicking.
                        disabledReason={
                          asset.attachedTo === null ? 'Attach it to an entry first' : null
                        }
                      />
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
