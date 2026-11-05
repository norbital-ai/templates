import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestWorkspace, type TestOptions, type TestPorts } from '@norbital-ai/bolt-cli/test';
import { Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';

/** One scoped real workspace over this template's source, seeded by the rows a test writes. */
export const workspace = <P extends TestPorts = never>(
	options: Omit<
		Extract<TestOptions<P>, { artifact?: never }>,
		'root' | 'manifest' | 'guest' | 'transforms'
	> = {}
) => TestWorkspace.layer({ root: process.cwd(), ...options });

export const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
export const ENTITY = idOf('entity', uuid(1));
export const WORK = uuid(11),
	REST = uuid(12),
	OFF = uuid(13);
export const read = (path: string): readonly JsonObject[] => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	return Schema.decodeUnknownSync(Schema.Array(JsonObject))(Array.isArray(value) ? value : [value]);
};
type Day = {
	readonly date: string;
	readonly shift: string;
	readonly hours: number;
	readonly overtime?: number;
};
type Holiday = { readonly date: string; readonly kind: string };
/** One jurisdiction's public law plus one employee, one roster and the holidays of a month, on the law `on` that day. */
export const pack = (
	code: string,
	zone: string,
	terms: JsonObject,
	extension: JsonObject,
	days: readonly Day[],
	holidays: readonly Holiday[],
	on = '2026-02-15'
): { readonly [model: string]: readonly JsonObject[] } => {
	const rows: { [model: string]: JsonObject[] } = {};
	const root = join(process.cwd(), 'seed/public/jurisdiction', code);
	let settings = '';
	for (const version of readdirSync(root))
		for (const file of readdirSync(join(root, version))) {
			const own = read(join(root, version, file));
			(rows[file.replace('.json', '')] ??= []).push(...own);
			for (const row of own) {
				const { from, to } = Schema.decodeUnknownSync(
					Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
				)(file === 'jurisdiction_settings.json' ? row.effective_range : { from: '9', to: '0' });
				if (from <= on && (to === null || on <= to)) settings = String(row.id);
			}
		}
	const instant = (date: string, hours: number) =>
		new Date(Date.parse(`${date}T00:00:00.000Z`) + hours * 3_600_000).toISOString();
	const shift = (id: string, name: string, variant: JsonObject) => ({
		id,
		entity_id: ENTITY,
		code: name,
		name,
		effective_range: { from: '2025-01-01', to: null },
		variant
	});
	return {
		...rows,
		entity: [{ id: ENTITY, code: 'E1', name: 'Entity', settings_code: code }],
		entity_profile_version: [
			{
				id: uuid(2),
				entity_id: ENTITY,
				name: 'Entity',
				settings_code: code,
				input_schema_version_id: settings,
				effective_range: { from: '2025-01-01', to: null },
				time_zone: zone,
				pay_cutoff_day: 1,
				payment_schedule: {
					frequency: 'MONTHLY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					anchors: [{ cycle_part: 1, day: 25, month_offset: 0 }]
				},
				entity_extension_data: {},
				status: 'SEALED'
			}
		],
		sys_user: [{ id: uuid(3), name: 'Worker', email: 'worker@example.test', kind: 'staff' }],
		employee_profile: [{ id: uuid(4), user_id: uuid(3), name: 'Worker' }],
		employee_balance: [{ id: uuid(5), employee_id: uuid(4), account: {} }],
		employee_contract: [
			{
				id: uuid(6),
				employee_id: uuid(4),
				entity_id: ENTITY,
				employee_number: 'W1',
				employee_name: 'Worker',
				engagement: 'EMPLOYEE',
				status: 'SEALED',
				effective_range: { from: '2025-01-01', to: null },
				input_schema_version_id: settings,
				terms,
				payroll: { date_of_birth: '1990-01-01', gender: 'MALE', marital_status: 'SINGLE' },
				bank: {
					bank_name: 'Bank',
					bank_code: '001',
					bank_account_number: '1',
					bank_account_name: 'Worker'
				},
				employee_extension_data: extension,
				service_started_on: '2025-01-01'
			}
		],
		shift_definition: [
			shift(WORK, 'DAY', {
				day_type: 'WORK',
				start_time: '08:00',
				end_time: '16:00',
				ends_next_day: false,
				breaks: []
			}),
			shift(REST, 'REST', { day_type: 'REST', ends_next_day: false, breaks: [] }),
			shift(OFF, 'OFF', { day_type: 'OFF', ends_next_day: false, breaks: [] })
		],
		holiday: holidays.map((holiday, index) => ({
			id: uuid(20 + index),
			entity_id: ENTITY,
			date: holiday.date,
			name: holiday.kind,
			kind: holiday.kind,
			given_to: 'EVERYONE',
			published_at: '2025-12-01T00:00:00.000Z'
		})),
		roster_entry: days.map((day, index) => ({
			id: uuid(100 + index),
			employment_id: uuid(6),
			work_date: day.date,
			shift_definition_id: day.shift,
			actual_worked_intervals: [{ start: instant(day.date, 0), end: instant(day.date, day.hours) }],
			planned_overtime_intervals:
				day.shift === WORK && day.overtime === undefined
					? null
					: [
							{
								start: instant(day.date, day.hours - (day.overtime ?? day.hours)),
								end: instant(day.date, day.hours)
							}
						],
			findings: []
		}))
	};
};
