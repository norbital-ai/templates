<script lang="ts">
	/**
	 * A text field whose valid values are the lineage's stored configuration, as a select: the codes
	 * of a version table in force on the day (`code · label`, under `parent` where given), the keys of
	 * the version's wage order (`wage`), or a given `codes` list. The write refuses anything else
	 * (`coded-fields.ts`), so a stored value outside the options is flagged, not hidden. A lineage
	 * with no codes leaves the field disabled. `multiple` edits a comma list, one code per part. An
	 * open sector classification (`sector_code_pattern`) takes any matching code, the known ones offered.
	 */
	import { t } from './t.js';
	import { Checkbox, Combobox, Input } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { wageKeys, type CodedVersion, type WageKeys } from '../coded-fields.js';
	import { todayKey } from './calendar.js';
	import { codeRows, versionInForce } from './code-rows.svelte.js';

	let {
		settingsCode,
		day,
		table,
		wage,
		codes,
		parent,
		value,
		multiple = false,
		clearable = true,
		disabled = false,
		onChange,
		'aria-label': ariaLabel
	}: {
		settingsCode?: string | null | undefined;
		/** The day whose version governs; today where none is named. */
		day?: string | null | undefined;
		/** A table of the version in force: its codes are the options. */
		table?: string | undefined;
		/** Or the keys of the version's wage order. */
		wage?: WageKeys | undefined;
		/** Or the caller's own codes. */
		codes?: readonly string[] | undefined;
		/** Only the table rows under this parent code. */
		parent?: string | null | undefined;
		value: string | null | undefined;
		multiple?: boolean;
		clearable?: boolean;
		disabled?: boolean;
		onChange: (next: string | null) => void;
		'aria-label'?: string;
	} = $props();

	const on = $derived(String(day || todayKey()).slice(0, 10));
	const version = versionInForce<Pick<CodedVersion, 'work_rules'>>(
		() => (codes == null ? settingsCode : null),
		() => on,
		() => (wage == null ? {} : { work_rules: true })
	);
	const rows = codeRows(
		() => version.current,
		() => (table == null || codes != null ? [] : [table]),
		() => on
	);
	const options = $derived(
		codes != null
			? codes.map((code) => ({ value: code, label: code }))
			: wage != null
				? wageKeys(version.current?.work_rules?.wages, wage)
						.toSorted()
						.map((code) => ({ value: code, label: code }))
				: rows.inForce
						.filter((row) => parent == null || row.parent_code === parent)
						.map((row) => ({
							value: row.code,
							label: row.label ? `${row.code} · ${row.label}` : row.code
						}))
	);
	const parts = $derived(
		(multiple ? (value ?? '').split(',') : [value ?? ''])
			.map((part) => part.trim())
			.filter((part) => part !== '')
	);
	const pattern = $derived(
		wage === 'sectors' ? version.current?.work_rules?.wages?.sector_code_pattern : null
	);
	const unlisted = $derived(
		parts.filter(
			(part) =>
				!options.some((option) => option.value === part) &&
				!(pattern != null && new RegExp(pattern).test(part))
		)
	);
	const listId = $props.id();
	const unused = $derived(options.length === 0);

	function toggle(code: string, checked: boolean): void {
		const next = checked ? [...parts, code] : parts.filter((part) => part !== code);
		onChange(next.length === 0 ? null : next.join(','));
	}
</script>

<Stack gap="xs">
	{#if multiple}
		{#each options as option (option.value)}
			<Inline gap="sm" class="text-sm">
				<Checkbox
					checked={parts.includes(option.value)}
					{disabled}
					aria-label={option.value}
					onCheckedChange={(checked: boolean) => toggle(option.value, checked)}
				/>
				<span class="min-w-0 flex-1 truncate">{option.label}</span>
			</Inline>
		{/each}
	{:else if pattern != null}
		<Input
			list={listId}
			value={parts[0] ?? ''}
			{disabled}
			aria-label={ariaLabel}
			aria-invalid={unlisted.length > 0}
			oninput={(event) => onChange(event.currentTarget.value.trim() || null)}
		/>
		<datalist id={listId}>
			{#each options as option (option.value)}<option value={option.value}></option>{/each}
		</datalist>
	{:else}
		<Combobox
			{clearable}
			{options}
			value={parts[0] ?? null}
			{...parts[0] == null ? {} : { display: parts[0] }}
			invalid={unlisted.length > 0}
			disabled={disabled || (unused && parts.length === 0)}
			placeholder={unused ? t('code_select.unused') : t('entity_facts.unrecorded')}
			{...ariaLabel == null ? {} : { 'aria-label': ariaLabel }}
			{onChange}
		/>
	{/if}
	{#if unlisted.length > 0}
		<p class="text-xs text-destructive" role="status">
			{t('code_select.unlisted', { value: unlisted.join(', ') })}
		</p>
	{:else if unused && multiple}
		<p class="text-meta">{t('code_select.unused')}</p>
	{/if}
</Stack>
