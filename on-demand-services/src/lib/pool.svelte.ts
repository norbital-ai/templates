import type { PageContext } from '@norbital-ai/bolt/page';
import { driveRequest, poolOf, poolRequest, withDrive } from './dispatch.js';
import { lookups, type Point } from './matching.js';

/**
 * Reactive page-level matching pool: loads providers, occupied appointments, time off, scheduling
 * settings, and then cached Google Routes legs for the candidate stops.
 */
export function livePool(
	ctx: Pick<PageContext, 'query'>,
	window: () => {
		readonly from: string;
		readonly to: string;
		readonly spots: readonly (Point | null)[];
	} | null,
	zone: () => string
) {
	const read = $derived.by(() => {
		const w = window();
		const z = zone();
		return w === null ? null : { w, z, query: ctx.query(poolRequest(w.from, w.to, z)) };
	});
	const pool = $derived(
		read?.query.current === undefined
			? undefined
			: poolOf(read.query.current, read.w.from, read.w.to, read.z)
	);
	const legs = $derived(
		pool === undefined || read === null ? undefined : lookups(pool, read.w.spots, read.z)
	);
	const drive = $derived(
		legs === undefined || legs.length === 0 ? null : ctx.query(driveRequest(legs))
	);
	return {
		get current() {
			if (pool === undefined || legs === undefined) return undefined;
			if (drive === null) return withDrive(pool, []);
			return drive.current === undefined
				? undefined
				: withDrive(pool, drive.current.drive_times.rows);
		},
		get error() {
			return read?.query.error ?? drive?.error;
		}
	};
}
