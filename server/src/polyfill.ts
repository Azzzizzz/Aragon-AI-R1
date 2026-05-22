import util from 'util'

// Patch a couple of legacy `util` helpers that some upstream deps (imghash,
// tfjs-node) still rely on. Node keeps the original implementations around
// but logs a DEP0051 / DEP0044 warning on every call. Force-replacing them
// with non-deprecating equivalents silences the warnings and is functionally
// identical. Must be imported BEFORE any other library.
/* eslint-disable @typescript-eslint/no-explicit-any */
const utilAny = util as any

utilAny.isNullOrUndefined = (val: any) => val === null || val === undefined
utilAny.isArray = Array.isArray
