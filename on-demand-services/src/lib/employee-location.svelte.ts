import type { Point } from './matching.js';

/** The signed-in session owns tracking; My Day reads this state. */
export const employeeLocation: { here: Point | null; readonly ready: boolean } = $state({
	here: null,
	get ready() {
		return this.here !== null;
	}
});
