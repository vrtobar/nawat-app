import type { Metadata } from 'next';

// Pass-through root. The <html lang> carries the request's locale, which is only
// known inside [locale], so app/[locale]/layout.tsx renders <html>/<body> and
// imports the stylesheet. Next still requires a root layout to exist; this is
// it, and it only sets the metadata defaults that apply across every locale.
export const metadata: Metadata = {
  title: {
    default: 'Nahuat — Learn the Nawat language',
    template: '%s | Nahuat',
  },
  description:
    'Learn Nawat, the indigenous language of El Salvador — dictionary, lessons, and spaced-repetition review.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
