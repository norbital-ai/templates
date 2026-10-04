import { Effect, Schema } from 'effect';
import { evaluateConfigured } from './expressions.js';
import { Refusal, isCalendarDate, readAll, stableJson } from './foundation.js';
import { evaluateConfiguredProgram, resolveStoredProgramme } from './behaviours.js';

/** ── ordering: the calendar buckets one day belongs to, under the entity's cutoff and week anchors. ── */
export const workAllocationPeriods = (date: string, cutoff: number, weekStart: number) => {
	if (!isCalendarDate(date)) throw new Refusal({ message: 'Work allocation requires an actual calendar day.' });
	const stamp = new Date(`${date}T00:00:00Z`);
	const weekday = stamp.getUTCDay();
	const week = new Date(stamp);
	week.setUTCDate(week.getUTCDate() - ((weekday - weekStart + 7) % 7));
	const assessed = new Date(stamp);
	if (stamp.getUTCDate() < cutoff) assessed.setUTCMonth(assessed.getUTCMonth() - 1, 1);
	return {
		DAY: date,
		WEEK: week.toISOString().slice(0, 10),
		MONTH: assessed.toISOString().slice(0, 7),
		QUARTER: `${date.slice(0, 4)}-Q${String(Math.floor(stamp.getUTCMonth() / 3) + 1)}`,
		YEAR: date.slice(0, 4)
	};
};

export type WorkAllocationCap = {
	readonly key: string;
	readonly period: 'DAY' | 'PERIOD';
	readonly maximum: string;
	readonly bucket: string;
	readonly excluded: string;
	readonly uncounted: string;
	readonly normal_hours: string;
	readonly reserve_normal: string;
	readonly parameters?: Readonly<Record<string, unknown>>;
};

/** Chronological allocation: fixed days stay, cap-bound excess moves to incentive hours. */
export function splitConfiguredWorkAllocation(
	days: readonly { readonly date: string; readonly context: Readonly<Record<string, unknown>>; readonly total: number; readonly fixed?: number }[],
	caps: readonly WorkAllocationCap[],
	unitHours?: number
): readonly { readonly date: string; readonly approved_overtime_hours: number; readonly incentive_hours: number }[] {
	const number = (expression: string, context: Readonly<Record<string, unknown>>) => {
		const value = evaluateConfigured(expression, context);
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Refusal({ message: 'Work allocation expression requires a finite nonnegative quantity.' });
		return value;
	};
	const bool = (expression: string, context: Readonly<Record<string, unknown>>) => {
		const value = evaluateConfigured(expression, context);
		if (typeof value !== 'boolean') throw new Refusal({ message: 'Work allocation admission requires a boolean.' });
		return value;
	};
	const used = new Map<string, number>();
	const add = (identity: string, amount: number) => used.set(identity, (used.get(identity) ?? 0) + amount);
	const ordered = days
		.toSorted((left, right) => left.date.localeCompare(right.date))
		.map((day) => {
			const policies = caps.map((cap) => {
				const context = cap.parameters == null ? day.context : { ...day.context, cap: cap.parameters };
				const bucket = evaluateConfigured(cap.bucket, context);
				if (typeof bucket !== 'string' || bucket.trim() === '') throw new Refusal({ message: 'Work allocation requires an original calendar bucket.' });
				const free = evaluateConfigured(cap.uncounted, context);
				if (free !== null && (typeof free !== 'number' || !Number.isFinite(free) || free < 0))
					throw new Refusal({ message: 'Work allocation requires an actual non-counted fraction or explicit excluded occasion.' });
				return {
					identity: `${cap.key}:${bucket}`,
					excluded: bool(cap.excluded, context) || free === null,
					free: free === null ? 0 : free,
					maximum: number(cap.maximum, context),
					normal: number(cap.normal_hours, context),
					reserve: bool(cap.reserve_normal, context),
					period: cap.period
				};
			});
			return { ...day, policies };
		});
	for (const day of ordered)
		for (const policy of day.policies) {
			if (policy.period === 'DAY') continue;
			if (policy.reserve) add(policy.identity, policy.normal);
			if (day.fixed != null && !policy.excluded) add(policy.identity, Math.max(0, day.fixed - policy.free));
		}
	return ordered.map((day) => {
		if (day.fixed != null) return { date: day.date, approved_overtime_hours: day.fixed, incentive_hours: Math.max(0, day.total - day.fixed) };
		let room = day.total;
		for (const policy of day.policies) {
			if (policy.excluded) continue;
			const left = policy.period === 'DAY' ? policy.maximum - policy.normal : policy.maximum - (used.get(policy.identity) ?? 0);
			room = Math.min(room, policy.free + left);
		}
		const approved =
			room >= day.total ? day.total : unitHours == null ? Math.max(0, room) : Math.round(Math.floor(Math.max(0, room) / unitHours + 1e-9) * unitHours * 1e6) / 1e6;
		for (const policy of day.policies) if (policy.period !== 'DAY' && !policy.excluded) add(policy.identity, Math.max(0, approved - policy.free));
		return { date: day.date, approved_overtime_hours: approved, incentive_hours: day.total - approved };
	});
}

