<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { Effect } from 'effect';
	import { PlainDate, addDays, datePeriod, eachDay, monthOf } from '@norbital-ai/std/date';
	import { Button, Combobox, notifyOutcome, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	import { todayKey } from '../format/calendar.js';

	let {
		entityId,
		employmentId: initialEmployment,
		record = null,
		onDone
	}: {
		entityId: Id<'entity'>;
		employmentId?: Id<'employee_contract'> | null;
		record?: Row<'leave_catalog_entry'> | null;
		onDone: () => void;
	} = $props();

	const clock = bolt.clock('day');
	const today = $derived(clock.today || todayKey());
	const [year, month] = today.split('-').map(Number) as [number, number];
	let at = $state(new Date(Date.UTC(year, month - 1, 1)));
	let chosen = $state<Id<'employee_contract'> | null>(initialEmployment ?? null);
	let catalog = $state<Id<'leave_catalog'> | null>(
		(record?.catalog_id as Id<'leave_catalog'> | undefined) ?? null
	);
	let sessions = $state<{ date: string; part: 'AM' | 'PM' }[]>(
		record === null
			? []
			: Array.isArray(record?.days)
				? record.days.flatMap((day) => {
						const date = String(Reflect.get(day, 'date') ?? '');
						const part = String(Reflect.get(day, 'part') ?? '');
						return date !== '' && (part === 'AM' || part === 'PM') ? [{ date, part }] : [];
					})
				: []
	);
	let saving = $state(false);

	const contracts = $derived(
		bolt.query({
			employee_contract: {
				where: { entity_id: { eq: entityId }, status: { eq: 'SEALED' } },
				fields: [
					'employee_number',
					'employee_name',
					'employee_id',
					'entity_id',
					'input_schema_version_id',
					'effective_range'
				],
				orderBy: { employee_number: 'asc' },
				limit: 10000
			}
		})
	);
	const contractOptions = $derived(
		(contracts.current?.employee_contract.rows ?? []).map((row) => ({
			value: row.id,
			label: `${row.employee_name} · ${row.employee_number}`
		}))
	);
	const contract = $derived(
		(contracts.current?.employee_contract.rows ?? []).find((row) => row.id === chosen) ?? null
	);
	const settings = $derived(
		contract === null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { id: { eq: contract.input_schema_version_id } },
						fields: ['id', 'code'],
						limit: 1
					}
				})
	);
	// leave is taken under the law in force, not the version the contract started on
	const versions = $derived(
		settings?.current?.jurisdiction_settings.rows[0] == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: {
							code: { eq: settings.current.jurisdiction_settings.rows[0]!.code },
							status: { eq: 'SEALED' }
						},
						fields: ['id', 'effective_range'],
						limit: 1000
					}
				})
	);
	const inForce = $derived(
		versions?.current?.jurisdiction_settings.rows.find(
			({ effective_range: range }) =>
				String(range.from) <= String(today) &&
				(range.to == null || String(today) <= String(range.to))
		) ?? settings?.current?.jurisdiction_settings.rows[0]
	);
	const catalogs = $derived(
		inForce == null
			? null
			: bolt.query({
					leave_catalog: {
						where: { settings_id: { eq: inForce.id } },
						fields: ['code', 'name', 'lookup'],
						orderBy: { code: 'asc' },
						limit: 10000
					}
				})
	);
	const balance = $derived(
		chosen === null || contract === null
			? null
			: bolt.query({
					employee_balance: {
						where: { employee_id: { eq: contract.employee_id } },
						fields: ['account'],
						limit: 1
					}
				})
	);
	const leaveAccount = $derived(
		(
			(balance?.current?.employee_balance.rows[0]?.account ?? {}) as Record<
				string,
				Record<string, number>
			>
		).leave ?? {}
	);
	const recordDays = $derived((record?.days?.length ?? 0) / 2);
	const availableFor = (row: {
		readonly id: string;
		readonly code: string;
		readonly lookup?: unknown;
	}) => {
		const lookup = (row.lookup ?? {}) as { readonly consumes_code?: string };
		const code = lookup.consumes_code ?? row.code;
		return Number(leaveAccount[code] ?? 0) + (record?.catalog_id === row.id ? recordDays : 0);
	};
	const catalogRows = $derived(catalogs?.current?.leave_catalog.rows ?? []);
	const catalogOptions = $derived(
		catalogRows
			.filter((row) => availableFor(row) > 0)
			.map((row) => ({
				value: row.id,
				label: `${row.code} · ${row.name}`,
				suffix: `${availableFor(row)} d`
			}))
	);
	const monthKey = $derived(
		`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
	);
	const monthEnd = $derived(String(monthOf(`${monthKey}-01`).to));
	const dates = $derived(eachDay(datePeriod(`${monthKey}-01`, monthEnd)).map(String));
	const holidays = $derived(
		bolt.query({
			holiday: {
				where: {
					entity_id: { eq: entityId },
					date: { gte: PlainDate(`${monthKey}-01`), lte: PlainDate(monthEnd) },
					published_at: { isNull: false }
				},
				fields: ['date', 'name'],
				limit: 10000
			}
		})
	);
	const holidayByDate = $derived(
		new Map((holidays.current?.holiday.rows ?? []).map((row) => [String(row.date), row.name]))
	);
	const occupied = $derived(
		chosen === null
			? new Set<string>()
			: new Set(
					(
						bolt.query({
							leave_catalog_entry: {
								where: { employment_id: { eq: chosen } },
								fields: ['days'],
								limit: 10000
							}
						}).current?.leave_catalog_entry.rows ?? []
					).flatMap((row) =>
						(Array.isArray(row.days) ? row.days : []).flatMap((day) => {
							const date = String(Reflect.get(day, 'date') ?? '');
							const part = String(Reflect.get(day, 'part') ?? '');
							return date !== '' ? [`${date}:${part}`] : [];
						})
					)
				)
	);
	const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
	const blocked = (date: string) =>
		weekend(date) ||
		holidayByDate.has(date) ||
		date < String(contract?.effective_range.from ?? '') ||
		(contract?.effective_range.to != null && date > String(contract.effective_range.to));
	const selected = (date: string, part: 'AM' | 'PM') =>
		sessions.some((row) => row.date === date && row.part === part);
	const chosenCatalog = $derived(catalogRows.find((row) => row.id === catalog) ?? null);
	const availableDays = $derived(chosenCatalog === null ? 0 : availableFor(chosenCatalog));
	const selectedDays = $derived(sessions.length / 2);
	const overLimit = $derived(selectedDays > availableDays);
	let limitNotice = $state<string | null>(null);
	const toggle = (date: string, part: 'AM' | 'PM') => {
		if (catalog === null || blocked(date) || occupied.has(`${date}:${part}`)) return;
		if (selected(date, part)) {
			sessions = sessions.filter((row) => row.date !== date || row.part !== part);
			limitNotice = null;
			return;
		}
		if (selectedDays + 0.5 > availableDays) {
			limitNotice = `Only ${availableDays} day(s) available for this leave type.`;
			return;
		}
		sessions = [...sessions, { date, part }].sort((a, b) => a.date.localeCompare(b.date));
		limitNotice = null;
	};
	const submit = () => {
		if (saving || chosen === null || catalog === null || sessions.length === 0) return;
		saving = true;
		const effect =
			record === null
				? bolt.act('leave_catalog_entry.create', [
						{
							entity_id: entityId,
							employment_id: chosen,
							catalog_id: catalog,
							days: sessions.map((session) => ({
								date: PlainDate(session.date),
								part: session.part
							})),
							is_reversal: false
						}
					])
				: bolt.act('leave_catalog_entry.update', [
						{
							target: record.id,
							set: {
								days: sessions.map((session) => ({
									date: PlainDate(session.date),
									part: session.part
								}))
							}
						}
					]);
		fork(
			effect.pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.tap(() => Effect.sync(() => onDone())),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (saving = false)))
			)
		);
	};
	const shiftMonth = (delta: number) =>
		(at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + delta, 1)));
	const monthLabel = $derived(
		new Intl.DateTimeFormat(bolt.locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(at)
	);
	const weekday = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const PARTS = ['AM', 'PM'] as const;
</script>

<Stack gap="md">
	<div class="grid gap-3 sm:grid-cols-2">
		<Stack gap="xs">
			<span class="text-xs font-medium text-muted-foreground">Employment</span>
			<Combobox
				options={contractOptions}
				value={chosen}
				placeholder="Select employment"
				aria-label="Employment"
				onChange={(value) => {
					chosen = value;
					catalog = null;
					sessions = [];
					limitNotice = null;
				}}
			/>
		</Stack>
		<Stack gap="xs" class="relative">
			<span class="text-xs font-medium text-muted-foreground">Catalog</span>
			<Combobox
				options={catalogOptions}
				value={catalog}
				placeholder="Select leave type"
				aria-label="Leave type"
				onChange={(value) => {
					catalog = value;
					limitNotice = null;
				}}
			/>
			{#if chosenCatalog !== null}<span
					class="pointer-events-none absolute top-6 right-9 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
					>{availableDays} d left</span
				>{/if}
		</Stack>
	</div>

	<div class="rounded-xl border">
		<Cluster justify="between" class="border-b px-3 py-2">
			<Button variant="ghost" onclick={() => shiftMonth(-1)}>‹</Button>
			<span class="text-sm font-medium">{monthLabel}</span>
			<Button variant="ghost" onclick={() => shiftMonth(1)}>›</Button>
		</Cluster>
		<div
			class="grid grid-cols-7 border-b bg-muted/40 text-center text-[10px] font-medium text-muted-foreground"
		>
			{#each weekday as day, index (index)}<span class="py-1">{day}</span>{/each}
		</div>
		<div class="grid grid-cols-7">
			{#each dates as date (date)}
				{@const holiday = holidayByDate.get(date)}
				<div
					class="flex min-h-24 flex-col border-b border-r p-1 text-xs last:border-r-0"
					class:bg-muted={weekend(date) || holiday != null}
					class:opacity-40={blocked(date)}
					title={holiday}
				>
					<span class="block text-[10px] tabular-nums text-muted-foreground"
						>{Number(date.slice(8))}</span
					>
					<div class="mt-1 flex flex-1 gap-0.5">
						{#each PARTS as part (part)}
							<button
								type="button"
								aria-label={`${date} ${part}`}
								aria-pressed={selected(date, part)}
								disabled={catalog === null ||
									blocked(date) ||
									occupied.has(`${date}:${part}`) ||
									(!selected(date, part) && selectedDays >= availableDays)}
								class="min-h-8 flex-1 rounded border px-0.5 py-1 text-[10px] transition-colors {selected(
									date,
									part
								)
									? 'border-foreground bg-foreground text-background'
									: 'border-border text-muted-foreground hover:border-foreground'}"
								onclick={() => toggle(date, part)}
							>
								{part}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<Cluster justify="between">
		<span
			class={overLimit || limitNotice !== null
				? 'text-xs text-destructive'
				: 'text-xs text-muted-foreground'}
		>
			{limitNotice ?? `${selectedDays} of ${availableDays} day(s) selected`}
		</span>
		<Cluster gap="sm">
			<Button variant="secondary" onclick={onDone} disabled={saving}>Cancel</Button>
			<Button
				onclick={submit}
				disabled={saving || sessions.length === 0 || catalog === null || overLimit}
			>
				{record === null ? 'Request leave' : 'Save days'}
			</Button>
		</Cluster>
	</Cluster>
</Stack>
