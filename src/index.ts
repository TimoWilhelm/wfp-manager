import { Hono } from 'hono';
import { ScriptUpload } from './script-upload';
import crypto from 'crypto';

const app = new Hono<{ Bindings: Env }>();

const namespace = 'tiwi';
const workerName = 'customer-worker-1';

app.get('/', async (c) => {
	const scriptUpload = new ScriptUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

	const sampleAssetContent = 'Howdy!';
	const sampleAssetFileName = '/hello_world.txt'; // make sure this is a path beginning with `/`
	const sampleAssetContentType = 'text/plain';

	const sampleAssetBuffer = Buffer.from(sampleAssetContent);
	const sampleAssetHash = crypto.createHash('sha256').update(sampleAssetContent).digest('hex').slice(0, 32);

	const manifest = {
		[sampleAssetFileName]: {
			hash: sampleAssetHash,
			size: sampleAssetBuffer.length,
		},
	};

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
			return env.ASSETS.fetch(request);
		}
	}`;

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
			assets: {
				jwt: assetsToken,
			},
			bindings: [
				{
					name: 'ASSETS',
					type: 'assets',
				},
			],
		}
	);

	return c.text('Worker Uploaded!');
});

export default app;
