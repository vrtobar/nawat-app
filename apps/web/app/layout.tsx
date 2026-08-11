import './globals.css';

import type { Metadata } from 'next';

// TODO(PLAN §13): fonts (next/font), TanStack Query provider, and the
// (public)/(app)/(admin) route-group shells land as features are built.
export const metadata: Metadata = {
  title: {
    default: 'Nahuat — Learn the Nawat language',
    template: '%s | Nahuat',
  },
  description:
    'Learn Nawat, the indigenous language of El Salvador — dictionary, lessons, and spaced-repetition review.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
