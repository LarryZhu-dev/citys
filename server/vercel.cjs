'use strict';
// Native Vercel functions do not imply Next.js catch-all file conventions.
// vercel.json explicitly rewrites /api/:__path* into this one function, passing
// __path as a query parameter. Handle both Vercel's parsed query object and the
// rewritten URL so nested account/trade endpoints retain their route.
function vercelHandler(app) {
  return (request, response) => {
    let route = request.query?.__path;
    if (route === undefined) route = new URL(request.url, 'http://localhost').searchParams.get('__path');
    if (Array.isArray(route)) route = route.join('/');
    if (typeof route === 'string') {
      request.url = /^[A-Za-z0-9/_-]*$/.test(route) ? `/api/${route}` : '/api/invalid-route';
    }
    return app(request, response);
  };
}
module.exports = { vercelHandler };
