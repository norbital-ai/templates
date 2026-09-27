<script lang="ts">
	/**
	 * One employing entity's scheduling vocabulary: the roster codes its shifts are written in, and the named patterns a
	 * contract can ride. Both belong to the entity, not the jurisdiction — two entities of one jurisdiction keep their
	 * own — so they are configured where the entity is, not under the settings version whose law they operate under.
	 */
	import { t } from './t.js';
	import { setContext } from 'svelte';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { HR_CREATE_SCOPE, type HrCreateScope } from './create-scope.js';

	let {
		company
	}: { company: { readonly id: Id<'companies'>; readonly settings_code?: string | null } } =
		$props();
	// A code or pattern created from inside the entity is the entity's: the form inherits it.
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => company.id,
		settingsCode: () => company.settings_code ?? undefined
	});
	const scoped = $derived({
		company_id: { eq: company.id },
		approval_id: { isNull: true }
	} as const);
</script>

{#snippet rosterCodes()}
	<Stack gap="sm">
		<p class="text-meta">{t('app.scheduling.shift_intro')}</p>
		<Table
			of="shift_definitions"
			key={`shift_definitions-${company.id}`}
			where={scoped}
			orderBy={{ code: 'asc' }}
			columns={[
				'code',
				'name',
				{ field: 'variant', label: t('app.scheduling.roster_code_definition') },
				{ field: 'effective_range', label: t('component.effective') }
			]}
		/>
	</Stack>
{/snippet}

{#snippet shiftPatterns()}
	<Stack gap="sm">
		<p class="text-meta">{t('app.scheduling.pattern_intro')}</p>
		<Table
			of="shift_patterns"
			key={`shift_patterns-${company.id}`}
			where={scoped}
			orderBy={{ code: 'asc' }}
			columns={[
				'code',
				'name',
				{ field: 'pattern', label: t('component.work_pattern') },
				{ field: 'effective_range', label: t('component.effective') }
			]}
		/>
	</Stack>
{/snippet}

<Tabs
	tabs={[
		{
			name: 'codes',
			title: t('app.scheduling.tab_shifts'),
			icon: 'lucide:clock-4',
			body: rosterCodes
		},
		{
			name: 'patterns',
			title: t('app.scheduling.tab_patterns'),
			icon: 'lucide:repeat',
			body: shiftPatterns
		}
	]}
/>
