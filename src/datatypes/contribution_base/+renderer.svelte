<script lang="ts">
	/**
	 * One scheme's wage base, as the statute states it: four work lines to tick, then every
	 * catalogue row of the version on screen, grouped by family, to tick. What is ticked is in the
	 * base; the line's own landing decides whether it adds or subtracts.
	 *
	 * The rows come from the Settings page's version scope, the same scope the catalogue forms
	 * prefill their `settings_id` from. Opened without that scope only the four work lines show.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import {
		BASE_ENTRY_FAMILIES,
		EMPTY_BASE,
		type BaseEntryFamily,
		type ContributionBase
	} from './+definition.js';
	import type { RendererProps } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const base = $derived<ContributionBase>(props.value ?? EMPTY_BASE);

	const scope = hrCreateScope();
	const settingsId = $derived(scope?.settingsId?.());
	const approved = { approval_id: { isNull: true } } as const;
	const query = () => ({
		where: { settings_id: { eq: settingsId ?? '' }, ...approved },
		columns: { id: true, code: true, name: true },
		orderBy: { code: 'asc' as const },
		limit: 500
	});
	// An `eq: ''` on a uuid column is a query the live planner refuses, so nothing is asked
	// without a version.
	const rowsOf = (family: BaseEntryFamily) => {
		if (settingsId == null) return [];
		switch (family) {
			case 'LEAVE':
				return client.db.leave_catalogue.findMany(query())?.current ?? [];
			case 'ALLOWANCE':
				return client.db.allowance_catalogue.findMany(query())?.current ?? [];
			case 'CLAIM':
				return client.db.claim_catalogue.findMany(query())?.current ?? [];
			case 'PAYMENT':
				return client.db.payment_catalogue.findMany(query())?.current ?? [];
			case 'LOAN':
				return client.db.loan_catalogue.findMany(query())?.current ?? [];
		}
	};
	const families = $derived(
		BASE_ENTRY_FAMILIES.map((family) => ({ family, rows: rowsOf(family) })).filter(
			(group) => group.rows.length > 0
		)
	);

	const WORK_LINES = ['salary', 'absence', 'overtime', 'night_premium'] as const;
	const listed = (family: BaseEntryFamily, code: string) =>
		base.entries.some((entry) => entry.family === family && entry.code === code);

	function emit(next: ContributionBase): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
	function toggleWork(line: (typeof WORK_LINES)[number], checked: boolean): void {
		emit({ ...base, [line]: checked });
	}
	function toggleEntry(family: BaseEntryFamily, code: string, checked: boolean): void {
		const rest = base.entries.filter((entry) => !(entry.family === family && entry.code === code));
		emit({ ...base, entries: checked ? [...rest, { family, code }] : rest });
	}
	const exemptOf = (family: BaseEntryFamily, code: string) =>
		base.entries.find((entry) => entry.family === family && entry.code === code)?.annual_exempt ??
		null;
	function setExempt(family: BaseEntryFamily, code: string, raw: string): void {
		const amount = Number(raw);
		emit({
			...base,
			entries: base.entries.map((entry) =>
				entry.family === family && entry.code === code
					? { ...entry, annual_exempt: Number.isFinite(amount) && amount > 0 ? amount : null }
					: entry
			)
		});
	}
</script>

<div class="flex w-full flex-col gap-3 text-sm">
	<div class="flex flex-col gap-1">
		<span class="text-meta">{t('renderer.contribution_base.work_hint')}</span>
		{#each WORK_LINES as line (line)}
			<label class="flex items-center gap-2">
				<input
					class="size-4"
					type="checkbox"
					{disabled}
					checked={base[line]}
					onchange={(event) => toggleWork(line, event.currentTarget.checked)}
				/>
				<span>{t(`renderer.contribution_base.${line}`)}</span>
			</label>
		{/each}
	</div>
	{#if families.length > 0}
		<span class="text-meta">{t('renderer.contribution_base.entries_hint')}</span>
		{#each families as group (group.family)}
			<div class="flex flex-col gap-1">
				<span class="font-medium">{group.family}</span>
				{#each group.rows as row (row.id)}
					<label class="flex items-center gap-2">
						<input
							class="size-4"
							type="checkbox"
							{disabled}
							checked={listed(group.family, row.code)}
							onchange={(event) => toggleEntry(group.family, row.code, event.currentTarget.checked)}
						/>
						<span class="font-mono text-xs">{row.code}</span>
						<span class="text-meta truncate">{row.name ?? ''}</span>
						{#if listed(group.family, row.code)}
							<input
								class="ml-auto w-28 rounded border px-2 py-0.5 text-xs"
								type="number"
								min="0"
								{disabled}
								placeholder={t('renderer.contribution_base.annual_exempt')}
								title={t('renderer.contribution_base.annual_exempt')}
								value={exemptOf(group.family, row.code) ?? ''}
								onchange={(event) => setExempt(group.family, row.code, event.currentTarget.value)}
							/>
						{/if}
					</label>
				{/each}
			</div>
		{/each}
	{:else if base.entries.length > 0}
		<span class="font-mono text-xs">{base.entries.map((entry) => entry.code).join(', ')}</span>
	{/if}
</div>
