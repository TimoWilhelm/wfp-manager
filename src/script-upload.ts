import Cloudflare, { toFile } from 'cloudflare';
import { Uploadable } from 'cloudflare/uploads';

export interface WorkerScript {
	name: string;
	mainFileName: string;
	files: {
		name: string;
		content: string;
		type: string;
	}[];
}

export interface FileMetadata {
	hash: string;
	size: number;
}

export interface AssetsUploadInfo {
	buckets: Array<Array<string>>;
	jwt: string;
}

interface UploadResponse {
	result: {
		jwt: string;
		buckets: string[][];
	};
	success: boolean;
	errors: any;
	messages: any;
}

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
	): Promise<AssetsUploadInfo> {
		const { buckets, jwt } = await this.#client.workersForPlatforms.dispatch.namespaces.scripts.assetUpload.create(namespace, workerName, {
			account_id: this.accountId,
			manifest,
		});

		if (buckets === undefined || jwt === undefined) {
			throw new Error('invalid upload response');
		}

		return { buckets, jwt };
	}

	public async uploadFilesBatch(
		uploadInfo: AssetsUploadInfo,
		filesByHash: Map<string, { fileName: string; data: Blob; type: string }>
	): Promise<string> {
		const form = new FormData();

		for (const bucket of uploadInfo.buckets) {
			bucket.forEach((fileHash) => {
				const file = filesByHash.get(fileHash);
				if (!file) {
					throw new Error('unknown file hash');
				}

				form.append(
					fileHash,
					new File([file.data], fileHash, {
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

			const data = await response.json<UploadResponse>();
			if (data && data.result.jwt) {
				return data.result.jwt;
			}
		}

		throw new Error('Should have received completion token');
	}

	public async uploadScript(namespace: string, workerScript: WorkerScript, assetsToken?: string): Promise<void> {
		try {
			const files: Record<string, Uploadable> = Object.fromEntries(
				await Promise.all(
					workerScript.files.map(async (file) => [workerScript.name, await toFile(Buffer.from(file.content), file.name, { type: file.type })])
				)
			);

			// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
			const script = await this.#client.workersForPlatforms.dispatch.namespaces.scripts.update(namespace, workerScript.name, {
				account_id: this.accountId,
				// https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
				metadata: {
					main_module: workerScript.mainFileName,
					assets: {
						jwt: assetsToken,
					},
					bindings: [
						{
							type: 'plain_text',
							name: 'MESSAGE',
							text: 'Hello World!',
						},
					],
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
