import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ScriptUpload } from '../script-upload';
import z from 'zod';
import { fi } from 'zod/v4/locales';
import { Resources } from '../resources';

type InferZodObject<T extends Record<string, z.ZodTypeAny>> = {
	[K in keyof T]: z.infer<T[K]>;
};

type State = {
	namespace: string;
	user: string;
};

export class WorkerManagerMcp extends McpAgent<Env, State> {
	server = new McpServer({
		name: 'Worker Upload Manager',
		version: '1.0.0',
	});

	initialState = {
		namespace: 'test',
		user: 'customer-1',
	};

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async init(): Promise<void> {
		const scriptUpload = new ScriptUpload(this.env.CLOUDFLARE_ACCOUNT_ID, this.env.CLOUDFLARE_API_TOKEN);
		const resources = new Resources(this.env.CLOUDFLARE_ACCOUNT_ID, this.env.CLOUDFLARE_API_TOKEN);

		const assetUploadInputSchema = {
			files_metadata: z.array(
				z.object({
					file_name: z.string().startsWith('/'),
					file_hash: z.string(),
					file_size: z.number(),
				})
			),
		};

		const assetUploadOutputSchema = {
			upload_info: z.object({
				jwt: z.string(),
				buckets: z.array(z.array(z.string())),
			}),
		};

		this.server.registerTool(
			'create_asset_upload',
			{
				description: 'Create a new asset upload job',
				inputSchema: assetUploadInputSchema,
				outputSchema: assetUploadOutputSchema,
			},
			async ({ files_metadata }) => {
				const manifest = files_metadata.reduce((acc: Record<string, any>, file) => {
					acc[file.file_name] = {
						hash: file.file_hash,
						size: file.file_size,
					};
					return acc;
				}, {});

				const result = await scriptUpload.createAssetsUpload(this.state.namespace, this.state.user, manifest);

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result),
						},
					],
					structuredContent: {
						upload_info: result,
					} satisfies InferZodObject<typeof assetUploadOutputSchema>,
				};
			}
		);

		const d1 = await resources.getOrCreateD1(this.state.user);

		const deployWorkerInputSchema = {
			worker: z.object({
				name: z.string(),
				main_file_name: z.string(),
				files: z.array(
					z.object({
						name: z.string(),
						content: z.string(),
						type: z.string(),
						base64: z.boolean().optional().default(false),
					})
				),
				assets_token: z.string(),
			}),
		};

		const deployWorkerOutputSchema = {
			version: z.string(),
		};

		this.server.registerTool(
			'deploy_worker',
			{
				description: 'Deploy or update a Cloudflare Worker',
				inputSchema: deployWorkerInputSchema,
				outputSchema: deployWorkerOutputSchema,
			},
			async ({ worker }) => {
				const response = await scriptUpload.deployWorker(
					this.state.namespace,
					this.state.user,
					{
						mainFileName: worker.main_file_name,
						files: worker.files.map((file) => {
							return {
								name: file.name,
								content: Buffer.from(file.content, file.base64 ? 'base64' : 'utf-8'),
								type: file.type,
							};
						}),
					},
					{
						tags: [`user:${this.state.user}`],
						assets: {
							jwt: worker.assets_token,
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

				const output = { version: response.etag };

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(output),
						},
					],
					structuredContent: output satisfies InferZodObject<typeof deployWorkerOutputSchema>,
				};
			}
		);
	}
}
