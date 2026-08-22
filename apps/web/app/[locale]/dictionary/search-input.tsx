'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// The one interactive piece of the browse page: a debounced search box that
// writes ?q= into the URL, so the RSC re-fetches server-side. The URL stays the
// source of truth (shareable, back-button-correct); this component only nudges
// it. type= and every other param are preserved; page resets, since a new query
// invalidates the old page number.
export function DictionarySearchInput({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(() => searchParams.get('q') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleChange(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = next.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      params.delete('page');
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
    }, 300);
  }

  return (
    <input
      type="search"
      value={value}
      onChange={(event) => handleChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-base outline-none focus:border-gray-500"
    />
  );
}
