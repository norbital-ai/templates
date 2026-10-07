<script lang="ts">
	/**
	 * A signed-in helper's position, shared with dispatch every two minutes for as long as they are signed in — through
	 * every page, and in the background on a native host. Whether the device allows it is the shell's device wall
	 * (`requires` in this app's `+app.ts`); this only watches and reports.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { live } from '../../lib/live.svelte.js';
	import { employeeLocation } from '../../lib/employee-location.svelte.js';

	const EVERY_MS = 120_000;
	const actor = bolt.actor;
	const me = live(() =>
		actor?.kind === 'member'
			? bolt.read('helpers', {
					where: { user: { eq: actor.id } },
					select: { name: true },
					limit: 1
				})
			: null
	);
	// keyed by the id: the helper's own row changes with every position it reports
	const helperId = $derived(me.current?.rows[0]?.id);
	// The host may supply native GPS (background delivery); the same page keeps working in a browser.
	const geo = bolt.facilities?.geolocation?.api ?? navigator.geolocation;

	function watch(id: Id<'helpers'>) {
		let sent = 0;
		const watching = geo.watchPosition(
			({ coords }) => {
				employeeLocation.here = { lat: coords.latitude, lng: coords.longitude };
				if (Date.now() - sent < EVERY_MS) return;
				sent = Date.now();
				void bolt.act('helpers.update', {
					target: id,
					set: { last_location: employeeLocation.here }
				});
			},
			() => (employeeLocation.here = null),
			{ enableHighAccuracy: true }
		);
		return () => {
			geo.clearWatch(watching);
			employeeLocation.here = null;
		};
	}
	$effect(() => {
		if (helperId === undefined || geo === undefined) return;
		let stop = watch(helperId);
		// a watch refused (permission not yet allowed, or revoked) is dead: re-arm it until positions flow again,
		// so allowing location in Settings (the device wall) resumes sharing without a reload
		const rearm = () => {
			if (employeeLocation.here !== null) return;
			stop();
			stop = watch(helperId);
		};
		const timer = setInterval(rearm, 5000);
		const back = () => document.visibilityState === 'visible' && rearm();
		document.addEventListener('visibilitychange', back);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', back);
			stop();
		};
	});
</script>
