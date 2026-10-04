<script lang="ts">
	import { t } from '../i18n/t.js';
	/** A departure's declared facts, edited against the version of the entity's lineage in force on the last day. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import EntityFactsRenderer from '../../../data/custom_field/entity_facts/+renderer.svelte';
	import { settingsInForce } from '../../jurisdiction_settings.js';
	import { live, liveRows } from '../state/live.svelte.js';
	import { inForceSettings } from '../scopes/settings-scope.js';

	let {
		view,
		companyId,
		lastDay
	}: {
		view: CustomFieldView<{ readonly [key: string]: string | number | boolean }>;
		companyId: Id<'companies'>;
		lastDay: string | null;
	} = $props();
	const company = live(() => bolt.get('companies', companyId, { settings_code: true }));
	const settingsCode = $derived(company.current?.settings_code);
	const versions = liveRows(() =>
		settingsCode && lastDay
			? bolt.read('jurisdiction_settings', {
					// the version in force's exit declarations only: whole rows run to megabytes, past a live view
					select: {
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						exit_facts: true
					},
					where: inForceSettings(settingsCode, lastDay),
					all: true
				})
			: null
	);
	const version = $derived(
		settingsInForce(versions.current ?? [], settingsCode ?? '', lastDay ?? '')
	);
</script>

{#if company.loading || versions.loading}
	<p class="text-meta">{t('component.loading')}</p>
{:else if lastDay != null && version == null}
	<p class="text-sm text-destructive" role="alert">{t('offboarding.inputs_unavailable')}</p>
{:else}
	<EntityFactsRenderer {view} declarations={version?.exit_facts ?? []} />
{/if}
