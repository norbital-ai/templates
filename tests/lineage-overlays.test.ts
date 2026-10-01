// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Locality overlays (capability E8): a base version routes a day to an overlay lineage by a person
 * expression over the worksite. The overlay replaces only what it states (named work-rule parts,
 * leave rows by code, tables by name); schemes stay with the base. Hand-computed, jurisdiction-free.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { composeOverlay, overlayFault, overlayInForce } from '../src/lib/jurisdiction_settings.ts';
import { atWorksite } from '../src/lib/payroll/run/configuration.ts';
import { DATED } from '../src/lib/payroll/run/eligibility.ts';
import { worksiteOn } from '../src/data/collection/worksites/lib/in-force.ts';

const ROUTE = {
	lineage: 'BASE-ISLE',
	when: 'worksite.region in ["ISLE"]',
	work_rules: ['daily_month_days', 'limits'],
	authority: 'Island Labour Order s.1'
};

const version = (id, code, fields = {}) => ({
	id,
	code,
	jurisdiction_code: 'BASE',
	name: `${code} ${id}`,
	sealed_at: '2026-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { from: '2026-01-01', to: null },
	tables: [],
	...fields
});

const baseRules = {
	daily_month_days: '26',
	limits: [{ measure: 'DAILY_HOURS', max: 8 }],
	breaks: [],
	holiday_rest_precedence: 'HOLIDAY'
};
const isleRules = {
	daily_month_days: '30',
	limits: [{ measure: 'DAILY_HOURS', max: 9 }],
	breaks: [{ after_hours: 5 }],
	holiday_rest_precedence: 'REST'
};
const BASE = version('b1', 'BASE', {
	work_rules: baseRules,
	overlays: [ROUTE],
	tables: [
		{ name: 'floor', keys: [], columns: [] },
		{ name: 'grade', keys: [], columns: [] }
	]
});
const ISLE = version('i1', 'BASE-ISLE', {
	work_rules: isleRules,
	tables: [{ name: 'floor', keys: ['code'], columns: [] }]
});

test('a day routes to the overlay whose condition holds, and only one may claim it', () => {
	const holds = (region) => (when) => when.includes(`"${region}"`);
	assert.equal(overlayInForce([ROUTE], [ISLE], '2026-01-10', holds('MAIN')), null);
	assert.equal(overlayInForce([ROUTE], [ISLE], '2026-01-10', holds('ISLE')).version.id, 'i1');
	// routed before the overlay's first version: the base's law must not price it
	assert.throws(
		() => overlayInForce([ROUTE], [ISLE], '2025-12-31', holds('ISLE')),
		/routed to overlay BASE-ISLE, which has no sealed version/
	);
	const twin = { ...ROUTE, lineage: 'BASE-OTHER' };
	assert.throws(
		() => overlayInForce([ROUTE, twin], [ISLE], '2026-01-10', holds('ISLE')),
		/both claim 2026-01-10/
	);
});

test('the composed version keeps the base id and replaces only the declared parts and named tables', () => {
	const composed = composeOverlay(BASE, { declaration: ROUTE, version: ISLE });
	assert.equal(composed.id, 'b1');
	assert.equal(composed.work_rules.daily_month_days, '30');
	assert.deepEqual(composed.work_rules.limits, [{ measure: 'DAILY_HOURS', max: 9 }]);
	// not declared: the base's stand even though the overlay states them
	assert.deepEqual(composed.work_rules.breaks, []);
	assert.equal(composed.work_rules.holiday_rest_precedence, 'HOLIDAY');
	assert.deepEqual(
		composed.tables.map((table) => [table.name, table.keys]),
		[
			['grade', []],
			['floor', ['code']]
		]
	);
});

test('the seal refuses an overlay that carries schemes, omits a part, routes further or is its own base', () => {
	assert.equal(overlayFault('BASE', ROUTE, ISLE, []), null);
	assert.match(overlayFault('BASE', ROUTE, ISLE, ['PENSION']), /declares schemes PENSION/);
	assert.match(
		overlayFault('BASE', ROUTE, { ...ISLE, work_rules: { limits: [] } }, []),
		/does not state work_rules\.daily_month_days/
	);
	assert.match(
		overlayFault('BASE', ROUTE, { ...ISLE, overlays: [ROUTE] }, []),
		/does not route further/
	);
	assert.match(overlayFault('BASE-ISLE', ROUTE, ISLE, []), /cannot overlay itself/);
	// another lineage's version is not this declaration's to judge
	assert.equal(overlayFault('BASE', ROUTE, { ...ISLE, code: 'ELSEWHERE' }, ['PENSION']), null);
});

