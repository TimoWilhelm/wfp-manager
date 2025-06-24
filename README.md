# Workers for Platforms Manager

This repository contains a sample project for using the [Direct Uploads API](https://developers.cloudflare.com/workers/static-assets/direct-upload/) for Workers for Platforms including [Static Assets](https://developers.cloudflare.com/workers/static-assets/).

It also provisions a D1 Database for the user and adds it as a binding to the user worker.

## Setup

Create a `.dev.vars` file with the following content:

```
CLOUDFLARE_ACCOUNT_ID=<YOUR_CLOUDFLARE_ACCOUNT_ID>
CLOUDFLARE_API_TOKEN=<YOUR_CLOUDFLARE_API_TOKEN>
```
