import { model } from '@norbital-ai/bolt';

const columns = [
	'project_id',
	'direction',
	'claim_type',
	'status',
	'contact_id',
	'cost_item_id',
	'quote_id',
	'currency',
	'valuation_date',
	'due_date',
	'claim_period',
	'valuation',
	'claimed_amount',
	'certified_amount',
	'submitted_date',
	'paid_date',
	'description',
	'supporting_documents'
] as const;

function addDays(isoDate: string, days: number): string {
	const ms = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
	if (!Number.isFinite(ms)) return isoDate;
	return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

export default model('payment_claims', {
	description:
		'Append-only project cashflow ledger covering client progress/variation claims (inflows), subcontractor/supplier bills (outflows), and offsetting adjustments.',
	icon: 'lucide:banknote',
	record_label: 'record.claim_number',
	fields: {
		claim_number: { kind: 'seq', pattern: 'CLM-{yyyy}-{000}', per: ['project_id'] },
		/** `inflow` = client progress/variation valuation; `outflow` = subcontractor/supplier claim or bill. */
		direction: {
			kind: 'enum',
			values: ['inflow', 'outflow'],
			default: 'inflow'
		},
		claim_type: {
			kind: 'enum',
			values: [
				'progress',
				'variation',
				'milestone',
				'final',
				'retention_release',
				'subcon_claim',
				'supplier_invoice',
				'adjustment'
			],
			default: 'progress'
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['submitted', 'rejected'] },
				submitted: { to: ['certified', 'rejected'] },
				certified: { to: ['paid', 'rejected'] },
				paid: { to: [] },
				rejected: { to: [] }
			}
		},
		currency: { kind: 'currency', default: 'SGD' },
		valuation_date: { kind: 'date', optional: true, default: { var: 'today' } },
		/** Forecast cashflow due date; defaults to `valuation_date + project.payment_terms_days`. */
		due_date: { kind: 'date', optional: true },
		claim_period: { kind: 'period', of: 'date', optional: true },
		/** Co-located client progress valuation totals and BOQ snapshot (inflow claims). */
		valuation: { kind: 'custom', of: 'claim_valuation', optional: true },
		claimed_amount: { kind: 'money', currency: 'currency', optional: true },
		certified_amount: { kind: 'money', currency: 'currency', optional: true },
		submitted_date: { kind: 'date', optional: true },
		paid_date: { kind: 'date', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		supporting_documents: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			many: true,
			optional: true
		},
		project_id: { kind: 'ref', to: 'projects', inverse: 'payment_claims', owned: true },
		contact_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'payment_claims',
			optional: true,
			on_delete: 'set_null'
		},
		cost_item_id: {
			kind: 'ref',
			to: 'cost_items',
			inverse: 'payment_claims',
			optional: true,
			on_delete: 'set_null'
		},
		quote_id: {
			kind: 'ref',
			to: 'quotes',
			inverse: 'payment_claims',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		/** Couples direction discriminator to valid claim types. */
		direction_matches_type: {
			check: {
				or: [
					{ claim_type: { eq: 'adjustment' } },
					{
						and: [
							{ direction: { eq: 'inflow' } },
							{
								claim_type: {
									in: ['progress', 'variation', 'milestone', 'final', 'retention_release']
								}
							}
						]
					},
					{
						and: [
							{ direction: { eq: 'outflow' } },
							{ claim_type: { in: ['subcon_claim', 'supplier_invoice'] } }
						]
					}
				]
			}
		},
		/** Non-negative claimed amount unless this is an explicit offsetting adjustment entry. */
		non_negative_claimed: {
			check: {
				or: [
					{ claim_type: { eq: 'adjustment' } },
					{ claimed_amount: { is_null: true } },
					{ claimed_amount: { gte: 0 } }
				]
			}
		},
		/** Non-negative certified amount unless this is an explicit offsetting adjustment entry. */
		non_negative_certified: {
			check: {
				or: [
					{ claim_type: { eq: 'adjustment' } },
					{ certified_amount: { is_null: true } },
					{ certified_amount: { gte: 0 } }
				]
			}
		},
		/** Ledger lock upon submission: claimed figures freeze; only certification decision and supporting docs may change. */
		submitted_locked: {
			locked: { status: { eq: 'submitted' } },
			except: ['status', 'certified_amount', 'supporting_documents']
		},
		/** Certified ledger lock: certified_amount freezes permanently; only payment recording may proceed. */
		certified_locked: {
			locked: { status: { eq: 'certified' } },
			except: ['status', 'paid_date', 'supporting_documents']
		},
		/** Terminal ledger lock: paid and rejected entries never mutate amounts or dates. */
		settled_locked: {
			locked: { status: { in: ['paid', 'rejected'] } },
			except: ['supporting_documents']
		}
	},
	indexes: {
		by_project_direction: { on: ['project_id', 'direction', 'status'] },
		find: { text: ['claim_number', 'description'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			contact_id: { fields: ['full_name', 'company_name'] },
			cost_item_id: { fields: ['item_code', 'description'] },
			quote_id: { fields: ['quote_number', 'title'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			const projectIds = [
				...new Set(
					changes.flatMap(({ after }) => (after.due_date == null ? [after.project_id] : []))
				)
			];
			const termsByProject =
				projectIds.length === 0
					? new Map<string, number>()
					: new Map(
							(yield* ctx.query({
								projects: {
									where: { id: { in: projectIds } },
									fields: ['payment_terms_days']
								}
							})).projects.rows.map((p) => [p.id, p.payment_terms_days])
						);
			return changes.map(({ set, after }) => {
				if (after.due_date != null) return set;
				const baseDate = after.valuation_date ?? ctx.today;
				const days = termsByProject.get(after.project_id) ?? 30;
				return { ...set, due_date: addDays(baseDate, days) };
			});
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			return changes.map((c) => ({
				...c.set,
				...(c.changed('status') && c.after.status === 'submitted' && c.after.submitted_date == null
					? { submitted_date: ctx.today }
					: {}),
				...(c.changed('status') && c.after.status === 'paid' && c.after.paid_date == null
					? { paid_date: ctx.today }
					: {})
			}));
		}
	}
});
