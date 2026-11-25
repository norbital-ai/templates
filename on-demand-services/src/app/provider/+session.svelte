<script lang="ts">
	import { Clock, Duration, Effect, Queue, Schedule } from 'effect';
	import { attach } from '@norbital-ai/ui/effect';
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { providerLocation } from '../../lib/provider-location.svelte.js';

	let { ctx }: { ctx: PageContext } = $props();
	const EVERY = Duration.minutes(2);
	const actor = $derived(ctx.actor);
	const me = $derived(
		actor?.kind === 'member'
			? ctx.query({
					providers: {
						output: 'provider',
						where: { user: { eq: actor.id } },
						fields: ['revision', 'name'],
						limit: 1
					}
				})
			: null
	);
	const provider = $derived(me?.current?.providers.rows[0]);
	const providerId = $derived(provider?.id);
	const geo = $derived(ctx.device?.geolocation?.api ?? navigator.geolocation);

	function tracking(id: Id<'providers'>, api: Geolocation) {
		return attach(() =>
			Effect.gen(function* () {
				const positions = yield* Queue.unbounded<GeolocationPosition | null>();
				let sent = 0;
				let watching: number | undefined;
				const arm = () => {
					if (watching !== undefined) api.clearWatch(watching);
					watching = api.watchPosition(
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
							if (watching !== undefined) api.clearWatch(watching);
							document.removeEventListener('visibilitychange', back);
							providerLocation.here = null;
						})
				);
				yield* Effect.forkScoped(Effect.repeat(Effect.sync(rearm), Schedule.spaced('5 seconds')));
				while (true) {
					const position = yield* Queue.take(positions);
					providerLocation.here =
						position === null
							? null
							: { lat: position.coords.latitude, lng: position.coords.longitude };
					if (position === null) {
						if (watching !== undefined) api.clearWatch(watching);
						watching = undefined;
						continue;
					}
					const revision = provider?.id === id ? provider.revision : undefined;
					if (revision === undefined) continue;
					const now = yield* Clock.currentTimeMillis;
					if (now - sent < Duration.toMillis(EVERY)) continue;
					sent = now;
					yield* ctx
						.act({
							'providers.update': [
								{ target: { id, revision }, set: { last_location: providerLocation.here } }
							]
						})
						.pipe(Effect.tapError(Effect.logWarning), Effect.ignore);
				}
			})
		);
	}

	const tracker = $derived(
		providerId === undefined || geo === undefined ? undefined : tracking(providerId, geo)
	);
</script>

<span hidden {@attach tracker}></span>
