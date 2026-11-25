import type { Point } from './matching.js';

/** The signed-in provider session owns live GPS tracking; My Day reads this reactive state. */
export const providerLocation: {
	here: Point | null;
	readonly ready: boolean;
} = $state({
	here: null,
	get ready() {
		return this.here !== null;
	}
});
