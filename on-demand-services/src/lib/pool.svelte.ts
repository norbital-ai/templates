import { bolt } from '$bolt';
import { driveRequest, poolOf, poolRequest, withDrive } from './dispatch.js';
import { lookups, type Point } from './matching.js';
/**
 * A page's live matching pool (`dispatch.ts` `loadPool`, read as the viewer): the pool read, then the drive times its
 * legs need. `current` is `undefined` until both have arrived.
 */
export function livePool(
	window: () => {
		readonly from: string;
		readonly to: string;
		readonly spots: readonly (Point | null)[];
	} | null,
	zone: string
) {
	const read = $derived.by(() => {
		const w = window();
		return w === null ? null : { w, query: bolt.query(poolRequest(w.from, w.to, zone)) };
	});
	const pool = $derived(
		read?.query.current === undefined
			? undefined
			: poolOf(read.query.current, read.w.from, read.w.to, zone)
	);
	const legs = $derived(
		pool === undefined || read === null ? undefined : lookups(pool, read.w.spots, zone)
	);
	const drive = $derived(
		legs === undefined || legs.length === 0 ? null : bolt.query(driveRequest(legs))
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