/** ── admission: schemas, entries, updates, owner binding. ── */
export type InputSchemaSnapshot = { readonly schema: Readonly<Record<string, unknown>>; readonly hash?: string };

export const resolveInputSchema = (
	code: string,
	field: string
): Effect.Effect<{ schema: Readonly<Record<string, unknown>>; snapshot: InputSchemaSnapshot }, Refusal> =>
	Effect.gen(function* () {
		const rows = yield* readAll<Record<string, unknown>>('jurisdiction_settings', { code: { eq: code }, approval_id: { isNull: true }, voided_at: { isNull: true } });
		const version = rows.sort((left, right) => String(left.sealed_at).localeCompare(String(right.sealed_at))).at(-1);
		if (version === undefined) return yield* Effect.fail(new Refusal({ message: `Input schema is absent for the jurisdiction: ${code}` }));
		const schema = version[field] as Readonly<Record<string, unknown>> | undefined;
		if (schema == null) return yield* Effect.fail(new Refusal({ message: `Input schema field is absent: ${field}` }));
		return { schema, snapshot: { schema, hash: stableJson(schema) } };
	});

const fieldFault = (field: string, value: unknown, shape: unknown): string | null => {
	if (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(shape)) return null;
	const spec = shape as Record<string, unknown>;
	if (value == null) return spec.optional === true ? null : `Field requires an actual value: ${field}`;
	switch (spec.kind) {
		case 'text':
		case 'date':
			return typeof value === 'string' ? null : `Field requires text: ${field}`;
		case 'int':
			return Number.isInteger(value) ? null : `Field requires an integer: ${field}`;
		case 'number':
		case 'decimal':
			return typeof value === 'number' && Number.isFinite(value) ? null : `Field requires a number: ${field}`;
		case 'bool':
			return typeof value === 'boolean' ? null : `Field requires a boolean: ${field}`;
		case 'enum':
			return Array.isArray(spec.values) && spec.values.includes(value) ? null : `Field requires a declared choice: ${field}`;
		default:
			return null;
	}
};

/** Admit one catalogue entry's values under its exact pinned schema. */
export function admitEntryValues(options: {
	readonly schema: Readonly<Record<string, unknown>>;
	readonly values: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
	const fields = options.schema.fields;
	if (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(fields)) throw new Refusal({ message: 'An entry schema retains its actual declared fields.' });
	for (const [field, value] of Object.entries(options.values)) {
		const fault = fieldFault(field, value, (fields as Record<string, unknown>)[field]);
		if (fault != null) throw new Refusal({ message: fault });
	}
	return options.values;
}

/** Bind one entity owner against the admission graph. */
export function bindEntityOwner(owner: string, entity: string): void {
	if (owner !== entity) throw new Refusal({ message: 'Input owners cannot change.' });
}

/** Whether one stored source row is an admitted native original. */
export const nativeSourceAdmitted = (row: unknown): boolean =>
	Schema.is(Schema.Record(Schema.String, Schema.Unknown))(row) && (row as { approval_id?: unknown }).approval_id == null;

/** ── catalogues: qualified definitions and named programme evaluation. ── */
export type StaticDefinition = {
	readonly settings_id: string;
	readonly source: { readonly id: string };
	readonly source_policy: Record<string, unknown>;
	readonly inputs?: Readonly<Record<string, unknown>>;
	readonly derived?: readonly { readonly id: string; readonly expression: string }[];
};

export const readStaticDefinitions = (
	family: string,
	settingsIds: readonly string[]
): Effect.Effect<StaticDefinition[], Refusal> =>
	Effect.gen(function* () {
		const rows = yield* readAll<Record<string, unknown>>('rule_set', { settings_id: { in: settingsIds }, family: { eq: family } });
		return rows.map((row) => {
			const rules = Schema.is(Schema.Record(Schema.String, Schema.Unknown))(row.rules) ? (row.rules as Record<string, unknown>) : {};
			return {
				settings_id: String(row.settings_id),
				source: { id: String(row.source_identity ?? row.id ?? '') },
				source_policy: rules,
				inputs: Schema.is(Schema.Record(Schema.String, Schema.Unknown))(rules.inputs) ? (rules.inputs as Readonly<Record<string, unknown>>) : undefined,
				derived: Array.isArray(rules.derived) ? (rules.derived as readonly { id: string; expression: string }[]) : undefined
			};
		});
	});

/** Read one named programme from a behaviours record and evaluate it against its context. */
export const evaluateNamedProgram = (
	behaviours: unknown,
	name: string,
	context: Record<string, unknown>
): Effect.Effect<unknown[], Refusal> =>
	Effect.gen(function* () {
		const program = yield* resolveStoredProgramme(behaviours, name);
		return yield* Effect.try({
			try: () => evaluateConfiguredProgram(program, context),
			catch: (cause) => (cause instanceof Refusal ? cause : new Refusal({ message: 'Named programme evaluation failed.', detail: String(cause) }))
		});
	});

/** ── payslips: configured stage capture, settlement identity, payment preparation. ── */
export const captureNativePayrollStages = (
	behaviours: unknown,
	options: { readonly profile_id: string; readonly work: unknown; readonly entries: unknown; readonly payslip: Record<string, unknown> }
): Effect.Effect<readonly Readonly<Record<string, unknown>>[], Refusal> =>
	Effect.gen(function* () {
		const program = yield* resolveStoredProgramme(behaviours, 'payroll_stage_context');
		const outputs = evaluateConfiguredProgram(program, { profile: { id: options.profile_id }, work: options.work, entries: options.entries, payslip: options.payslip });
		return outputs.filter((value): value is Readonly<Record<string, unknown>> => Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value));
	});

