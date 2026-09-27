<script lang="ts">
	/**
	 * A class's `counts_toward` as the HR reader decides it: one checkbox per scheme of the
	 * version, and beside a scheme that declares parts, which part of that scheme's base the class
	 * enters (whole base, or one named part). The value stays the model's code list
	 * (`SCHEME` or `SCHEME.PART`); the checklist is only its face.
	 *
	 * A `Field` editor: the form supplies the value and the change callback, so the label and
	 * errors stay the field's; `settingsId` is the row's version, whose schemes are offered.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Checkbox, Combobox } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';

	let {
		value,
		settingsId,
		disabled,
		onChange
	}: {
		value: unknown;
		settingsId: Id<'jurisdiction_settings'> | null;
		disabled: boolean;
		onChange: (next: string[]) => void;
	} = $props();
	const schemes = $derived(
		settingsId == null
			? null
			: bolt
					.read('statutory_contributions', {
						where: { settings_id: { eq: settingsId } },
						select: { code: true, name: true, parts: true },
						orderBy: { code: 'asc' },
						all: true
					})
					.then((page) => page.rows)
	);
	const selected = $derived(Array.isArray(value) ? value.map((code) => String(code)) : []);
	/** The membership of one scheme: '' when absent, the scheme code for the whole base, `CODE.PART` for a part. */
	const membership = (code: string): string =>
		selected.find((entry) => entry === code || entry.startsWith(`${code}.`)) ?? '';

	function set(code: string, entry: string): void {
		const rest = selected.filter((item) => item !== code && !item.startsWith(`${code}.`));
		onChange(entry === '' ? rest : [...rest, entry]);
	}
</script>

{#if schemes == null}
	<p class="text-meta">{bolt.t('component.counts_toward_needs_version')}</p>
{:else}
	{#await schemes then list}
		{#if list.length === 0}
			<p class="text-meta">{bolt.t('component.counts_toward_no_schemes')}</p>
		{:else}
			<Stack gap="xs">
				{#if selected.length === 0}
					<p class="text-meta">{bolt.t('component.counts_toward_nothing')}</p>
				{/if}
				<!-- The reserved WAGES mark: not a scheme, the earnings history a regular payment enters. -->
				<Inline gap="sm" class="text-sm">
					<Checkbox
						checked={selected.includes('WAGES')}
						{disabled}
						aria-label="WAGES"
						onCheckedChange={(checked: boolean) => set('WAGES', checked ? 'WAGES' : '')}
					/>
					<span class="min-w-0 flex-1">{bolt.t('component.counts_toward_wages')}</span>
				</Inline>
				{#each list as scheme (scheme.code)}
					{@const parts = scheme.parts ?? []}
					{@const current = membership(scheme.code)}
					<!-- Not a <label>: the checkbox is a button, and a label re-dispatches the click to it. -->
					<Inline gap="sm" class="text-sm">
						<Checkbox
							checked={current !== ''}
							{disabled}
							aria-label={scheme.code}
							onCheckedChange={(checked: boolean) => set(scheme.code, checked ? scheme.code : '')}
						/>
						<span class="min-w-0 flex-1 truncate"
							>{scheme.code}{scheme.name ? ` · ${scheme.name}` : ''}</span
						>
						{#if parts.length > 0 && current !== ''}
							<Combobox
								class="w-auto"
								size="sm"
								aria-label={scheme.code}
								options={[
									{ value: scheme.code, label: bolt.t('component.counts_toward_whole_base') },
									...parts.map((part) => ({ value: `${scheme.code}.${part}`, label: part }))
								]}
								value={current}
								{disabled}
								onChange={(next) => next != null && set(scheme.code, next)}
							/>
						{/if}
					</Inline>
				{/each}
			</Stack>
		{/if}
	{/await}
{/if}
