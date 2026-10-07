/** The shared behaviour pipeline of the row taps and the daily tick, over the canonical SG rules and fixture rows. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Act } from '@norbital-ai/bolt';
import {
	describeTrigger,
	runBehaviours,
	versionLookup
} from '../src/lib/payroll_engine/behaviour_runner.ts';
import type { HostRead } from '../src/lib/payroll_engine/foundation.ts';

type Row = Record<string, unknown>;
const [settings] = JSON.parse(
	readFileSync(
		resolve(process.cwd(), 'seed/jurisdiction/SG/version_2/jurisdiction_settings.json'),
		'utf8'
	)
) as Row[];
const COMPANY = 'c1';
const contract = (id: string, from: string, to: string | null = null): Row => ({
	id,
	company_id: COMPANY,
	employee_id: `p-${id}`,
	approval_id: null,
	effective_range: { from, to },
	facts: {}
});

const tables = new Map<string, Row[]>([
	['jurisdiction_settings', [{ ...settings, approval_id: null }]],
	['entity', [{ id: COMPANY, name: 'Omni', settings_code: 'SG', facts: {}, approval_id: null }]],
	[
		'employment_contract',
		[
			contract('k1', '2020-03-16'),
			contract('k2', '2024-01-01'),
			contract('k3', '2021-01-01', '2025-12-31')
		]
	],
	['employment_profile', [{ id: 'p-k1', nationality: 'SG', facts: {} }]],
	[
		'rule_set',
		[
			{
				settings_id: settings!.id,
				family: 'TASKS',
				code: 'SERVICE_ANNIVERSARY',
				name: 'Service anniversary',
				rules: {
					description: 'A record-driven anniversary duty.',
					authority: 'Test',
					trigger: { collection: 'calendar', event: 'daily' },
					when: 'today.substring(5) == contract.effective_range.from.substring(5)',
					applies_when: 'company.headcount == 2.0 && headcount == 2.0',
					due: 'add_days(today, 7)'
				}
			}
		]
	],
	['holiday', []],
	['regulatory_task', []],
	['claim_catalog', [{ id: 'cc1', code: 'MEDICAL', name: 'Medical' }]]
]);

const matches = (row: Row, where: Row): boolean =>
	Object.entries(where).every(([key, spec]) => {
		const value = row[key];
		const ops = spec as Row;
		return Object.entries(ops).every(([op, operand]) => {
			if (op === 'eq') return value === operand;
			if (op === 'in') return Array.isArray(operand) && operand.includes(value);
			if (op === 'isNull') return operand ? value == null : value != null;
			if (op === 'gte') return value != null && String(value) >= String(operand);
			if (op === 'lte') return value != null && String(value) <= String(operand);
			throw new Error(`fixture reader: unsupported operator ${op}`);
		});
	});
const read = (async (collection: string, query: { where?: Row; select?: Row }) => ({
	rows: (tables.get(collection) ?? [])
		.filter((row) => matches(row, query.where ?? {}))
		.map((row) =>
			query.select == null
				? row
				: Object.fromEntries(
						Object.keys({ id: true, ...query.select })
							.filter((key) => key in row)
							.map((key) => [key, row[key]])
					)
		)
})) as unknown as HostRead;

const written: { callable: string; data: Row }[] = [];
const act = (async (callable: string, data: Row) => {
	written.push({ callable, data });
	tables.get('regulatory_task')!.push({ company_id: COMPANY, ...data });
	return { kind: 'committed', output: undefined, records: [] };
}) as unknown as Act;

const tick = (day: string) =>
	Promise.all(
		tables
			.get('employment_contract')!
			.filter((row) => {
				const range = row.effective_range as { from: string; to: string | null };
				return range.from <= day && (range.to == null || range.to >= day);
			})
			.map((row) =>
				runBehaviours({
					collection: 'calendar',
					action: 'daily',
					row,
					day,
					subjects: [
						{
							company_id: COMPANY,
							employment_id: String(row.id),
							employee_id: String(row.employee_id)
						}
					],
					fields: async () => ({}),
					versionFor: versionLookup(read),
					read,
					act
				})
			)
	);

test('the daily tick raises a calendar task once a day for the employment it falls on', async () => {
	await tick('2026-03-16');
	assert.deepEqual(
		written.map(({ callable, data }) => [
			callable,
			data.code,
			data.subject_collection,
			data.due_on,
			data.occurrence_key
		]),
		[
			[
				'regulatory_task.create',
				'SERVICE_ANNIVERSARY',
				'calendar',
				'2026-03-23',
				'SERVICE_ANNIVERSARY:c1:k1:2026-03-16'
			]
		]
	);
	// The same day again raises nothing: the occurrence key holds the day.
	await tick('2026-03-16');
	assert.equal(written.length, 1);
	// Another day is another occurrence; this one is nobody's anniversary.
	await tick('2026-03-17');
	assert.equal(written.length, 1);
});

test('an entry trigger carries its class code and a paid payslip its paid day', async () => {
	assert.deepEqual(
		await describeTrigger('claim_catalog_entry', { id: 'e1', catalog_id: 'cc1' }, read),
		{
			id: 'e1',
			catalog_id: 'cc1',
			catalog_code: 'MEDICAL',
			catalog: { id: 'cc1', code: 'MEDICAL', name: 'Medical' }
		}
	);
	tables.set('payslip', [
		{
			id: 's1',
			base: [{ component_code: 'BASIC' }],
			adjustments: [{ component_code: 'BONUS' }, { component_code: 'BASIC' }]
		}
	]);
	assert.deepEqual(
		await describeTrigger('payslip', { id: 's1', paid_at: '2026-04-02T03:00:00.000Z' }, read),
		{
			id: 's1',
			paid_at: '2026-04-02T03:00:00.000Z',
			line_codes: ['BASIC', 'BONUS'],
			paid_on: '2026-04-02'
		}
	);
});

test('duty contexts name the coming published holidays: a task due a week before a named one', async () => {
	tables.get('rule_set')!.push({
		settings_id: settings!.id,
		family: 'TASKS',
		code: 'FESTIVE_ALLOWANCE',
		name: 'Festive allowance',
		rules: {
			description: 'Paid seven days before the named holiday.',
			authority: 'Test',
			trigger: { collection: 'calendar', event: 'daily' },
			when: 'today == "2026-02-02" && holidays_named.exists(h, h.name == "Idul Fitri")',
			due: 'add_days(first(holidays_named.filter(h, h.name == "Idul Fitri")).date, -7)'
		}
	});
	tables.set('holiday', [
		{
			company_id: COMPANY,
			date: '2026-01-01',
			name: 'New Year',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2025-12-01'
		},
		{
			company_id: COMPANY,
			date: '2026-03-20',
			name: 'Idul Fitri',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2025-12-01'
		},
		{
			company_id: COMPANY,
			date: '2027-03-10',
			name: 'Idul Fitri',
			kind: 'PUBLIC_HOLIDAY',
			published_at: '2025-12-01'
		}
	]);
	written.length = 0;
	await tick('2026-02-02');
	assert.deepEqual(
		written.filter(({ data }) => data.code === 'FESTIVE_ALLOWANCE').map(({ data }) => data.due_on),
		['2026-03-13', '2026-03-13']
	);
});
