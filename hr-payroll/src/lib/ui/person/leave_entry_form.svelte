<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Effect } from 'effect';
	import { watch } from 'runed';
	import { PlainDate, datePeriod, eachDay, monthOf } from '@norbital-ai/std/date';
	import { Button, Combobox, notifyOutcome, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	import { todayKey } from '../format/calendar.js';
	import { accountsOf, eventsOf, leftOn, unlimited } from '../../ledger/core.js';
	import { isJsonObject, jsonObject } from '../../payroll_engine/foundation.js';
	import { chainOf, startsOf, versionOn } from '../../payroll_engine/contract_change.js';

	let {
		entityId,
		employmentId: initialEmployment,
		entry = null,
		reverses = null,
		encashment = false,
		catalogId = null,
		person = false,
		locked = false,
		onDone
	}: {
		entityId: Id<'entity'>;
		employmentId?: Id<'employee_contract'> | null;
		/** A filed entry: its open half-days change in place; the half-days a run sealed stay as they are. */
		entry?: Id<'leave_catalog_entry'> | null;
		/** The sealed entry this reversal undoes: the form asks only which of its sealed half-days to reverse. */
		reverses?: Id<'leave_catalog_entry'> | null;
		/** The corrected entry was a cash-out: its reversal must carry the flag or it only returns the days. */
		encashment?: boolean;
		catalogId?: Id<'leave_catalog'> | null;
		/** Names the person the entry is for: the HR controller's view; self-service is already theirs. */
		person?: boolean;
		/** Shows a filed entry without changing it: self-service, or a reversal. */
		locked?: boolean;
		onDone?: () => void;
	} = $props();

	const fixedEmployment = initialEmployment != null;
	const showPerson = $derived(!fixedEmployment || person);
	// a filed entry and a reversal keep their leave type
	const fixedCatalog = $derived(entry != null || reverses != null);
	const reversal = $derived(reverses != null);
	const editable = $derived(!locked);
	const clock = bolt.clock('day');
	const today = $derived(clock.today || todayKey());
	const [year, month] = today.split('-').map(Number) as [number, number];
	let at = $state(new Date(Date.UTC(year, month - 1, 1)));
	let chosen = $state<Id<'employee_contract'> | null>(initialEmployment ?? null);
	let catalog = $state<Id<'leave_catalog'> | null>(catalogId ?? null);
	let sessions = $state<{ date: string; part: 'AM' | 'PM' }[]>([]);
	let saving = $state(false);
	// the filed entry's half-days, or the original's when reversing it
	const shown = $derived(entry ?? reverses);
	const captures = $derived(
		shown == null
			? null
			: bolt.query({
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: shown } },
						fields: ['id', 'incurred_on', 'part', 'payroll_run_id'],
						orderBy: { incurred_on: 'asc' },
						limit: 10000
					}
				})
	);
	const sealed = $derived(
		new Set(
			(captures?.current?.leave_catalog_entry_day.rows ?? [])
				.filter((row) => row.payroll_run_id != null)
				.map((row) => `${String(row.incurred_on)}:${row.part}`)
		)
	);
	// a filed entry opens on its half-days; a reversal preselects the original's sealed ones, the only ones it may return
	let loaded = false;
	watch(
		() => captures?.current,
		(answer) => {
			if (answer === undefined || loaded) return;
			loaded = true;
			sessions = answer.leave_catalog_entry_day.rows
				.filter((row) => !reversal || row.payroll_run_id != null)
				.map((row) => ({ date: String(row.incurred_on), part: row.part }));
			if (sessions[0] !== undefined) at = new Date(`${sessions[0].date.slice(0, 7)}-01T00:00:00Z`);
		}
	);

	const contracts = $derived(
		bolt.query({
			employee_contract: {
				where: { entity_id: { eq: entityId }, status: { eq: 'SEALED' } },
				fields: [
					'employee_number',
					'employee_id',
					'entity_id',
					'effective_range',
					'service_started_on',
					'employee_extension_data',
					'events',
					'family',
					'terms'
				],
				orderBy: { employee_number: 'asc' },
				limit: 10000
			},
			'employee_contract.employee_id': { fields: ['name', 'cumulative_service'] },
			'employee_contract.entity_id': { fields: ['settings_code'] }
		})
	);
	const contractOptions = $derived(
		(contracts.current?.employee_contract.rows ?? []).map((row) => ({
			value: row.id,
			label: `${row.employee_id?.name ?? ''} · ${row.employee_number} · ${row.effective_range.from} to ${row.effective_range.to ?? 'now'}`
		}))
	);
	const contract = $derived(
		(contracts.current?.employee_contract.rows ?? []).find((row) => row.id === chosen) ?? null
	);
	// leave is taken under the law in force today, in the lineage of the contract's entity
	const code = $derived(contract?.entity_id?.settings_code);
	const versions = $derived(
		code === undefined
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { code: { eq: code }, status: { eq: 'SEALED' } },
						fields: ['id', 'code', 'effective_range'],
						limit: 1000
					}
				})
	);
	const inForce = $derived(
		versionOn(versions?.current?.jurisdiction_settings.rows ?? [], code, String(today))
	);
	const catalogs = $derived(
		inForce == null
			? null
			: bolt.query({
					leave_catalog: {
						// a filed entry and a reversal keep their own leave type, even one of an earlier version
						where:
							fixedCatalog && catalogId != null
								? { or: [{ settings_id: { eq: inForce.id } }, { id: { eq: catalogId } }] }
								: { settings_id: { eq: inForce.id } },
						fields: ['code', 'lookup'],
						orderBy: { code: 'asc' },
						limit: 10000
					}
				})
	);
	// the person's stints, for the service start their windows count from
	const stints = $derived(
		contract?.employee_id == null
			? null
			: bolt.query({
					employee_contract: {
						where: { employee_id: { eq: contract.employee_id.id }, status: { eq: 'SEALED' } },
						fields: ['employee_id', 'status', 'effective_range', 'entity_id'],
						limit: 1000
					},
					'employee_contract.entity_id': { fields: ['settings_code'] }
				})
	);
	const balance = $derived(
		chosen === null || contract?.employee_id == null
			? null
			: bolt.query({
					employee_balance: {
						where: { employee_id: { eq: contract.employee_id.id } },
						fields: ['account'],
						limit: 1
					}
				})
	);
	const leaveAccount = $derived(
		accountsOf(balance?.current?.employee_balance.rows[0]?.account ?? {})
	);
	const subject = $derived.by(() => {
		if (contract === null || inForce === undefined) return null;
		const { chain, lineage } = chainOf(
			(stints?.current?.employee_contract.rows ?? []).map(jsonObject)
		);
		const own = chain.find((row) => row.id === contract.id);
		return own === undefined
			? null
			: {
					scope: String(inForce.code),
					started: startsOf(own, chain, lineage, contract.employee_id?.cumulative_service === true)
						.service_started_on,
					events: eventsOf(jsonObject(contract))
				};
	});
	const recordDays = $derived(
		entry == null ? 0 : (captures?.current?.leave_catalog_entry_day.rows.length ?? 0) / 2
	);
	const availableFor = (row: {
		readonly id: string;
		readonly code: string;
		readonly lookup?: unknown;
	}) => {
		const lookup = jsonObject(row.lookup ?? {});
		if (unlimited(lookup)) return Infinity;
		const target = Array.isArray(lookup.accounts) ? lookup.accounts.find(isJsonObject) : undefined;
		const code = typeof target?.code === 'string' ? target.code : row.code;
		const counted = jsonObject(catalogRows.find((item) => item.code === code)?.lookup ?? lookup);
		const left =
			subject === null ? 0 : leftOn(leaveAccount, 'leave', code, counted, subject, String(today));
		// a row that counts in hours offers them as days of the contract's normal day
		const dayHours = counted.unit === 'HOUR' ? (contract?.terms.normal_hours_per_day ?? 0) : 0;
		return (
			(dayHours > 0 ? left / dayHours : left) +
			(entry != null && catalogId === row.id ? recordDays : 0)
		);
	};
	const isNoCap = (row: { readonly lookup?: unknown }) => unlimited(jsonObject(row.lookup ?? {}));
	const catalogRows = $derived(catalogs?.current?.leave_catalog.rows ?? []);
	const catalogOptions = $derived(
		catalogRows
			.filter((row) => reversal || availableFor(row) > 0)
			.map((row) => ({
				value: row.id,
				label: row.code,
				suffix: reversal || isNoCap(row) ? '' : `${availableFor(row)} d`
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
					published_at: { isNull: false },
					employee_id: { isNull: true }
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
								fields: ['id', 'employment_id'],
								limit: 10000
							},
							'leave_catalog_entry.leave_catalog_entry_day': {
								fields: ['id', 'incurred_on', 'part', 'payroll_run_id'],
								limit: 10000
							}
						}).current?.leave_catalog_entry.rows ?? []
					)
						.filter((row) => row.id !== entry)
						.flatMap((row) =>
							(row.leave_catalog_entry_day ?? []).flatMap((child) => {
								const date = String(child.incurred_on ?? '');
								const part = String(child.part ?? '');
								return date !== '' ? [`${date}:${part}`] : [];
							})
						)
				)
	);
	const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
	// an entry's days may run across the person's contract versions: any stint answers for its dates
	const employed = (date: string) =>
		(stints?.current?.employee_contract.rows ?? []).some(
			({ effective_range: range }) =>
				String(range.from) <= date && (range.to == null || date <= String(range.to))
		);
	const blocked = (date: string) => weekend(date) || holidayByDate.has(date) || !employed(date);
	// a filed entry's sealed half-day stays; a reversal may choose only the original's sealed ones
	const isSealed = (date: string, part: 'AM' | 'PM') => sealed.has(`${date}:${part}`);
	const selected = (date: string, part: 'AM' | 'PM') =>
		sessions.some((row) => row.date === date && row.part === part);
	const chosenCatalog = $derived(catalogRows.find((row) => row.id === catalog) ?? null);
	const availableDays = $derived(chosenCatalog === null ? 0 : availableFor(chosenCatalog));
	const selectedDays = $derived(sessions.length / 2);
	const overLimit = $derived(!reversal && selectedDays > availableDays);
	let limitNotice = $state<string | null>(null);
	const toggle = (date: string, part: 'AM' | 'PM') => {
		if (catalog === null || blocked(date) || (!reversal && occupied.has(`${date}:${part}`))) return;
		if (reversal && !isSealed(date, part)) return;
		if (selected(date, part)) {
			sessions = sessions.filter((row) => row.date !== date || row.part !== part);
			limitNotice = null;
			return;
		}
		if (!reversal && selectedDays + 0.5 > availableDays) {
			limitNotice = `Only ${availableDays} day(s) available for this leave type.`;
			return;
		}
		sessions = [...sessions, { date, part }].sort((a, b) => a.date.localeCompare(b.date));
		limitNotice = null;
	};
	const submit = () => {
		if (saving || chosen === null || catalog === null || sessions.length === 0) return;
		saving = true;
		const filed = entry;
		const effect =
			filed == null
				? bolt.act('leave_catalog_entry.create', [
						{
							entity_id: entityId,
							employment_id: chosen,
							catalog_id: catalog,
							leave_catalog_entry_day: sessions.map((session) => ({
								incurred_on: PlainDate(session.date),
								part: session.part
							})),
							...(reverses != null ? { reverses, ...(encashment ? { encashment: true } : {}) } : {})
						}
					])
				: (() => {
						const existing = captures?.current?.leave_catalog_entry_day.rows ?? [];
						const keep = new Set(sessions.map((session) => `${session.date}:${session.part}`));
						const remove = existing.filter(
							(row) =>
								row.payroll_run_id == null && !keep.has(`${String(row.incurred_on)}:${row.part}`)
						);
						const add = sessions.filter(
							(session) =>
								!existing.some(
									(row) => String(row.incurred_on) === session.date && row.part === session.part
								)
						);
						return bolt.act('leave_catalog_entry.update', [
							{
								target: filed,
								set: {
									leave_catalog_entry_day: {
										delete: remove.map((row) => row.id),
										create: add.map((session) => ({
											incurred_on: PlainDate(session.date),
											part: session.part
										}))
									}
								}
							}
						]);
					})();
		fork(
			effect.pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.tap(() => Effect.sync(() => onDone?.())),
				Effect.catch((error) =>
					Effect.sync(() =>
						// a registered rule speaks to the HR controller; its code is for the log
						toast.error(
							error instanceof Error
								? error.message.replace(/^[A-Z0-9_]+\.validate: /, '')
								: bolt.t('component.error')
						)
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
		{#if showPerson}<Stack gap="xs">
				<span class="text-xs font-medium text-muted-foreground">Employment</span>
				<Combobox
					options={contractOptions}
					value={chosen}
					placeholder="Select employment"
					aria-label="Employment"
					disabled={fixedEmployment}
					onChange={(value) => {
						chosen = value;
						catalog = null;
						sessions = [];
						limitNotice = null;
					}}
				/>
			</Stack>{/if}
		<Stack gap="xs" class={showPerson ? 'relative' : 'relative sm:col-span-2'}>
			<span class="text-xs font-medium text-muted-foreground">Catalog</span>
			<Combobox
				options={catalogOptions}
				value={catalog}
				placeholder="Select leave type"
				aria-label="Leave type"
				disabled={fixedCatalog}
				onChange={(value) => {
					catalog = value;
					limitNotice = null;
				}}
			/>
			{#if chosenCatalog !== null && !reversal && !isNoCap(chosenCatalog)}<span
					class="pointer-events-none absolute top-6 right-9 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
					>{availableDays} d left</span
				>{/if}
		</Stack>
	</div>

	{#if editable}<p class="text-xs text-muted-foreground">
			{reversal
				? 'Choose which of the sealed half-days to reverse. Filled buttons are selected; dimmed days cannot be chosen.'
				: 'Tap a half-day to select or deselect it. Filled buttons are selected; dimmed days are unavailable.'}
		</p>{/if}
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
			{#each dates as date, index (date)}
				{@const holiday = holidayByDate.get(date)}
				<div
					class="flex min-h-24 flex-col border-b border-r p-1 text-xs last:border-r-0"
					style:grid-column-start={index === 0
						? new Date(`${date}T00:00:00Z`).getUTCDay() + 1
						: undefined}
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
								disabled={!editable ||
									catalog === null ||
									blocked(date) ||
									(reversal
										? !isSealed(date, part)
										: (entry != null && isSealed(date, part)) ||
											occupied.has(`${date}:${part}`) ||
											(!selected(date, part) && selectedDays >= availableDays))}
								class="min-h-10 flex-1 rounded-md border px-0.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 {selected(
									date,
									part
								)
									? 'border-foreground bg-foreground font-medium text-background'
									: 'border-border text-muted-foreground hover:border-foreground hover:bg-muted'}"
								title={entry != null && isSealed(date, part)
									? 'Sealed by a payroll run; reverse the entry to return it.'
									: undefined}
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
			{limitNotice ??
				(reversal
					? `${selectedDays} day(s) to reverse`
					: editable && Number.isFinite(availableDays)
						? `${selectedDays} of ${availableDays} day(s) selected`
						: `${selectedDays} day(s)`)}
		</span>
		{#if editable}<Cluster gap="sm">
				{#if entry == null}<Button variant="secondary" onclick={onDone} disabled={saving}
						>Cancel</Button
					>{/if}
				<Button
					onclick={submit}
					disabled={saving || sessions.length === 0 || catalog === null || overLimit}
				>
					{entry != null ? 'Save days' : reversal ? 'Reverse leave' : 'Request leave'}
				</Button>
			</Cluster>{/if}
	</Cluster>
</Stack>
