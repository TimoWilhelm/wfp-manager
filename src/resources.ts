import Cloudflare, { NotFoundError } from 'cloudflare';
import { required } from './util';

export class Resources {
	#client: Cloudflare;

	constructor(private readonly accountId: string, apiToken: string) {
		this.#client = new Cloudflare({
			apiToken: apiToken,
		});
	}

	async getOrCreateD1(
		name: string,
		locationHint?: Cloudflare.D1Resource.Database.DatabaseCreateParams['primary_location_hint']
	): Promise<Required<Cloudflare.D1Resource.D1>> {
		try {
			const existingD1 = await this.#client.d1.database.get(name, { account_id: this.accountId });
			return required(existingD1);
		} catch (error) {
			if (error instanceof NotFoundError) {
				const newD1 = await this.#client.d1.database.create({
					name,
					account_id: this.accountId,
					primary_location_hint: locationHint,
				});
				return required(newD1);
			}
			throw error;
		}
	}
}
