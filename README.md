# Workers for Platforms Manager

This repository contains a sample project for using the [Direct Uploads API](https://developers.cloudflare.com/workers/static-assets/direct-upload/) for Workers for Platforms including [Static Assets](https://developers.cloudflare.com/workers/static-assets/).

It also provisions a D1 Database for the user and adds it as a binding to the user worker.

## Setup

Create a `.dev.vars` file with the following content:

```
CLOUDFLARE_ACCOUNT_ID=<YOUR_CLOUDFLARE_ACCOUNT_ID>
CLOUDFLARE_API_TOKEN=<YOUR_CLOUDFLARE_API_TOKEN>
```

## Test

You can send a request to `/upload` to upload a worker script to the Cloudflare Workers ofr Platforms namespace. To access this worker you must create a [dynamic dispatch Worker](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/get-started/dynamic-dispatch/).

```curl
POST https://localhost:8787.upload HTTP/1.1
content-type: application/json

{
  "mainFileName": "index.js",
  "files": [
    {
      "name": "index.js",
      "content": <minified worker script>,
      "type": "application/javascript+module"
    }
  ]
}
```

A sample Worker script to test the D1 Database and Static Assets could look like this:

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
