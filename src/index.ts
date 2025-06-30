import { ScriptUpload } from './script-upload';
import { Resources } from './resources';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { prettyJSON } from 'hono/pretty-json';

const responseSchema = z.object({
	ok: z.boolean(),
	errors: z.array(z.any()),
});

const errorSchema = responseSchema.extend({
	ok: z.literal(false),
});

const app = new OpenAPIHono<{ Bindings: Env }>({
	strict: true,
	defaultHook: (result, c) => {
		if (!result.success) {
			console.log(result.error.errors)
			return c.json(
				{
					ok: false,
					errors: result.error.errors,
				} satisfies z.infer<typeof errorSchema>,
				422
			);
		}
	},
});

app.use(prettyJSON());

app.notFound((c) => {
	return c.json(
		{
			ok: false,
			errors: ['Not Found'],
		} satisfies z.infer<typeof errorSchema>,
		404
	);
});

app.onError((err, c) => {
	return c.json(
		{
			ok: false,
			errors: [err.message],
		} satisfies z.infer<typeof errorSchema>,
		500
	);
});

app.doc31('/openapi', {
	openapi: '3.1.0',
	info: {
		version: '1.0.0',
		title: 'WfP Manager',
	},
});

const namespace = 'tiwi';
const workerName = 'customer-worker-1';
const user = 'customer-1';
const userLocationHint = 'weur';

app.openapi(
	createRoute({
		method: 'post',
		path: '/assets',
		request: {
			body: {
				required: true,
				content: {
					'application/json': {
						schema: z.object({
							filesMetadata: z.array(
								z.object({
									fileName: z
										.string()
										.startsWith('/')
										.transform((v) => v as `/${string}`),
									fileHash: z.string().length(32),
									fileSize: z.number().max(25 * 1024 * 1024),
								})
							),
						}),
					},
				},
			},
		},
		responses: {
			201: {
				description: 'Created Asset Upload',
				content: {
					'application/json': {
						schema: responseSchema.extend({
							uploadInfo: z.object({
								jwt: z.string(),
								buckets: z.array(z.array(z.string())),
							}),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const { filesMetadata } = c.req.valid('json');

		const manifest = filesMetadata.reduce((acc: Record<string, any>, file) => {
			acc[file.fileName] = {
				hash: file.fileHash,
				size: file.fileSize,
			};
			return acc;
		}, {});

		const scriptUpload = new ScriptUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

		const uploadInfo = await scriptUpload.createAssetsUpload(namespace, workerName, manifest);

		return c.json(
			{
				ok: true,
				uploadInfo,
				errors: [],
			},
			{
				status: 201,
			}
		);
	}
);

app.openapi(
	createRoute({
		method: 'put',
		path: '/assets',
		request: {
			body: {
				required: true,
				content: {
					'application/json': {
						schema: z.object({
							uploadInfo: z.object({
								jwt: z.string(),
								buckets: z.array(z.array(z.string())),
							}),
							files: z.array(
								z.object({
									fileHash: z.string().length(32),
									fileName: z
										.string()
										.startsWith('/')
										.transform((v) => v as `/${string}`),
									content: z.string(),
									contentType: z.string(),
									base64: z.boolean().optional().default(false),
								})
							),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: 'Assets uploaded successfully',
				content: {
					'application/json': {
						schema: responseSchema,
					},
				},
			},
		},
	}),
	async (c) => {
		const { uploadInfo, files } = c.req.valid('json');

		const scriptUpload = new ScriptUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

		const fileMap = new Map(
			files.map((file) => [
				file.fileHash,
				{
					fileName: file.fileName,
					data: Buffer.from(file.content, file.base64 ? 'base64' : 'utf-8'),
					type: file.contentType,
				},
			])
		);

		const assetsToken = await scriptUpload.uploadAssetsBatch(uploadInfo, fileMap);

		return c.json({
			ok: true,
			jwt: assetsToken,
			errors: [],
		});
	}
);

app.openapi(
	createRoute({
		method: 'post',
		path: '/worker',
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
									base64: z.boolean().optional().default(false),
								})
							),
							assetsToken: z.string().optional(),
							singlePageApp: z.boolean().optional().default(false),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: 'Worker deployed successfully',
				content: {
					'application/json': {
						schema: responseSchema,
					},
				},
			},
		},
	}),
	async (c) => {
		const { files, mainFileName, assetsToken, singlePageApp } = c.req.valid('json');

		// Create D1 Database for the worker
		const resources = new Resources(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);
		const d1 = await resources.getOrCreateD1(user, userLocationHint);

		const scriptUpload = new ScriptUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

		await scriptUpload.deployWorker(
			namespace,
			workerName,
			{
				mainFileName,
				files: files.map((files) => {
					return {
						name: files.name,
						content: Buffer.from(files.content, files.base64 ? 'base64' : 'utf-8'),
						type: files.type,
					};
				}),
			},
			{
				tags: [`user:${user}`],
				assets: assetsToken
					? {
							config: {
								not_found_handling: singlePageApp ? 'single-page-application' : undefined,
							},
							jwt: assetsToken,
					  }
					: undefined,
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
