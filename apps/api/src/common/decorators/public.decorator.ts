import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

// Opts a handler out of the global JwtAuthGuard.
//
// The guard is global so that authentication is the default and exposure is
// the explicit act. A new controller added without any decorator is protected;
// forgetting @Public() produces a 401 in development, while the opposite
// default would leak an endpoint silently.
//
// Every use is a decision to serve something to the unauthenticated internet.
export const Public = () => SetMetadata(IS_PUBLIC, true);
