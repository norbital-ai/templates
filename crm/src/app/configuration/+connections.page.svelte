<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Scroll } from '@norbital-ai/ui/layout';
	import MyConnections from '../../lib/MyConnections.svelte';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:plug"
	title={ctx.t('connections.title')}
	description={ctx.t('connections.description')}
	variant="full"
	><Scroll name={ctx.t('connections.title')} size="fill" inset><MyConnections {ctx} /></Scroll
	></AppShell
>
