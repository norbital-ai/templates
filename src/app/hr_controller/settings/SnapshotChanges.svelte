<script lang="ts">
	/**
	 * Two versions of one lineage compared: settings fields, then leave and contribution catalogue codes.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox, EmptyState } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import { t } from '../../../lib/ui/i18n/t.js';
	import { formatSettingsRange } from '../../../lib/ui/format/display_formatters.js';
	import { live, liveRows } from '../../../lib/ui/state/live.svelte.js';
	import {
		diffCatalogCodes,
		diffSettings,
		SETTINGS_DIFF_FIELDS,
		type SettingsDiffLine
	} from '../../../lib/payroll_engine/settings_version.js';

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

	const leftSettings = live(() =>
		version == null ? null : bolt.get('jurisdiction_settings', version.id)
	);
	const rightSettings = live(() =>
		version == null || against == null ? null : bolt.get('jurisdiction_settings', against)
	);
	const leftLeave = liveRows(() =>
		version == null
			? null
			: bolt.read('leave_catalog', {
					where: { settings_id: { eq: version.id }, approval_id: { isNull: true } },
					select: { code: true },
					all: true
				})
	);
	const rightLeave = liveRows(() =>
		against == null
			? null
			: bolt.read('leave_catalog', {
					where: { settings_id: { eq: against }, approval_id: { isNull: true } },
					select: { code: true },
					all: true
				})
	);
	const leftStatutory = liveRows(() =>
		version == null
			? null
			: bolt.read('statutory_contribution_catalog', {
					where: { settings_id: { eq: version.id }, approval_id: { isNull: true } },
					select: { code: true },
					all: true
				})
	);
	const rightStatutory = liveRows(() =>
		against == null
			? null
			: bolt.read('statutory_contribution_catalog', {
					where: { settings_id: { eq: against }, approval_id: { isNull: true } },
					select: { code: true },
					all: true
				})
	);

	const asFields = (row: object): { readonly [field: string]: unknown } =>
		Object.fromEntries(Object.entries(row));

	const lines = $derived.by((): SettingsDiffLine[] | null => {
		const left = leftSettings.current;
		const right = rightSettings.current;
		if (left == null || right == null) return null;
		if (
			leftLeave.current === undefined ||
			rightLeave.current === undefined ||
			leftStatutory.current === undefined ||
			rightStatutory.current === undefined
		)
			return null;
		return [
			...diffSettings(asFields(left), asFields(right), SETTINGS_DIFF_FIELDS),
			...diffCatalogCodes(
				leftLeave.current.map((row) => row.code),
				rightLeave.current.map((row) => row.code),
				'leave_catalog'
			),
			...diffCatalogCodes(
				leftStatutory.current.map((row) => row.code),
				rightStatutory.current.map((row) => row.code),
				'statutory_contribution_catalog'
			)
		];
	});

	function kindLabel(kind: SettingsDiffLine['kind']): string {
		switch (kind) {
			case 'added':
				return t('component.diff_added');
			case 'removed':
				return t('component.diff_removed');
			case 'changed':
				return t('component.diff_changed');
			default: {
				const _exhaustive: never = kind;
				return _exhaustive;
			}
		}
	}

	function cell(value: unknown): string {
		if (value === undefined) return '';
		if (Predicate.isObjectOrArray(value)) return JSON.stringify(value);
		return String(value);
	}
</script>

{#if version == null}
	<EmptyState title={t('app.settings.changes')} />
{:else}
	<Stack gap="md">
		<p class="text-meta">{t('component.diff_hint')}</p>
		<Combobox
			class="w-64"
			size="sm"
			aria-label={t('component.diff_against')}
			placeholder={t('component.diff_compare')}
			{options}
			value={against}
			onChange={(next) => (picked = next)}
		/>
		{#if against == null}
			<EmptyState title={t('component.diff_same_version')} />
		{:else if lines == null}
			<p class="text-meta">{t('component.loading')}</p>
		{:else if lines.length === 0}
			<EmptyState title={t('component.diff_no_differences')} />
		{:else}
			<Stack gap="sm">
				<p class="text-sm font-medium">{t('component.diff_settings_fields')}</p>
				<table class="w-full text-sm">
					<thead>
						<tr class="text-meta text-left">
							<th class="py-1 pr-3 font-medium">path</th>
							<th class="py-1 pr-3 font-medium">kind</th>
							<th class="py-1 pr-3 font-medium">left</th>
							<th class="py-1 font-medium">right</th>
						</tr>
					</thead>
					<tbody>
						{#each lines as line (`${line.path}:${line.kind}`)}
							<tr class="align-top">
								<td class="py-1 pr-3 font-mono text-xs">{line.path}</td>
								<td class="py-1 pr-3">{kindLabel(line.kind)}</td>
								<td class="py-1 pr-3 font-mono text-xs break-all">{cell(line.left)}</td>
								<td class="py-1 font-mono text-xs break-all">{cell(line.right)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Stack>
		{/if}
	</Stack>
{/if}
