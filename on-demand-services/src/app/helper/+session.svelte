<script lang="ts">
	import { Effect, Clock, Queue, Schedule } from 'effect';
	import { bolt, attach } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { employeeLocation } from '../../lib/employee-location.svelte.js';
	const EVERY_MS = 120000;
	const actor = bolt.actor;
	const me = $derived(
		actor?.kind === 'member'
			? bolt.query('helpers', {
					where: { user: { eq: actor.id } },
					select: { name: true },
					limit: 1
				})
			: null
	);
	// keyed by the id: the helper's own row changes with every position it reports
	const helperId = $derived(me?.current?.rows[0]?.id);
	// The host may supply native GPS (background delivery); the same page keeps working in a browser.
	const geo = bolt.device?.geolocation?.api ?? navigator.geolocation;
	function tracking(id: Id<'helpers'>) {
		return attach(() =>
			Effect.gen(function* () {
				const positions = yield* Queue.unbounded<GeolocationPosition | null>();
				let sent = 0;
				let watching: number | undefined;
				const arm = () => {
					if (watching !== undefined) geo.clearWatch(watching);
					watching = geo.watchPosition(
						(position) => Queue.offerUnsafe(positions, position),
						() => Queue.offerUnsafe(positions, null),
						{ enableHighAccuracy: true }
					);
				};
				const rearm = () => {
					if (watching === undefined) arm();
				};
				const back = () => {
					if (document.visibilityState === 'visible') rearm();
				};
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						arm();
						document.addEventListener('visibilitychange', back);
					}),
					() =>
						Effect.sync(() => {
							if (watching !== undefined) geo.clearWatch(watching);
							document.removeEventListener('visibilitychange', back);
							employeeLocation.here = null;
						})
				);
				yield* Effect.forkScoped(Effect.repeat(Effect.sync(rearm), Schedule.spaced('5 seconds')));
				while (true) {
					const position = yield* Queue.take(positions);
					employeeLocation.here =
						position === null
							? null
							: { lat: position.coords.latitude, lng: position.coords.longitude };
					if (position === null) {
						if (watching !== undefined) geo.clearWatch(watching);
						watching = undefined;
						continue;
					}
					const now = yield* Clock.currentTimeMillis;
					if (now - sent < EVERY_MS) continue;
					sent = now;
					yield* bolt
						.act('helpers.update', { target: id, set: { last_location: employeeLocation.here } })
						.pipe(Effect.tapError(Effect.logWarning), Effect.ignore);
				}
			})
		);
	}
	const tracker = $derived(
		helperId === undefined || geo === undefined ? undefined : tracking(helperId)
	);
</script>

<span hidden {@attach tracker}></span>