const sites = [
	{
		id: 'main',
		company_id: 'c1',
		code: 'HQ',
		region: 'MAIN',
		facts: {},
		effective_range: { from: '2025-01-01', to: null }
	},
	{
		id: 'isle',
		company_id: 'c1',
		code: 'PORT',
		region: 'ISLE',
		facts: {},
		effective_range: { from: '2025-01-01', to: null }
	}
];
const terms = [
	{ id: 't1', worksite_id: 'main', effective_range: { from: '2026-01-01', to: '2026-01-15' } },
	{ id: 't2', worksite_id: 'isle', effective_range: { from: '2026-01-16', to: null } }
];
const holiday = (id, date, worksite) => ({
	id,
	company_id: 'c1',
	date,
	name: id,
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	given_to: 'EVERYONE',
	worksite,
	published_at: '2025-12-01T00:00:00.000Z'
});

function configuration() {
	const schemes = [{ row: { code: 'PENSION' }, rules: [] }];
	return {
		company: {
			id: 'c1',
			[DATED]: {
				tables: () => undefined,
				worksite: (id, asOf) => worksiteOn(sites, id, asOf)
			}
		},
		jurisdiction: BASE,
		lineageVersions: [BASE],
		work: { ...baseRules, settings_id: 'b1', jurisdiction_code: 'BASE' },
		holidayRestPrecedence: 'HOLIDAY',
		lastRestDayOnly: false,
		limits: baseRules.limits,
		breaks: [],
		nightPremium: null,
		contributions: schemes,
		catalogueLeaves: [
			{ id: 'l1', code: 'ANNUAL', entitlement: 8 },
			{ id: 'l2', code: 'SICK', entitlement: 14 }
		],
		holidays: new Map(),
		holidayRows: [
			holiday('isle-early', '2026-01-10', 'ISLE'),
			holiday('isle-late', '2026-01-20', 'ISLE'),
			holiday('all', '2026-01-01', null)
		],
		holidayWindow: { start: '2026-01-01', end: '2026-01-31' },
		worksites: sites,
		referenceRows: new Map(),
		overlay: {
			asOf: '2026-01-31',
			declarations: [ROUTE],
			versions: [ISLE],
			leaves: new Map([['i1', [{ id: 'l3', code: 'ANNUAL', entitlement: 12 }]]])
		}
	};
}

test('a mid-month transfer to a routed worksite switches work rules, leave rows and local holidays on the day', () => {
	const base = configuration();
	const seen = atWorksite(base, terms);
	const before = seen.onDay('2026-01-15');
	const after = seen.onDay('2026-01-16');
	assert.equal(before.work.daily_month_days, '26');
	assert.equal(after.work.daily_month_days, '30');
	assert.deepEqual(after.limits, [{ measure: 'DAILY_HOURS', max: 9 }]);
	// settings_id stays the base's: schemes and catalogues keyed to it keep governing
	assert.equal(after.work.settings_id, 'b1');
	assert.deepEqual(
		after.catalogueLeaves.map((row) => [row.code, row.entitlement]),
		[
			['SICK', 14],
			['ANNUAL', 12]
		]
	);
	assert.deepEqual(
		before.catalogueLeaves.map((row) => row.entitlement),
		[8, 14]
	);
	// the run's pick day (31 Jan) is on the island, so the top level reads the overlay
	assert.equal(seen.work.daily_month_days, '30');
	// the schemes are the base's, untouched by the route
	assert.equal(seen.contributions, base.contributions);
	// a local day reaches the region only on the days the worker is placed there
	assert.deepEqual([...seen.holidays.keys()].toSorted(), ['2026-01-01', '2026-01-20']);
});

test('a work day away from the terms worksite routes that day alone', () => {
	const seen = atWorksite(configuration(), terms, [
		{ work_date: '2026-01-05', worksite_id: 'isle' }
	]);
	assert.equal(seen.onDay('2026-01-05').work.daily_month_days, '30');
	assert.equal(seen.onDay('2026-01-06').work.daily_month_days, '26');
	assert.deepEqual([...seen.holidays.keys()].toSorted(), ['2026-01-01', '2026-01-20']);
});

test('a version with no overlays and no local days is returned as read', () => {
	const plain = { ...configuration(), overlay: undefined, holidayRows: [] };
	assert.equal(atWorksite(plain, terms), plain);
});
