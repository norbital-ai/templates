import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { openPglite, type EngineManifest } from '@norbital-ai/bolt/engine';
import { testWorkspace } from '@norbital-ai/bolt/test';
import employeePolicy from '../src/access/+employee.policy.ts';
import { captureClaims, capturedWorkDayFrozen } from '../src/lib/ui/roster/capture-claims.ts';

test('employee capture evidence admits only own source links and masks every financial column', async () => {
	const compiled: EngineManifest = JSON.parse(
		readFileSync(new URL('../.norbital/artifact/manifest.json', import.meta.url), 'utf8')
	);
	const manifest: EngineManifest = {
		...compiled,
		models: {
			employees: {
				description: '',
				label: 'email',
				fields: { email: compiled.models.employees!.fields.email! }
			},
			employments: { description: '', label: 'reference', fields: { reference: { kind: 'text' } } },
			payslips: { description: '', label: 'reference', fields: { reference: { kind: 'text' } } },
			noncontract_settlements: {
				description: '',
				label: 'reference',
				fields: { reference: { kind: 'text' } }
			},
			payable_tranches: {
				description: '',
				label: 'reference',
				fields: {
					gross_amount: { kind: 'int' },
					reference: { kind: 'text' },
					source_kind: { kind: 'text' },
					source_id: { kind: 'text' }
				},
				search: { text: ['reference', 'source_kind', 'source_id'] }
			},
			payment_allocations: {
				description: '',
				label: 'gross_amount',
				fields: { gross_amount: { kind: 'int' } }
			}
		},
		relationships: {
			'employments.employee_id': { to: 'employees', inverse: 'employments' },
			'payslips.employment_id': { to: 'employments', inverse: 'payslips' },
			'payable_tranches.settlement': {
				to: ['payslips', 'noncontract_settlements'],
				inverse: 'payable_tranches'
			},
			'payment_allocations.payable_tranche_id': {
				to: 'payable_tranches',
				inverse: 'payment_allocations'
			}
		},
		collections: {
			employees: { read: { fields: 'all' } },
			employments: { read: { fields: 'all' } },
			payslips: { read: { fields: 'all' } },
			noncontract_settlements: { read: { fields: 'all' } },
			payable_tranches: { read: { fields: 'all' } },
			payment_allocations: { read: { fields: 'all' } }
		},
		policies: {
			employee: {
				description: employeePolicy.description,
				grants: {
					employees: employeePolicy.grants.employees,
					employments: employeePolicy.grants.employments,
					payslips: employeePolicy.grants.payslips,
					payable_tranches: employeePolicy.grants.payable_tranches,
					payment_allocations: employeePolicy.grants.payment_allocations
				}
			}
		},
		apps: {},
		automations: {},
		integrations: {},
		pipelines: {},
		teams: {},
		customFields: {}
	};
	const { db, pg } = await openPglite();
	try {
		const t = await testWorkspace({
			manifest,
			db,
			seed: {
				employees: [
					{ id: '00000000-0000-4000-8000-000000000001', email: 'own@example.test' },
					{ id: '00000000-0000-4000-8000-000000000002', email: 'other@example.test' }
				],
				employments: [1, 2].map((n) => ({
					id: `00000000-0000-4000-8000-00000000001${n}`,
					reference: String(n),
					employee_id: `00000000-0000-4000-8000-00000000000${n}`
				})),
				payslips: [1, 2].map((n) => ({
					id: `00000000-0000-4000-8000-00000000002${n}`,
					reference: String(n),
					employment_id: `00000000-0000-4000-8000-00000000001${n}`
				})),
				payable_tranches: [1, 2].map((n) => ({
					id: `00000000-0000-4000-8000-00000000003${n}`,
					gross_amount: 100,
					reference: `SOURCE-${n}`,
					source_kind: 'REGULAR',
					source_id: `SOURCE-ID-${n}`,
					settlement: { collection: 'payslips', id: `00000000-0000-4000-8000-00000000002${n}` }
				})),
				payment_allocations: [1, 2].map((n) => ({
					id: `00000000-0000-4000-8000-00000000004${n}`,
					gross_amount: 0,
					payable_tranche_id: `00000000-0000-4000-8000-00000000003${n}`
				}))
			}
		});
		const caller = t.as({
			actor: {
				kind: 'member',
				id: 'synthetic-member',
				email: 'own@example.test',
				phone: null,
				external: false,
				teams: [],
				teamPath: [],
				admin: false,
				party: null
			},
			admin: false,
			policies: ['employee']
		});
		for (const collection of ['payable_tranches', 'payment_allocations']) {
			const result = await caller.read(collection, { all: true });
			assert.equal(result.rows.length, 1);
			assert.equal(result.rows[0]?.id.endsWith('1'), true);
			assert.deepEqual(result.rows[0]?.gross_amount, { $masked: true });
			if (collection === 'payable_tranches') {
				assert.equal(result.rows[0]?.reference, 'SOURCE-1');
				assert.equal(result.rows[0]?.source_kind, 'REGULAR');
				assert.equal(result.rows[0]?.source_id, 'SOURCE-ID-1');
			}
			const link = collection === 'payable_tranches' ? 'settlement' : 'payable_tranche_id';
			for (const [field, value] of Object.entries(result.rows[0]!))
				if (
					![
						'id',
						'revision',
						'approval_id',
						'created_at',
						'created_by',
						'updated_at',
						'updated_by',
						link,
						...(collection === 'payable_tranches' ? ['reference', 'source_kind', 'source_id'] : [])
					].includes(field)
				)
					assert.deepEqual(value, { $masked: true }, `${collection}.${field} must be masked`);
			const selected = await caller.read(collection, { select: { gross_amount: true }, all: true });
			assert.equal(selected.rows.length, 1);
			assert.deepEqual(selected.rows[0]?.gross_amount, { $masked: true });
		}
	} finally {
		await pg.close();
	}
});

test('employee locks distinguish draft, paid and zero-value allocation; unknown remains closed', () => {
	const day = { id: 'day', payslip_id: 'slip' };
	assert.equal(capturedWorkDayFrozen(day, [{ id: 'slip' }], new Set(), true), false);
	assert.equal(
		capturedWorkDayFrozen(day, [{ id: 'slip', paid_at: '2026-01-01' }], new Set(), true),
		true
	);
	assert.equal(captureClaims([day], [{ id: 'slip' }], new Set(['slip'])).has('day'), true);
	assert.equal(capturedWorkDayFrozen(day, [], new Set(), false), true);
});
