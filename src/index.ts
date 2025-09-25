import { WorkerUpload } from './worker-upload';
import { Resources } from './resources';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import * as z from 'zod/v4';
import { prettyJSON } from 'hono/pretty-json';

const responseSchema = z.object({
	ok: z.boolean(),
	errors: z.any().optional(),
});

const errorSchema = responseSchema.extend({
	ok: z.literal(false),
});

const app = new OpenAPIHono<{ Bindings: Env }>({
	strict: true,
	defaultHook: (result, c) => {
		if (!result.success) {
			const errors = z.treeifyError(result.error);

			console.log(errors);
			return c.json(
				{
					ok: false,
					errors,
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
			errors: { message: 'Not Found' },
		} satisfies z.infer<typeof errorSchema>,
		404
	);
});

app.onError((err, c) => {
	return c.json(
		{
			ok: false,
			errors: err,
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
							namespace: z.string(),
							workerName: z.string(),
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
		const { namespace, workerName, filesMetadata } = c.req.valid('json');

		const manifest = filesMetadata.reduce((acc: Record<string, any>, file) => {
			acc[file.fileName] = {
				hash: file.fileHash,
				size: file.fileSize,
			};
			return acc;
		}, {});

		const workerUpload = new WorkerUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

		const uploadInfo = await workerUpload.createAssetsUpload(namespace, workerName, manifest);

		return c.json(
			{
				ok: true,
				uploadInfo,
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
									base64: z.boolean().default(false),
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

		const workerUpload = new WorkerUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

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

		const assetsToken = await workerUpload.uploadAssetsBatch(uploadInfo, fileMap);

		return c.json({
			ok: true,
			jwt: assetsToken,
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
							namespace: z.string(),
							workerName: z.string(),
							mainFileName: z.string(),
							files: z.array(
								z.object({
									name: z.string(),
									content: z.string(),
									type: z.string(),
									base64: z.boolean().default(false),
								})
							),
							assetsToken: z.string().optional(),
							singlePageApp: z.boolean().default(false),
							d1Location: z.enum(['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc']).default('weur'),
							tags: z.array(z.string().regex(/^[^:]+:.+$/, 'Tags must be in format "key:value"')).default([]),
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
		const { namespace, workerName, files, mainFileName, assetsToken, singlePageApp, d1Location, tags } = c.req.valid('json');

		// Create D1 Database for the worker
		const resources = new Resources(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);
		const d1 = await resources.getOrCreateD1(`${namespace}-${workerName}`, d1Location);

		const workerUpload = new WorkerUpload(c.env.CLOUDFLARE_ACCOUNT_ID, c.env.CLOUDFLARE_API_TOKEN);

		await workerUpload.deployWorker(
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
				tags,
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
		});
	}
);

export default app;
