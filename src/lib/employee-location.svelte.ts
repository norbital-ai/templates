import type { Point } from './matching.js';

/** The signed-in session owns tracking; My Day reads this state. */
export const employeeLocation = $state({
	here: null as Point | null,
	native: false,
	backgroundReady: false,
	get ready() {
		return this.here !== null && (!this.native || this.backgroundReady);
	}
});
