<script lang="ts">
	import { onMount } from 'svelte';
	import { bolt } from '$bolt';
	let { start }: { start: string } = $props();
	let now = $state(Date.now());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
	const minutes = $derived(Math.ceil(Math.abs(Date.parse(start) - now) / 60_000));
	const time = $derived(`${Math.floor(minutes / 60)}h ${minutes % 60}m`);
	const overdue = $derived(Date.parse(start) <= now);
</script>

<span
	role="timer"
	class={overdue || minutes <= 90
		? 'whitespace-normal font-medium tabular-nums text-warning'
		: 'whitespace-normal tabular-nums text-muted-foreground'}
	>{bolt.t(overdue ? 'app.recovery.overdue' : 'app.recovery.before_start', { time })}</span
>
