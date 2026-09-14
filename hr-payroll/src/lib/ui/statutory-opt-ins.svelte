<script lang="ts">
	/**
	 * The explicit statutory opt-ins of one line or band (RFC 0001 §4, §9): which schemes the
	 * amount is included in or reduces, by scheme, with silence meaning no effect.
	 *
	 * The schemes are the settings version's own rows, read live and picked by code — never a
	 * hand-typed UUID. The query is opened only in edit mode; a display surface shows the count.
	 *
	 * Both callers are band editors (a catalogue band and a work band), so this component owns the
	 * one shape rather than each renderer reimplementing the same two dropdowns.
	 */
	import { client } from '../workspace-client.js';
	import { hrCreateScope } from './create-scope.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Grid } from '@norbital-ai/ui/layout';
	import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';

	type Props = {
		readonly value: readonly StatutoryOptIn[];
		readonly disabled?: boolean;
		readonly onValueChange: (value: StatutoryOptIn[]) => void;
	};

	let { value, disabled = false, onValueChange }: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const scope = hrCreateScope();
	const settingsId = $derived(scope?.settingsId?.());
	const schemesQuery = $derived(
		disabled
			? null
			: client.db.statutory_contributions.findMany({
					where: {
						...(settingsId == null ? {} : { settings_id: { eq: settingsId } }),
						approval_id: { isNull: true }
					},
					columns: { id: true, code: true, name: true },
					orderBy: { sequence: 'asc' },
					limit: 500
				})
	);
	const schemeOptions = $derived(
		(schemesQuery?.current ?? []).map((scheme) => ({
			value: scheme.id,
			label: scheme.code,
			search_term: `${scheme.code} ${scheme.name}`
		}))
	);
	const effectOptions = $derived([
		{ value: 'INCLUDE' as const, label: t('component.opt_in_include') },
		{ value: 'REDUCE' as const, label: t('component.opt_in_reduce') }
	]);

	function edit(index: number, change: Partial<StatutoryOptIn>): void {
		onValueChange(value.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
</script>

<div class="flex flex-col gap-2">
	{#each value as row, index (index)}
		<Grid gap="sm" minimum="compact">
			<label class="text-sm font-medium">
				<Combobox
					ariaLabel={t('component.statutory_scheme')}
					options={schemeOptions}
					value={row.contribution_id === '' ? null : row.contribution_id}
					{disabled}
					emptyPlaceholder={t('component.choose_scheme')}
					onValueChange={(contribution_id) =>
						edit(index, { contribution_id: contribution_id ?? '' })}
				/>
			</label>
			<label class="text-sm font-medium">
				<Combobox
					ariaLabel={t('component.opt_in_effect')}
					options={effectOptions}
					value={row.effect}
					{disabled}
					searchable={false}
					onValueChange={(effect) => {
						if (effect) edit(index, { effect });
					}}
				/>
			</label>
			<Button
				variant="ghost"
				size="sm"
				{disabled}
				onclick={() => onValueChange(value.filter((_row, position) => position !== index))}
			>
				{t('component.remove')}
			</Button>
		</Grid>
	{/each}
	<Button
		variant="outline"
		size="sm"
		{disabled}
		onclick={() => onValueChange([...value, { contribution_id: '', effect: 'INCLUDE' }])}
	>
		{t('component.add_opt_in')}
	</Button>
</div>
