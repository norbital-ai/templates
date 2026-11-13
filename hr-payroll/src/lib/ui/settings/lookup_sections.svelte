<script lang="ts" module>
	/** What each single constant governs, by its key. The first match wins; the rest fall to `other`. */
	const GROUPS = [
		[
			'pay_basis',
			/^(half_step|months_per_year|weeks_per_year|year_days|daily_paid_days|bpjs_daily_wage_days|business_year|wage_period_share)|(^|_)units?$/
		],
		['minimum_pay', /^(hourly_wage|monthly_wage|daily_(four|five|six)_day_week)/],
		['working_time', /hours|minutes|^night_|overtime|^break_|^elapsed_|paid_multiple|half_pay/],
		[
			'tax',
			/tax|deduction|dependant|exempt|resident|withholding|employment_expense|commuting|parking|annual_bonus_and|breakpoint/
		],
		[
			'coverage',
			/(^|_)age(_|$)|categories|residenc|engagements|covered|nationality|minimum_(contract|service)|foreign_(minimum|employee)|count_threshold/
		],
		[
			'exit',
			/retire|retrench|severance|notice|final_pay|compensation|service_months|band_|tail|short_term|grounds|full_year/
		],
		['leave', /holiday|leave|first_tier/],
		[
			'contributions',
			/rate|share|ceiling|floor|threshold|grade|salary_credit|percent|midpoint|chargeable|insurance|multiplier|_step$|sdl_|ui_cap/
		],
		['other', /./]
	] as const;
	const RECORD = { kind: 'record', of: { kind: 'json' } } as const;
	const JSON_KIND = { kind: 'json' } as const;
	const isTable = (item: unknown) =>
		item !== null &&
		typeof item === 'object' &&
		(!Array.isArray(item) || item.some((row) => row !== null && typeof row === 'object'));
	const isCode = (item: unknown): item is string => typeof item === 'string' && item.includes('\n');
	/** The few keys whose name is not a sentence on its own. */
	const LABELS: Record<string, string> = {};
	const title = (key: string) =>
		LABELS[key] ?? `${key[0]?.toUpperCase()}${key.slice(1).replaceAll('_', ' ')}`;
</script>

<script lang="ts">
	/**
	 * A jurisdiction's global lookup: its single values by what they govern, an expression as code, then each table in its
	 * own collapsed section.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { CodeEditor, Section, StructuredData, type FieldEditor } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';

	type Value = FieldEditor['value'];
	let {
		ctx,
		value,
		name,
		disabled = false,
		on_change
	}: {
		ctx: PageContext;
		value: Value;
		name: string;
		disabled?: boolean;
		on_change?: (next: Value) => void;
	} = $props();

	const entries = $derived(
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? Object.entries(value)
			: []
	);
	const groups = $derived(
		GROUPS.flatMap(([group, test], at) => {
			const own = entries.filter(
				([key, item]) =>
					!isTable(item) && GROUPS.findIndex(([, rule]) => rule.test(key)) === at && test.test(key)
			);
			return own.length === 0
				? []
				: [
						{
							group,
							code: own.filter(([, item]) => isCode(item)),
							single: own.filter(([, item]) => !isCode(item))
						}
					];
		})
	);
	const tables = $derived(entries.filter(([, item]) => isTable(item)));
	const size = (item: Value) =>
		String(Array.isArray(item) ? item.length : Object.keys(Object(item)).length);
	const replacing = (keys: readonly string[], next: Value) => {
		const kept = entries.filter(([key]) => !keys.includes(key));
		on_change?.({ ...Object.fromEntries(kept), ...Object(next) });
	};
	const mode = $derived(on_change === undefined ? 'view' : 'edit');
</script>

<Stack gap="sm">
	{#each groups as { group, code, single } (group)}
		<Section name="lookup_{group}" title={ctx.t(`settings_lookup.${group}`)}>
			<Stack gap="md">
				{#if single.length > 0}<StructuredData
						{ctx}
						{name}
						{mode}
						{disabled}
						frame={false}
						kind={RECORD}
						value={Object.fromEntries(single)}
						on_change={(next) =>
							replacing(
								single.map(([key]) => key),
								next
							)}
					/>{/if}
				{#each code as [key, text] (key)}
					<Stack gap="xs">
						<span class="text-sm text-muted-foreground">{title(key)}</span>
						<CodeEditor
							language="javascript"
							wrap
							readonly={on_change === undefined}
							min_height="2.25rem"
							value={String(text)}
							aria-label={title(key)}
							on_change={(next) => replacing([key], { [key]: next })}
						/>
					</Stack>
				{/each}
			</Stack>
		</Section>
	{/each}
	{#each tables as [key, table] (key)}
		<Section name="lookup_{key}" title={title(key)} summary={size(table)} default_open={false}>
			<StructuredData
				{ctx}
				name={key}
				{mode}
				{disabled}
				kind={JSON_KIND}
				value={table}
				on_change={(next) => replacing([key], { [key]: next })}
			/>
		</Section>
	{/each}
</Stack>
