<script lang="ts">
	/**
	 * One employing entity's scheduling vocabulary: the roster codes its shifts are written in,
	 * and the named patterns a contract can ride. Both belong to the entity, not the jurisdiction —
	 * two entities of one jurisdiction keep their own — so they are configured where the entity is,
	 * not under the settings version whose law they operate under.
	 */
	import { setContext } from 'svelte';
	import { client } from '../workspace-client.js';
	import { HR_CREATE_SCOPE, type HrCreateScope } from './create-scope.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import type { WorkspaceRow } from '$bolt/types.js';
	import EffectiveRangeRenderer from './effective-range-renderer.svelte';

	let { company }: { company: WorkspaceRow<'companies'> } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const companyId = $derived(company.id);
	// A code or pattern created from inside the entity is the entity's: the form inherits it.
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => companyId,
		settingsCode: () => company.settings_code ?? undefined
	});
</script>

{#snippet rosterCodes()}
	<CollectionTable
		{client}
		collection="shift_definitions"
		view={`hr_controller:entities:shift_definitions:${companyId}`}
		description={t('app.scheduling.shift_intro')}
		query={{
			where: { approval_id: { isNull: true }, company_id: { eq: companyId } },
			orderBy: { code: 'asc' }
		}}
	>
		{#snippet columns({ Column })}
			<Column name="code" card="title" />
			<Column name="name" card="subtitle" />
			<Column name="variant" label={t('app.scheduling.roster_code_definition')} />
			<Column
				name="effective_range"
				renderer={EffectiveRangeRenderer}
				label={t('component.effective')}
			/>
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet shiftPatterns()}
	<CollectionTable
		{client}
		collection="shift_patterns"
		view={`hr_controller:entities:shift_patterns:${companyId}`}
		description={t('app.scheduling.pattern_intro')}
		query={{
			where: { approval_id: { isNull: true }, company_id: { eq: companyId } },
			orderBy: { code: 'asc' }
		}}
	>
		{#snippet columns({ Column })}
			<Column name="code" card="title" />
			<Column name="name" card="subtitle" />
			<Column name="pattern" label={t('component.work_pattern')} />
			<Column
				name="effective_range"
				renderer={EffectiveRangeRenderer}
				label={t('component.effective')}
			/>
		{/snippet}
	</CollectionTable>
{/snippet}

<Tabs
	animate={false}
	variant="underline"
	config={[
		{
			name: 'codes',
			label: t('app.scheduling.tab_shifts'),
			icon: 'lucide:clock-4',
			content: rosterCodes
		},
		{
			name: 'patterns',
			label: t('app.scheduling.tab_patterns'),
			icon: 'lucide:repeat',
			content: shiftPatterns
		}
	] satisfies TabConfig[]}
/>
