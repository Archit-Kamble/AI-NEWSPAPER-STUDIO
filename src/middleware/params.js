// AN ID IN A URL IS CHECKED ONCE, AT THE DOOR.
//
// Controllers reach a row with `parseInt(req.params.id, 10)`. On anything that
// is not a number that is `NaN`, and `NaN` goes to PostgreSQL as the literal
// string "NaN", which answers:
//
//   error: invalid input syntax for type integer: "NaN"
//
// which the catch-all correctly reports as a 500. Swept across every route
// with a handful of ordinary bad ids - a stale bookmark, a truncated link, a
// typed URL - **888 of 2380 requests answered 500**. Every one of them is a
// desk told "something went wrong on the server" for a bad address, and a
// stack trace in a log for something that is not a fault in this software.
//
// Four shapes did it and they are all the same fault, so they get the same
// answer rather than thirty guards in thirty controllers:
//
//   /api/newspapers/abc                    NaN
//   /api/newspapers/99999999999999999999   out of range for type integer
//   /api/newspapers/null, /undefined       NaN (a client's own bug, arriving
//                                          as the string "null")
//   /api/newspapers/1.5                    parseInt truncates silently to 1,
//                                          so a wrong row is served instead
//
// Applied at the ROUTER, so a route added tomorrow is covered without anybody
// having to remember - the failure mode being guarded against is forgetting.

// PostgreSQL's `integer` is 32-bit signed. An id above this cannot name a row,
// so it is a bad request rather than a lookup that happens to miss.
const MAX_INT4 = 2147483647;

/** Whether this is a string that names a row: digits only, positive, in range. */
function isRowId(value) {
  const raw = String(value);
  if (!/^[0-9]{1,10}$/.test(raw)) return false;
  const id = Number(raw);
  return id >= 1 && id <= MAX_INT4;
}

/**
 * Registers the check on a router, for every id parameter it may carry.
 *
 * `router.use()` cannot do this: Express populates a route's own `req.params`
 * only when that route matches, so middleware mounted with `use` sees the
 * mount path's parameters and not the route's. `router.param()` is the
 * mechanism built for exactly this - it fires when a route carrying that name
 * matches, before the handler runs.
 *
 * The names are listed rather than discovered because `param` is registered by
 * name. Every id parameter in this application is here; the ones that are not
 * ids - `sectionKey`, `filename`, `format`, `token`, `key`, `status` - are
 * strings with their own checks where they are used.
 */
// `sectionId` is NOT in this list, and the name is why it nearly was: the
// routes call it `:sectionId` and it carries a section KEY. `update`, `remove`
// and the picture routes all hand it straight to
// `pageSectionService.saveSection(pageId, sectionKey, ...)` - the service's own
// parameter is named `sectionKey`, and `sectionImage.service.js` spells its
// signature `move(pageId, sectionKey, imageId, body)`. Guarding it as a number
// rejected every ordinary block save with a 400: `PUT /pages/94263/sections/
// feature-lead` is exactly what the editor sends. A key is a string in a
// VARCHAR column, so a bad one is a lookup that misses and answers 404, not a
// database type error.
const ID_PARAMS = ['id', 'pageId', 'newspaperId', 'imageId', 'guideId'];

function guardIdParams(router) {
  for (const name of ID_PARAMS) {
    router.param(name, (req, res, next, value) => {
      if (isRowId(value)) return next();
      return res.status(400).json({
        error: `"${String(value).slice(0, 40)}" is not a valid ${name}.`,
      });
    });
  }
  return router;
}

module.exports = { guardIdParams, isRowId, ID_PARAMS, MAX_INT4 };
