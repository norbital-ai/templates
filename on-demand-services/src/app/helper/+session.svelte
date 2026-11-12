<script lang="ts">
	import { Effect, Clock, Queue, Schedule } from 'effect';
	import { attach } from '@norbital-ai/ui/effect';
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { employeeLocation } from '../../lib/employee-location.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const EVERY_MS = 120000;
	const actor = ctx.actor;
	const me = $derived(
		actor?.kind === 'member'
			? ctx.query({
					helpers: {
						output: 'helper',
						where: { user: { eq: actor.id } },
						fields: ['revision', 'name'],
						limit: 1
					}
				})
			: null
	);
	// keyed by the id: the helper's own row changes with every position it reports
	const helper = $derived(me?.current?.helpers.rows[0]);
	const helperId = $derived(helper?.id);
	// The host may supply native GPS (background delivery); the same page keeps working in a browser.
	const geo = ctx.device?.geolocation?.api ?? navigator.geolocation;
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
					// the row as last read: its revision guards the write
					const revision = helper?.id === id ? helper.revision : undefined;
					if (revision === undefined) continue;
					yield* ctx
						.act({
							'helpers.update': [
								{ target: { id, revision }, set: { last_location: employeeLocation.here } }
							]
						})
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
