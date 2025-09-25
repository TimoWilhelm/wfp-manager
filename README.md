# Workers for Platforms Manager

This repository contains a sample project for using the [Direct Uploads API](https://developers.cloudflare.com/workers/static-assets/direct-upload/) for Workers for Platforms including [Static Assets](https://developers.cloudflare.com/workers/static-assets/).

It also provisions a D1 Database for the user and adds it as a binding to the user worker.

## Setup

Create a `.env` file with the following content:

```bash
CLOUDFLARE_ACCOUNT_ID=<YOUR_CLOUDFLARE_ACCOUNT_ID>
CLOUDFLARE_API_TOKEN=<YOUR_CLOUDFLARE_API_TOKEN>
```

## Test

Sample Worker

```js
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
```

Minified

```js
export default{async fetch(e,n){if("/sql"===new URL(e.url).pathname){const e=await n.SQLITE.prepare("SELECT date('now');").run();return Response.json(e)}return n.ASSETS.fetch(e)}};
```
