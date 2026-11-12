<script lang="ts">
	import { bolt } from '$bolt';
	import { Form, type FormProps } from '@norbital-ai/ui';
	let { fields }: { fields: NonNullable<FormProps<'commercial_settings'>['fields']> } = $props();
	const settings = bolt.query({
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	});
	const row = $derived(settings.current?.commercial_settings.rows[0]);
</script>

{#if row}
	<Form of="commercial_settings" mode="update" id={row.id} record={row} {fields} />
{:else if settings.error}
	<p role="alert" class="text-sm text-destructive">{settings.error.message}</p>
{:else if settings.loading}
	<p role="status" class="text-sm text-muted-foreground">{bolt.t('component.settings_loading')}</p>
{/if}
