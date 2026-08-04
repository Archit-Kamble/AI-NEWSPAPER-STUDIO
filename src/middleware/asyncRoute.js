// Express 4 does not catch rejections from async handlers: the rejection goes
// unhandled and, on modern Node, takes the whole process down. A newsroom
// server must not be killed by one bad request - a malformed template key
// crashed it before this existed. Every async handler is wrapped so failures
// reach the error middleware in server.js instead.

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Wraps every function on a controller object in one call, so a new handler
// cannot be added and forgotten.
function asyncController(controller) {
  return Object.fromEntries(
    Object.entries(controller).map(([name, fn]) => [name, typeof fn === 'function' ? asyncRoute(fn) : fn]),
  );
}

module.exports = { asyncRoute, asyncController };
