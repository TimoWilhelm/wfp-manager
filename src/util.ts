export function required<T extends Object>(object: T): Required<T> {
	for (const [key, value] of Object.entries(object)) {
		if (value === undefined) {
			throw new Error(`Missing required value: ${key}`);
		}
	}
	return object as Required<T>;
}
