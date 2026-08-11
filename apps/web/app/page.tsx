// TODO(PLAN §13): real landing page — hero, dictionary search entry
// point, and course preview. This placeholder just proves the stack
// (App Router + Tailwind) renders.
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">Nahuat</h1>
      <p className="max-w-md text-center text-gray-600">
        Preserving the Nawat language of El Salvador. Coming soon.
      </p>
    </main>
  );
}
