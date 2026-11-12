<script lang="ts" module>
	export const configurationTab = 'section.data_freshness';
</script>

<script lang="ts">
	import CommercialSettingsForm from '../../lib/ui/commercial-settings-form.svelte';
</script>

<CommercialSettingsForm fields={['credit_fresh_minutes', 'stock_fresh_minutes']} />
