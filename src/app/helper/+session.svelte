<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Button } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { live } from '../../lib/live.svelte.js';
	import { employeeLocation } from '../../lib/employee-location.svelte.js';
	const t = bolt.t;
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
	const helper = $derived(me.current?.rows[0]);
	// ── position: the day opens only while the phone shares where it is ──
	/** `blocked`: the browser refused; `unsupported`: this browser has no location at all. */
	let refusal = $state<'blocked' | 'unsupported' | 'unavailable' | null>(null);
	let gate = $state<HTMLDialogElement>();
	const nativeLocation = bolt.facilities?.geolocation?.source === 'native';
	const background = bolt.facilities?.geolocation?.background;
	employeeLocation.native = nativeLocation;
	const locationReady = $derived(employeeLocation.ready);
	async function checkBackground() {
		if (!nativeLocation) return;
		try {
			const status = await background?.status();
			employeeLocation.backgroundReady = status?.enabled === true && status.always;
		} catch {
			employeeLocation.backgroundReady = false;
		}
	}
	let sent = $state(0);
	/** The browser's watch on the phone's position; "Try again" restarts it, which asks the browser again. */
	const watching = { id: null as number | null };
	// The host may supply native GPS; the same page keeps working in a browser or older shell.
	const geo = bolt.facilities?.geolocation?.api ?? navigator.geolocation;
	const stopWatching = () => {
		if (watching.id !== null) geo.clearWatch(watching.id);
		watching.id = null;
	};
	function watchPosition(id: Id<'helpers'>) {
		stopWatching();
		employeeLocation.here = null;
		refusal = null;
		watching.id = geo.watchPosition(
			({ coords }) => {
				employeeLocation.here = { lat: coords.latitude, lng: coords.longitude };
				refusal = null;
				if (Date.now() - sent < EVERY_MS) return;
				sent = Date.now();
				void bolt.act('helpers.update', {
					target: id,
					set: { last_location: employeeLocation.here }
				});
			},
			// Any location failure closes the portal until delivery recovers.
			(e) => {
				employeeLocation.here = null;
				refusal = e.code === e.PERMISSION_DENIED ? 'blocked' : 'unavailable';
			},
			{ enableHighAccuracy: true }
		);
	}
	// keyed by the id: the helper's own row changes with every position it reports
	const helperId = $derived(helper?.id);
	$effect(() => {
		if (helperId === undefined) return;
		if (geo === undefined) return void (refusal = 'unsupported');
		watchPosition(helperId);
		void checkBackground();
		const recheck = () => {
			if (document.visibilityState === 'visible') void checkBackground();
		};
		const timer = setInterval(recheck, 3000);
		document.addEventListener('visibilitychange', recheck);
		return () => {
			employeeLocation.here = null;
			employeeLocation.backgroundReady = false;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', recheck);
			stopWatching();
		};
	});

	// A native modal makes the entire shell inert, including navigation and account controls.
	$effect(() => {
		if (!gate) return;
		if (
			actor?.kind === 'member' &&
			(me.current === undefined || helperId !== undefined) &&
			!locationReady
		) {
			if (!gate.open) gate.showModal();
		} else if (gate.open) gate.close();
	});
</script>

<dialog
	bind:this={gate}
	oncancel={(event) => event.preventDefault()}
	onkeydown={(event) => event.stopPropagation()}
	aria-labelledby="location-gate-title"
	aria-describedby="location-gate-body"
	class="location-gate rounded-xl bg-background text-foreground"
>
	<Stack gap="md">
		<h2 id="location-gate-title" class="text-xl font-semibold">
			{t('app.helper.location_gate_title')}
		</h2>
		<p id="location-gate-body" class="text-muted-foreground">
			{t(nativeLocation ? 'app.helper.location_always_body' : 'app.helper.location_gate_body')}
		</p>
		{#if refusal !== null}
			<p role="status" class="text-warning">
				{t(
					refusal === 'blocked'
						? 'app.helper.location_blocked'
						: refusal === 'unsupported'
							? 'app.helper.location_unsupported'
							: 'app.helper.location_unavailable'
				)}
			</p>
		{/if}
		{#if nativeLocation && background}
			<Button size="lg" onclick={() => background.openSettings()}
				>{t('app.helper.location_settings')}</Button
			>
		{/if}
		<Button
			size="lg"
			variant="outline"
			disabled={refusal === 'unsupported'}
			onclick={() => {
				if (helperId !== undefined) watchPosition(helperId);
				void checkBackground();
			}}>{t('app.helper.location_try_again')}</Button
		>
	</Stack>
</dialog>

<style>
	.location-gate {
		width: min(28rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
		margin: auto;
		padding: 1.5rem;
		overflow-y: auto;
		border: 0;
	}
	.location-gate::backdrop {
		background: rgb(0 0 0 / 65%);
	}
</style>
