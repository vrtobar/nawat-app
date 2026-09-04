import type { AdminMediaAsset, MediaAttachment, MediaStatus, UploadListItem } from '@nahuat/shared';
import Link from 'next/link';

import { getMe } from '../../../lib/api/admin';
import { listMediaForReview, listUploads } from '../../../lib/api/media';
import { PublishMediaButton, UnpublishMediaButton } from './review-buttons';

// The Media section.
//
// ONE SECTION, WITH REVIEW AS A TAB INSIDE IT — settled deliberately over two
// top-level destinations. The top nav answers "where am I" and tabs answer
// "which slice", so a role-gated VIEW is a hidden tab rather than a second nav
// item; the entries list already hides "Pending translations" from non-admins
// exactly this way, and a second mechanism would be doing the same job.
//
// The page therefore gates PER TAB rather than as a whole. Problems is
// CONTRIBUTOR+ because a failed or orphaned upload is something its uploader
// can act on; the review tabs are ADMIN because publishing is ADMIN on the API.
//
// A contributor who edits the URL to an admin tab lands on the default rather
// than a refusal — the gate that matters is the API's, and this one exists so
// nobody is shown a queue holding no work they can perform.

type View = {
  key: string;
  label: string;
  empty: string;
  adminOnly: boolean;
  // Present on the review tabs only: the query the API answers for them.
  query?: { status: MediaStatus; isPublished: boolean };
};

const VIEWS: View[] = [
  {
    key: 'problems',
    label: 'Problems',
    adminOnly: false,
    empty:
      'Nothing to fix. Uploads that fail processing, or that never reached an entry, appear here.',
  },
  {
    key: 'awaiting',
    label: 'Awaiting review',
    adminOnly: true,
    query: { status: 'READY', isPublished: false },
    empty: 'Nothing waiting. Uploads appear here once the processor has finished with them.',
  },
  {
    key: 'published',
    label: 'Published',
    adminOnly: true,
    query: { status: 'READY', isPublished: true },
    empty: 'Nothing published yet.',
  },
];

function href(key: string): string {
  return key === 'problems' ? '/admin/media' : `/admin/media?view=${key}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// What the asset claims to be, so a reviewer knows which word they are judging
// and an uploader can see which of theirs never landed.
//
// An unattached asset is a legitimate state rather than an error: uploads are
// not attached at creation and one may sit unattached indefinitely. It is
// called out because it is also the reason the gate will refuse it.
function AttachedTo({ attachedTo }: { attachedTo: MediaAttachment }) {
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

// Provenance, shown to whoever can act on the asset and to nobody else. No
// public shape selects `notes`, so who is heard in a recording never reaches an
// anonymous reader — see .claude/media-upload-ui.md.
//
// Rendered as a block rather than a tooltip: it is the only record of who is
// heard and when, and a tooltip is unreachable on a touch screen and awkward
// for a keyboard.
function Notes({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return <p className="mt-1 max-w-prose whitespace-pre-line text-xs text-gray-500">{notes}</p>;
}

// Played through `previewUrl`, a short-lived presigned GET against the PENDING
// prefix — never through the CDN, which cannot address unapproved media at all.
// That is what the prefix split buys: a reviewer can hear a recording no reader
// can reach.
function Preview({ asset }: { asset: AdminMediaAsset }) {
  if (asset.previewUrl === null) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  if (asset.kind === 'AUDIO') {
    return <audio controls preload="none" src={asset.previewUrl} className="h-8 w-56" />;
  }

  // A presigned S3 URL expires in minutes and is unique per request, so
  // next/image would optimise and cache a URL that is dead before its cache
  // entry is.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={asset.previewUrl} alt="" className="h-16 w-auto rounded border border-gray-200" />
  );
}

// The uploader's own trouble list: processing that failed, and uploads that
// never reached an entry. Both are things a contributor can fix, which is why
// this tab is not admin-only.
//
// Filtered here rather than by the API because `GET /uploads` takes no
// parameters — it returns the caller's whole history, which for one person's
// uploads is a set small enough that a predicate in the page costs nothing and
// a query parameter would be a route change bought for no gain.
function problemRows(uploads: UploadListItem[]): UploadListItem[] {
  return uploads.filter((u) => u.status === 'FAILED' || u.attachedTo === null);
}

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const me = await getMe();
  const isAdmin = me.role === 'ADMIN';
  const visible = VIEWS.filter((v) => !v.adminOnly || isAdmin);

  const { view: requested } = await searchParams;
  const view = visible.find((v) => v.key === requested) ?? visible[0]!;

  const [uploads, reviewable] = await Promise.all([
    view.query ? Promise.resolve([]) : listUploads(),
    view.query ? listMediaForReview(view.query) : Promise.resolve([]),
  ]);

  const rows = view.query ? reviewable : problemRows(uploads);

  return (
    <main className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">Media</h1>
        <span className="text-sm text-gray-500">
          {rows.length} {rows.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <nav className="mb-4 flex gap-4 border-b border-gray-200 text-sm">
        {visible.map((v) => (
          <Link
            key={v.key}
            href={href(v.key)}
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

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">{view.empty}</p>
      ) : view.query ? (
        <ReviewTable assets={reviewable} />
      ) : (
        <ProblemsTable uploads={problemRows(uploads)} />
      )}
    </main>
  );
}

function ReviewTable({ assets }: { assets: AdminMediaAsset[] }) {
  return (
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
                <Notes notes={asset.notes} />
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
                    // writes a URL onto a parent and there is nowhere to put it.
                    // Said here rather than discovered by clicking.
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
  );
}

function ProblemsTable({ uploads }: { uploads: UploadListItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-4 font-medium">What is wrong</th>
            <th className="py-2 pr-4 font-medium">For</th>
            <th className="py-2 pr-4 font-medium">Kind</th>
            <th className="py-2 pr-4 font-medium">Size</th>
            <th className="py-2 font-medium">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((upload) => (
            <tr key={upload.id} className="border-b border-gray-100 align-top">
              <td className="py-2 pr-4">
                {upload.status === 'FAILED' ? (
                  <>
                    <span className="text-red-700">Processing failed</span>
                    {upload.error && (
                      <p className="mt-1 max-w-prose text-xs text-red-700">{upload.error}</p>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-amber-700">Never attached</span>
                    {/* An orphan is only reachable from here, so it has to say
                        what to do about it. Attaching happens in the editor,
                        against the translation that needs the recording. */}
                    <p className="mt-1 max-w-prose text-xs text-gray-500">
                      Upload it again from the entry it belongs to, or leave it — nothing serves an
                      unattached file.
                    </p>
                  </>
                )}
              </td>
              <td className="py-2 pr-4">
                <AttachedTo attachedTo={upload.attachedTo} />
                <Notes notes={upload.notes} />
              </td>
              <td className="py-2 pr-4 text-gray-600">{upload.kind}</td>
              <td className="py-2 pr-4 text-gray-600">{formatBytes(upload.sizeBytes)}</td>
              <td className="py-2 text-gray-600">
                {new Date(upload.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
