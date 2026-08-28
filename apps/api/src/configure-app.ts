import { type INestApplication, VersioningType } from '@nestjs/common';

// Everything about how routes are ADDRESSED, in one place so that main.ts and
// the HTTP tests configure an application the same way.
//
// WHY THIS IS NOT JUST INLINE IN main.ts, where it used to be: a test that
// restates the prefix and versioning proves only that it agrees with itself. It
// would keep passing after main.ts changed, and the first sign of trouble would
// be every route 404ing in a deployed environment while the suite stayed green.
// Sharing the function means a change here reaches both.
//
// Deliberately NOT here: CORS, which needs ConfigService and is not part of
// addressing, and the global guard, interceptor and filter, which are providers
// in AppModule so they can take constructor dependencies.
export function configureApp(app: INestApplication): void {
  // All routes under /api, versioned as /api/v1/... — the health controller
  // opts out with VERSION_NEUTRAL, because ECS probes /api/health.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
