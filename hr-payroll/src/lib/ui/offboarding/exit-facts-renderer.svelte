<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RendererProps } from '../../../datatypes/entity_facts/$types.js';
	import EntityFactsRenderer from '../../../datatypes/entity_facts/+renderer.svelte';
	import { client } from '../../workspace-client.js';
	import { settingsInForce } from '../../jurisdiction_settings.js';
	import { inForceSettings } from '../settings-scope.js';

	let props: RendererProps & { companyId: string; lastDay: string | null } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const companyQuery = $derived(
		client.db.companies.findFirst({
			where: { id: { eq: props.companyId } },
			columns: { settings_code: true }
		})
	);
	const settingsCode = $derived(companyQuery.current?.settings_code);
	const versionsQuery = $derived(
		settingsCode && props.lastDay
			? client.db.jurisdiction_settings.findMany({
					where: inForceSettings(settingsCode, props.lastDay),
					columns: {
						id: true,
						code: true,
						sealed_at: true,
						voided_at: true,
						effective_range: true,
						exit_facts: true
					},
					limit: 100
				})
			: null
	);
	const version = $derived(
		settingsInForce(versionsQuery?.current ?? [], settingsCode ?? '', props.lastDay ?? '')
	);
</script>

{#if companyQuery.loading || versionsQuery?.loading}
	<p class="text-meta">{t('component.loading')}</p>
{:else if props.lastDay != null && version == null}
	<p class="text-sm text-destructive" role="alert">{t('offboarding.inputs_unavailable')}</p>
{:else}
	<EntityFactsRenderer {...props} declarations={version?.exit_facts ?? []} />
{/if}