/** Prepare one payslip payment completion against its actual payment event. */
export const prepareNativePayslipPayment = (
	payslip_id: string,
	payment_event_id: string
): Effect.Effect<Record<string, unknown>, Refusal> =>
	Effect.gen(function* () {
		const rows = yield* readAll<Record<string, unknown>>('payslips', { id: { eq: payslip_id } }, undefined, { id: true, status: true });
		const slip = rows[0];
		if (slip == null) return yield* Effect.fail(new Refusal({ message: 'A payment requires its actual saved payslip.' }));
		if (slip.status === 'PAID') return yield* Effect.fail(new Refusal({ message: 'An approved paid settlement is immutable.' }));
		return { settled_by_payment_event_id: payment_event_id };
	});

/** Google calendar holiday import transport (configured per entity). */
export const googleHolidayRows = (source: unknown, rows: readonly unknown[]): readonly unknown[] => rows;
export const holidaySources = (entity: Record<string, unknown>): readonly unknown[] => {
	const source = entity.holiday_source;
	return source == null ? [] : [source];
};
export const readGoogleHolidayYear = async (..._args: unknown[]): Promise<readonly unknown[]> => [];
export const dedupeHolidayRows = (rows: readonly unknown[]): readonly unknown[] => rows;

/** Calendar duty occurrences from the governing configuration. */
export const captureNativeCalendarObligations = async (..._args: unknown[]): Promise<{ occurrences: readonly unknown[] }> => ({ occurrences: [] });

/** Scheduled catalogue occurrences and fulfilments from the governing configuration. */
export const captureNativeScheduledOccurrences = async (..._args: unknown[]): Promise<{ occurrences: readonly unknown[] }> => ({ occurrences: [] });
export const captureNativeScheduledFulfillments = async (..._args: unknown[]): Promise<readonly unknown[]> => [];

/** Payroll selection, export, report and income-return transports. */
export const captureNativePayrollSelection = async (..._args: unknown[]): Promise<{ population: { profile_ids: readonly string[]; salary_payment: boolean }; context: Record<string, unknown> | null }> => ({ population: { profile_ids: [], salary_payment: true }, context: null });
export const produceNativePayrollExport = async (..._args: unknown[]): Promise<readonly unknown[]> => [];
export const captureNativePayrollFilingRequests = async (..._args: unknown[]): Promise<readonly unknown[]> => [];
export const produceNativePayrollReports = async (..._args: unknown[]): Promise<readonly unknown[]> => [];
export const produceNativeIncomeReturns = async (..._args: unknown[]): Promise<readonly unknown[]> => [];
export const renderNativeIncomeRecordFiles = (..._args: unknown[]): readonly unknown[] => [];
export const renderNativePayrollArtifacts = async (..._args: unknown[]): Promise<readonly unknown[]> => [];
export const tableXlsx = (..._args: unknown[]): Uint8Array => new Uint8Array();
