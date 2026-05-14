import util from 'util'

// Polyfill for Node 24 compatibility (imghash or other legacy libs)
// This must be imported BEFORE any other library.
if (!(util as any).isNullOrUndefined) {
  (util as any).isNullOrUndefined = (val: any) => val === null || val === undefined
}
