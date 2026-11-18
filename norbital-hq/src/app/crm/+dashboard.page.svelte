<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import CalendarSchedule from '../../lib/CalendarSchedule.svelte';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:calendar-days"
	title={ctx.t('dashboard.title')}
	description={ctx.t('dashboard.description')}
	variant="full"
>
	<CalendarSchedule {ctx} />
</AppShell>
