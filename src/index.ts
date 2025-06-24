import { Hono } from 'hono';
import { AssetManifest, ScriptUpload } from './script-upload';
import crypto from 'crypto';
import { Resources } from './resources';

const app = new Hono<{ Bindings: Env }>();

const namespace = 'tiwi';
const workerName = 'customer-worker-1';
const user = 'customer-1';

app.get('/', async (c) => {
	const scriptUpload = new ScriptUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

	const sampleAssetContent = 'Howdy!';
	const sampleAssetFileName = '/hello_world.txt'; // make sure this is a valid path beginning with `/`
	const sampleAssetContentType = 'text/plain';

	const sampleAssetBuffer = Buffer.from(sampleAssetContent);
	const sampleAssetHash = crypto.createHash('sha256').update(sampleAssetContent).digest('hex').slice(0, 32);

	const manifest = {
		[sampleAssetFileName]: {
			hash: sampleAssetHash,
			size: sampleAssetBuffer.length,
		},
	} satisfies AssetManifest;

	const uploadInfo = await scriptUpload.createAssetsUpload(namespace, workerName, manifest);

	let assetsToken: string | undefined;

	if (uploadInfo !== null) {
		console.log('Uploading Assets');

		try {
			assetsToken = await scriptUpload.uploadFilesBatch(
				uploadInfo,
				new Map([
					[
						sampleAssetHash,
						{
							fileName: sampleAssetFileName,
							data: sampleAssetBuffer,
							type: sampleAssetContentType,
						},
					],
				])
			);
		} catch (error) {
			console.error(error);
		}
	}

	const worker = `
	export default {
		async fetch(request, env) {
			const url = new URL(request.url);
			if (url.pathname === '/sql') {
				const returnValue = await env.SQLITE.prepare(\`SELECT date('now');\`).run();
    			return Response.json(returnValue);
			}
			return env.ASSETS.fetch(request);
		}
	}`;

	// create D1 Database for the worker
	const resources = new Resources(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);
	const d1 = await resources.getOrCreateD1(user);

	await scriptUpload.uploadScript(
		namespace,
		{
			name: workerName,
			script: {
				mainFileName: 'index.js',
				files: [
					{
						name: 'index.js',
						content: Buffer.from(worker),
						type: 'application/javascript+module',
					},
				],
			},
		},
		{
			tags: [`user:${user}`],
			assets: {
				jwt: assetsToken,
			},
			bindings: [
				{
					type: 'assets',
					name: 'ASSETS',
				},
				{
					type: 'd1',
					name: 'SQLITE',
					id: d1.uuid,
				},
			],
			observability: {
				enabled: true,
			},
			compatibility_date: '2025-06-20',
			compatibility_flags: ['nodejs_compat'],
		}
	);

	return c.text('Worker Uploaded!');
});

export default app;
