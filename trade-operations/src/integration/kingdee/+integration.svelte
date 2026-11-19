<script lang="ts" module>
	export const configuration_tab = 'section.data_freshness';
</script>

<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import CommercialSettingsForm from '../../lib/ui/commercial-settings-form.svelte';
	let { ctx }: { ctx: PageContext } = $props();
</script>

<CommercialSettingsForm {ctx} fields={['stock_fresh_minutes']} />
