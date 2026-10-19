import { derived, readable, type Readable } from 'svelte/store';
/** Publish errors with values, so a refused first read also updates the rendered state. */
export function liveState<T>(
	source:
		| (Readable<T | undefined> & {
				readonly error:
					| {
							message: string;
					  }
					| undefined;
		  })
		| null
) {
	return source
		? derived(source, (value) => ({ value, error: source.error }))
		: readable<{
				value: T | undefined;
				error:
					| {
							message: string;
					  }
					| undefined;
			}>({
				value: undefined,
				error: undefined
			});
}
