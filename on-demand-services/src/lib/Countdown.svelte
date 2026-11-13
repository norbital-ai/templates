<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { DateTime, Duration } from 'effect';
	let {
		ctx,
		start
	}: {
		ctx: Pick<PageContext, 'clock' | 't' | 'locale'>;
		start: string;
	} = $props();
	const clock = ctx.clock('minute');
	const now = $derived(DateTime.makeUnsafe(clock.now));
	const minutes = $derived(
		Math.ceil(Math.abs(Duration.toMinutes(DateTime.distance(now, DateTime.makeUnsafe(start)))))
	);
	const time = $derived.by(() => {
		const left = Duration.minutes(minutes);
		return `${new Intl.NumberFormat(ctx.locale, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }).format(Math.trunc(Duration.toHours(left)))} ${new Intl.NumberFormat(ctx.locale, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' }).format(Duration.parts(left).minutes)}`;
	});
	const overdue = $derived(!DateTime.isLessThan(now, DateTime.makeUnsafe(start)));
</script>

<span
	role="timer"
	class={overdue || minutes <= 90
		? 'whitespace-normal font-medium tabular-nums text-warning'
		: 'whitespace-normal tabular-nums text-muted-foreground'}
	>{ctx.t(overdue ? 'app.recovery.overdue' : 'app.recovery.before_start', { time })}</span
>
