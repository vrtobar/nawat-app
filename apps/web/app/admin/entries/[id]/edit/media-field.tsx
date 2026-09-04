'use client';

import {
  ACCEPTED_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
  type MediaKind,
  type MediaStatus,
} from '@nahuat/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { completeUploadAction, presignUploadAction, uploadStatusAction } from './actions';

// The upload widget, for the image on an entry and the audio on each
// translation card.
//
// OUTSIDE THE CARD'S OPTIMISTIC LOCK, and that is a rule rather than an
// oversight. Attaching sets a foreign key and does not move the parent's
// `updatedAt` (docs/adr/0020), so there is no version to contend for — this
// component never reads or advances `expectedUpdatedAt`, has no Save, and
// uploading a recording while someone edits a gloss is not a conflict. Making
// it one would be the easiest possible mistake here.
//
// THE ORDER IS UPLOAD, COMPLETE, ATTACH, THEN WAIT — attaching before the
// transcode finishes rather than after. `audioStatus` lives on the parent row's
// asset, so it reads null until something is attached: an asset left detached
// while it processes is invisible to this widget, which would render "nothing
// here" over an upload in flight and invite a second one. Attachment is
// deliberately order-independent, so attaching early is allowed, and it is what
// makes the state survive a reload.

// How long to keep polling before offering the decision to a person. The first
// upload of a session pays the Lambda cold start — 26.6s measured against 2.3s
// warm — so a short timeout reports the first recording of every session as
// broken. Past the ceiling this offers a re-check rather than declaring
// failure, because "still working" and "broken" look identical from here.
const POLL_INTERVAL_MS = 2000;
const POLL_CEILING_MS = 60_000;

type Phase =
  | { name: 'idle' }
  | { name: 'uploading'; progress: number }
  | { name: 'processing' }
  | { name: 'attaching' }
  | { name: 'stalled' };

export type MediaActionResult = { ok: true } | { ok: false; message: string };

