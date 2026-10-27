<script lang="ts">
	/** Two jurisdiction versions in the shared form diff, with catalogue rows matched by their business keys. */
	import { bolt } from '$bolt';
	import type { Id, MessageKey } from '@norbital-ai/bolt';
	import { Combobox, EmptyState, StructuredData, type Kind, type Value } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { formatSettingsRange } from '../../../lib/ui/format/display_formatters.js';
	import { SETTINGS_DIFF_FIELDS } from '../../../lib/payroll_engine/settings_version.js';
	import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';
	import { labelled } from '../../../lib/ui/settings/labelled.js';

	type Version = {
		id: Id<'jurisdiction_settings'>;
		name: string;
		effective_range: { from: string; to: string | null };
	};
	let {
		version,
		versions
	}: {
		version: { id: Id<'jurisdiction_settings'>; name: string } | null;
		versions: readonly Version[];
	} = $props();

	let picked = $state<Id<'jurisdiction_settings'> | null>(null);
	const others = $derived(versions.filter((row) => row.id !== version?.id));
	const against = $derived(
		picked != null && others.some((row) => row.id === picked) ? picked : (others[0]?.id ?? null)
	);
	const options = $derived(
		others.map((row) => ({
			value: row.id,
			label: `${row.name} · ${formatSettingsRange(row.effective_range)}`
		}))
	);
	const baseName = $derived(versions.find((row) => row.id === against)?.name ?? '');
	const CHILDREN = [
		['leave_catalog', 'app.settings.leave_catalog'],
		['claim_catalog', 'app.settings.claim_catalog'],
		['allowance_catalog', 'app.settings.allowance_catalog'],
		['adhoc_catalog', 'app.settings.adhoc_catalog'],
		['loan_catalog', 'app.settings.loan_catalog'],
		['work_catalog', 'models.work_catalog.label'],
		['statutory_contribution_catalog', 'component.statutory_contributions'],
		['rule_set', 'section.rule_sets']
	] as const satisfies readonly (readonly [string, MessageKey])[];
	/** One version with every catalogue it holds, in one read. */
	const versionOf = (id: Id<'jurisdiction_settings'>) =>
		bolt.query({
			jurisdiction_settings: { where: { id: { eq: id } }, limit: 1 },
			'jurisdiction_settings.leave_catalog': {},
			'jurisdiction_settings.claim_catalog': {},
			'jurisdiction_settings.allowance_catalog': {},
			'jurisdiction_settings.adhoc_catalog': {},
			'jurisdiction_settings.loan_catalog': {},
			'jurisdiction_settings.work_catalog': {},
			'jurisdiction_settings.statutory_contribution_catalog': {},
			'jurisdiction_settings.rule_set': {}
		});
	const head = $derived.by(() => (version == null ? null : versionOf(version.id)));
	const base = $derived.by(() => (against == null ? null : versionOf(against)));
	/** Row identity and audit columns never describe a difference between two versions. */
	const SYSTEM = new Set(['id', 'settings_id', 'revision', 'created_at', 'updated_at']);
	const strip = (row: Readonly<Record<string, Value | undefined>>): Record<string, Value> =>
		Object.fromEntries(
			Object.entries(row).flatMap(([key, value]): [string, Value][] =>
				value === undefined || SYSTEM.has(key) || key.startsWith('$') ? [] : [[key, value]]
			)
		);
	const snapshots = $derived.by(() => {
		const left = base?.current?.jurisdiction_settings.rows[0];
		const right = head?.current?.jurisdiction_settings.rows[0];
		if (left == null || right == null) return null;
		const before: Record<string, Value> = {
			settings: Object.fromEntries(
				SETTINGS_DIFF_FIELDS.map((field): [string, Value] => [field, left[field]])
			)
		};
		const value: Record<string, Value> = {
			settings: Object.fromEntries(
				SETTINGS_DIFF_FIELDS.map((field): [string, Value] => [field, right[field]])
			)
		};
		for (const [of] of CHILDREN) {
			before[of] = left[of].map(strip);
			value[of] = right[of].map(strip);
		}
		return { before, value };
	});
	const kind = $derived<Kind>({
		kind: 'object',
		fields: {
			settings: {
				kind: 'object',
				label: bolt.t('component.diff_settings_fields'),
				fields: Object.fromEntries(
					SETTINGS_DIFF_FIELDS.map((field): [string, Kind] => [
						field,
						labelled(bolt, 'jurisdiction_settings', field, STATUTORY_FIELDS.settings[field])
					])
				)
			},
			...Object.fromEntries(
				CHILDREN.map(([of, title]): [string, Kind] => [
					of,
					{
						kind: 'list',
						label: bolt.t(title),
						of: {
							kind: 'object',
							fields: Object.fromEntries(
								Object.entries(STATUTORY_FIELDS[of]).map(([name, field]): [string, Kind] => [
									name,
									labelled(bolt, of, name, field)
								])
							)
						}
					}
				])
			)
		}
	});
	const arrayKeys = Object.fromEntries(
		CHILDREN.map(([of]): [string, string | readonly string[]] => [
			`/${of}`,
			of === 'rule_set' ? ['family', 'code'] : 'code'
		])
	);
	const error = $derived(head?.error ?? base?.error);
</script>

{#if version == null}
	<EmptyState title={bolt.t('app.settings.changes')} />
{:else}
	<Stack gap="md">
		<Cluster gap="sm" align="center">
			<Combobox
				class="w-72 max-w-full"
				size="sm"
				aria-label={bolt.t('component.diff_against')}
				placeholder={bolt.t('component.diff_compare')}
				{options}
				value={against}
				onChange={(next) => (picked = next)}
			/>
			{#if against != null}<span class="text-meta">{baseName} → {version.name}</span>{/if}
		</Cluster>
		{#if against == null}
			<EmptyState title={bolt.t('component.diff_same_version')} />
		{:else if error}
			<p class="text-sm text-destructive" role="alert">{error.message}</p>
		{:else if snapshots == null}
			<p class="text-meta">{bolt.t('component.loading')}</p>
		{:else}
			<StructuredData {kind} {...snapshots} {arrayKeys} mode="diff" changesOnly name="snapshot" />
		{/if}
	</Stack>
{/if}
