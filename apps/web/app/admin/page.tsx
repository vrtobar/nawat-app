import { redirect } from 'next/navigation';

// /admin had no page, so the panel's own root was a 404 and the wordmark had to
// point at one of its sections instead. Entries is the landing section because
// it is the only one every contributor can use; media is admin-only today.
//
// A redirect rather than a dashboard: there is nothing to summarise that the
// entries list does not already show, and a page invented to justify a URL is
// how a panel acquires a screen nobody reads.
export default function AdminIndexPage() {
  redirect('/admin/entries');
}
