import { Hono } from 'hono';
import { AssetManifest, ScriptUpload } from './script-upload';
import crypto from 'crypto';
import { Resources } from './resources';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';

const app = new OpenAPIHono<{ Bindings: Env }>({
	strict: true,
	defaultHook: (result, c) => {
		if (!result.success) {
			return c.json(
				{
					ok: false,
					errors: result.error.format(),
				},
				422
			);
		}
	},
});

app.notFound((c) => {
	return c.json(
		{
			message: 'Not Found',
		},
		404
	);
});

app.onError((err, c) => {
	return c.json(
		{
			message: err.message,
		},
		500
	);
});

const namespace = 'tiwi';
const workerName = 'customer-worker-1';
const user = 'customer-1';

app.openapi(
	createRoute({
		method: 'post',
		path: '/upload',
		request: {
			body: {
				required: true,
				content: {
					'application/json': {
						schema: z.object({
							mainFileName: z.string(),
							files: z.array(
								z.object({
									name: z.string(),
									content: z.string(),
									type: z.string(),
								})
							),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: 'OK',
				content: {
					'application/json': {
						schema: z.object({
							ok: z.boolean(),
							errors: z.array(z.string()),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const validatedBody = c.req.valid('json');

		const scriptUpload = new ScriptUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

		/*
		 * TODO: Here we are simulating uploading assets.
		 * This should be done by creating an upload and passing the token to the user to upload the assets directly
		 */

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

		// create D1 Database for the worker
		const resources = new Resources(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);
		const d1 = await resources.getOrCreateD1(user);

		await scriptUpload.uploadScript(
			namespace,
			{
				name: workerName,
				script: {
					mainFileName: validatedBody.mainFileName,
					files: validatedBody.files.map((files) => ({
						name: files.name,
						content: Buffer.from(files.content),
						type: files.type,
					})),
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

		return c.json({
			ok: true,
			errors: [],
		});
	}
);

export default app;
