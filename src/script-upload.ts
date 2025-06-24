import Cloudflare, { toFile } from 'cloudflare';
import { ScriptUpdateParams } from 'cloudflare/resources/workers-for-platforms/dispatch/namespaces';
import { AssetUploadCreateResponse } from 'cloudflare/resources/workers-for-platforms/dispatch/namespaces/scripts';
import type { ToFileInput, Uploadable } from 'cloudflare/uploads';

export interface WorkerScript {
	mainFileName: string;
	files: {
		name: string;
		content: ToFileInput | PromiseLike<ToFileInput>;
		type: string;
	}[];
}

export interface FileMetadata {
	hash: string;
	size: number;
}

export type AssetsUploadInfo = Required<AssetUploadCreateResponse>;

// https://developers.cloudflare.com/workers/static-assets/direct-upload/
export class ScriptUpload {
	#client: Cloudflare;

	constructor(private readonly accountId: string, apiToken: string) {
		this.#client = new Cloudflare({
			apiToken: apiToken,
		});
	}

	public async createAssetsUpload(
		namespace: string,
		workerName: string,
		manifest: Record<string, FileMetadata>
	): Promise<AssetsUploadInfo | null> {
		const result = await this.#client.workersForPlatforms.dispatch.namespaces.scripts.assetUpload.create(namespace, workerName, {
			account_id: this.accountId,
			manifest,
		});

		if (result === null) {
			return null;
		}

		const { buckets, jwt } = result;

		if (buckets === undefined || jwt === undefined) {
			return null;
		}

		return { buckets, jwt };
	}

	public async uploadFilesBatch(
		uploadInfo: AssetsUploadInfo,
		filesByHash: Map<string, { fileName: string; data: Buffer; type: string }>
	): Promise<string> {
		if (uploadInfo.buckets.length === 0) {
			console.warn('Skipping upload, no files to upload');
			return uploadInfo.jwt;
		}

		for (const bucket of uploadInfo.buckets) {
			const form = new FormData();

			bucket.forEach((fileHash) => {
				const file = filesByHash.get(fileHash);

				if (!file) {
					throw new Error('unknown file hash');
				}

				const base64Data = file.data.toString('base64');

				form.append(
					fileHash,
					new File([base64Data], fileHash, {
						type: file.type,
					}),
					fileHash
				);
			});

			const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/assets/upload?base64=true`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadInfo.jwt}`,
				},
				body: form,
			});

			const data = await response.json<{
				result: {
					jwt: string;
					buckets: string[][];
				};
				success: boolean;
				errors: any;
				messages: any;
			}>();

			if (data) {
				if (data.messages) {
					console.warn(...data.messages);
				}

				if (!data.success) {
					if (data.errors) {
						console.error(...data.errors);
					}
					throw new Error('Failed to upload files');
				}

				if (data.result.jwt) {
					console.log('Assets Upload success!');
					return data.result.jwt;
				}
			}
		}

		throw new Error('Should have received completion token');
	}

	public async uploadScript(
		namespace: string,
		worker: {
			name: string;
			script: WorkerScript;
		},
		metadata: Omit<ScriptUpdateParams['metadata'], 'main_module'>
	): Promise<void> {
		try {
			const files: Record<string, Uploadable> = Object.fromEntries(
				await Promise.all(
					worker.script.files.map(async (file) => [worker.name, await toFile(file.content, file.name, { type: file.type })])
				)
			);

			// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
			const script = await this.#client.workersForPlatforms.dispatch.namespaces.scripts.update(namespace, worker.name, {
				account_id: this.accountId,
				// https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
				metadata: {
					main_module: worker.script.mainFileName,
					...metadata,
				},
				files,
			});
			console.log('Script Upload success!');
			console.log(JSON.stringify(script, null, 2));
		} catch (error) {
			console.error('Script Upload failure!');
			console.error(error);
			throw error;
		}
	}
}