// The PUT to S3, and the ONLY request in this whole path that does not go
// through a Server Action — it goes from the browser straight to the presigned
// URL, which is what presigning is for.
//
// XHR RATHER THAN fetch, for one reason: fetch cannot report upload progress.
// The cap is 10MB and contributors will be on phone tethers in the field, where
// a progress bar is the difference between waiting and reloading.
//
// The headers arrive already filtered — presignUploadAction strips
// `Content-Length`, which is a forbidden header name that XHR refuses to set
// and the browser writes from the body regardless.
function putToS3(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (fraction: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open('PUT', url, true);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : // S3 answers with an XML error document. It is not shown: the useful
          // cases are a signature mismatch and an expired URL, and neither is
          // actionable by the person holding the file.
          reject(new Error(`The upload was rejected (${xhr.status})`));
    xhr.onerror = () => reject(new Error('The upload could not reach storage'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(file);
  });
}

export function MediaField({
  kind,
  noun,
  status,
  url,
  error,
  savedNotes,
  disabled = false,
  attachAction,
  detachAction,
}: {
  kind: MediaKind;
  // "recording" or "image" — this component words its own messages, and the
  // two read badly if forced through one noun.
  noun: string;
  // From the admin detail shape. Null means nothing is attached, which is a
  // different thing from an attached asset with no URL yet — the distinction
  // PR #96 added the field to make.
  status: MediaStatus | null;
  url: string | null;
  error: string | null;
  // The provenance written when this was uploaded. Read-only here: it is set at
  // presign and there is no route to change it, so showing an editable box
  // would offer a save that cannot happen.
  savedNotes: string | null;
  disabled?: boolean;
  attachAction: (assetId: string) => Promise<MediaActionResult>;
  detachAction: () => Promise<MediaActionResult>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [failure, setFailure] = useState<string | null>(null);

  // Known only for an asset THIS session uploaded. The admin shapes carry no
  // asset id on purpose (#96), so a page reloaded mid-transcode can see
  // PENDING and not know which asset to poll. That case gets a re-check button
  // instead, which is why this is allowed to be null while status is PENDING.
  const [assetId, setAssetId] = useState<string | null>(null);

  // Provenance, typed before the file is chosen and sent with the presign,
  // which is where the row is created and the only moment it can be recorded —
  // there is no route to edit a note afterwards. Held here rather than in the
  // file input's onChange because the upload starts the instant a file is
  // picked, so anything typed after that would have nowhere to go.
  const [notes, setNotes] = useState('');

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      xhrRef.current?.abort();
    };
  }, []);

  // Polls one asset to READY or FAILED, then hands the answer back. Resolves
  // null at the ceiling, which is "still unknown" rather than "failed".
  const pollUntilSettled = useCallback(async (id: string): Promise<MediaStatus | null> => {
    const deadline = Date.now() + POLL_CEILING_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!liveRef.current) return null;

      const result = await uploadStatusAction(id);
      // A failed poll is not a failed upload — the transcode is happening on a
      // Lambda regardless of whether this tab can reach the API. Keep waiting.
      if (result.ok && result.status !== 'PENDING' && result.status !== 'AWAITING_UPLOAD') {
        return result.status;
      }
    }
    return null;
  }, []);

  const start = useCallback(
    async (file: File) => {
      setFailure(null);

      // Validated against the same constants the API enforces, so the boundary
      // the form reports is the boundary that exists. Both are checked before
      // presigning: the type and size are SIGNED into the URL, so a mismatch
      // would otherwise surface as an opaque S3 rejection after the bytes were
      // already on the wire.
      const accepted: Record<string, string> = ACCEPTED_MEDIA_TYPES[kind];
      if (!(file.type in accepted)) {
        setFailure(
          `${file.type || 'That file type'} cannot be used here. Accepted: ${Object.keys(accepted).join(', ')}.`,
        );
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setFailure(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`,
        );
        return;
      }

      setPhase({ name: 'uploading', progress: 0 });

      const presigned = await presignUploadAction({
        kind,
        contentType: file.type,
        sizeBytes: file.size,
        // Omitted when blank rather than sent as "": the API stores null for
        // absent, and an empty string would be a second way to say the same
        // thing.
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
      if (!presigned.ok) {
        setPhase({ name: 'idle' });
        setFailure(presigned.message);
        return;
      }
      setAssetId(presigned.assetId);

      try {
        await putToS3(
          presigned.uploadUrl,
          presigned.headers,
          file,
          (fraction) => setPhase({ name: 'uploading', progress: fraction }),
          (xhr) => (xhrRef.current = xhr),
        );
      } catch (cause) {
        if (!liveRef.current) return;
        setPhase({ name: 'idle' });
        // The asset stays AWAITING_UPLOAD, which is exactly the set the reaper
        // collects after 24 hours. Nothing to clean up from here — and nothing
        // on the request path may delete a source object anyway.
        setFailure(cause instanceof Error ? cause.message : 'The upload failed');
        return;
      }
      if (!liveRef.current) return;

      const completed = await completeUploadAction(presigned.assetId);
      if (!completed.ok) {
        setPhase({ name: 'idle' });
        setFailure(completed.message);
        return;
      }

      // Attached before the transcode finishes, so the parent row carries a
      // status the editor can render even if this tab goes away.
      setPhase({ name: 'attaching' });
      const attached = await attachAction(presigned.assetId);
      if (!attached.ok) {
        setPhase({ name: 'idle' });
        setFailure(attached.message);
        return;
      }
      if (!liveRef.current) return;

      setPhase({ name: 'processing' });
      const settled = await pollUntilSettled(presigned.assetId);
      if (!liveRef.current) return;

      setPhase(settled === null ? { name: 'stalled' } : { name: 'idle' });
      // Either way the server has more recent truth than this component does.
      router.refresh();
    },
    [attachAction, kind, notes, pollUntilSettled, router],
  );

  const detach = useCallback(async () => {
    setFailure(null);
    const result = await detachAction();
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setAssetId(null);
    setPhase({ name: 'idle' });
  }, [detachAction]);

  // ---------------------------------------------------------------------------

  const busy = phase.name !== 'idle' && phase.name !== 'stalled';

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{noun}</span>
        {status !== null && !busy && !disabled && (
          <button
            type="button"
            onClick={detach}
            className="text-xs text-gray-500 hover:text-red-700"
          >
            Remove
          </button>
        )}
      </div>

      <div className="mt-2">
        {phase.name === 'uploading' && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200">
              <div
                className="h-full bg-gray-800 transition-[width]"
                style={{ width: `${Math.round(phase.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-600">
              Uploading — {Math.round(phase.progress * 100)}%
            </p>
          </div>
        )}

        {phase.name === 'attaching' && <p className="text-xs text-gray-600">Attaching…</p>}

        {(phase.name === 'processing' || (!busy && status === 'PENDING')) && (
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-600">
              Processing — this takes up to half a minute for the first one.
            </p>
            {/* No asset id after a reload, so nothing can be polled: re-render
                from the server instead, which is where the status lives. */}
            {!busy && assetId === null && (
              <button
                type="button"
                onClick={() => router.refresh()}
                className="text-xs underline hover:text-gray-900"
              >
                Check again
              </button>
            )}
          </div>
        )}

        {phase.name === 'stalled' && (
          <div className="flex items-center gap-3">
            <p className="text-xs text-amber-700">
              Still processing. It has not failed — nothing here can tell the difference yet.
            </p>
            <button
              type="button"
              onClick={() => {
                setPhase({ name: 'idle' });
                router.refresh();
              }}
              className="text-xs underline hover:text-gray-900"
            >
              Check again
            </button>
          </div>
        )}

        {!busy && phase.name !== 'stalled' && status === 'FAILED' && (
          <p className="text-xs text-red-700">
            Processing failed{error ? `: ${error}` : '.'} Remove it and upload again.
          </p>
        )}

        {!busy && status === 'READY' && url === null && (
          <p className="text-xs text-gray-600">
            Ready, waiting for an administrator to approve it. Not yet on the dictionary.
          </p>
        )}

        {!busy && url !== null && (
          <div className="flex items-center gap-3">
            {kind === 'AUDIO' ? (
              <audio controls preload="none" src={url} className="h-8 w-56" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-16 w-auto rounded border border-gray-200" />
            )}
            <span className="text-xs text-gray-500">Published</span>
          </div>
        )}

        {!busy && status === null && !disabled && (
          <label className="mb-2 block">
            <span className="text-xs text-gray-500">Notes (optional)</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Who is heard, when it was recorded, and on what"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
        )}

        {!busy && status === null && (
          <label
            className={
              disabled
                ? 'text-xs text-gray-400'
                : 'inline-block cursor-pointer rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium hover:bg-gray-50'
            }
          >
            {disabled ? `Published — an administrator can change the ${noun}` : `Add a ${noun}`}
            {!disabled && (
              <input
                type="file"
                className="hidden"
                accept={Object.keys(ACCEPTED_MEDIA_TYPES[kind]).join(',')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so choosing the SAME file after a failure fires
                  // change again — otherwise a retry looks like a dead button.
                  event.target.value = '';
                  if (file) void start(file);
                }}
              />
            )}
          </label>
        )}
      </div>

      {/* Shown wherever a recording is attached, in every state — a note about a
          FAILED asset is exactly what tells you whether re-recording means
          going back to the same speaker. A block rather than a tooltip: it is
          the only record of who is heard, and a tooltip cannot be reached on a
          touch screen or from a keyboard. */}
      {status !== null && savedNotes && (
        <p className="mt-2 max-w-prose whitespace-pre-line border-l-2 border-gray-200 pl-2 text-xs text-gray-500">
          {savedNotes}
        </p>
      )}

      {failure && <p className="mt-2 text-xs text-red-700">{failure}</p>}
    </div>
  );
}
