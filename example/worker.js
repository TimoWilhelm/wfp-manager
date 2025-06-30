export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/sql') {
      const returnValue = await env.SQLITE.prepare(`SELECT date('now');`).run();
      return Response.json(returnValue);
    }
    return env.ASSETS.fetch(request);
  }
}
