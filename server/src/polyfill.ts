import util from 'util'

// Polyfill for Node 24 compatibility (imghash or other legacy libs).
// Must be imported BEFORE any other library. Patching a private util method
// legitimately requires `any`.
/* eslint-disable @typescript-eslint/no-explicit-any */
if (!(util as any).isNullOrUndefined) {
  (util as any).isNullOrUndefined = (val: any) => val === null || val === undefined
}
