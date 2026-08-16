import { SetMetadata } from '@nestjs/common';

export const NO_ENVELOPE = 'noEnvelope';

// Opts a handler out of TransformInterceptor's { success, data } wrapper.
//
// Rare by design. The envelope is the contract for everything under /api/v1,
// and an endpoint outside it needs a reason — currently only GET /api/health,
// which serves @nestjs/terminus's own shape to the ECS health probe and is
// documented that way in api-reference.md.
//
// Reach for this only when something outside this codebase already depends on
// the response shape. "It reads nicer unwrapped" is not a reason.
export const NoEnvelope = () => SetMetadata(NO_ENVELOPE, true);
