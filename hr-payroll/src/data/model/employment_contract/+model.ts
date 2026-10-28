import {
	model,
	type WriteCtx,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type Id
} from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import {
	refusePaidTermsChange,
	refuseTermsOverlap,
	termsFromFacts
} from '../../../lib/payroll_engine/contract_terms.js';
import { dayKey } from '../../../lib/payroll_engine/leave.js';
import { beforeOf, eachBatched, runEngine } from '../../../lib/payroll_engine/foundation.js';
import { admitContractTerms, loadContractWriteBatch } from '../../../lib/payroll_engine/admit.js';
import { exitGroundRefusal, refuseClosedUpdate } from '../../../lib/payroll_engine/offboarding.js';
import { kindsOf } from '../../../lib/payroll_engine/listed_kinds.js';
import { versionOn } from '../../../lib/payroll_engine/payslip/context.js';

const create_columns = [
	'employee_number',
	'bank',
	'effective_range',
	'signed_contract_end',
	'prior_service_months',
	'engagement',
	'exit_ground',
	'exit_facts',
	'comments',
	'facts',
	'employee_id',
	'company_id'
] as const;

const update_columns = [
	'employee_number',
	'bank',
	'effective_range',
	'signed_contract_end',
	'prior_service_months',
	'engagement',
	'exit_ground',
	'exit_facts',
	'comments',
	'facts',
	'employee_id',
	'company_id'
] as const;

type WriteInput = Omit<UpdateSet<'employment_contract'>, 'id'> &
	Partial<Omit<CreateRow<'employment_contract'>, 'id'>> & {
		readonly id?: Id<'employment_contract'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'employment_contract'> | undefined)[],
	ctx: WriteCtx<'employment_contract'>
) {
	const identities = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const prefetched = yield* loadContractWriteBatch(ctx.db.query, {
		companies: [
			...new Set(identities.flatMap((row) => (row.company_id == null ? [] : [row.company_id])))
		],
		employees: [
			...new Set(identities.flatMap((row) => (row.employee_id == null ? [] : [row.employee_id])))
		],
		employments: existing.flatMap((row) => (row === undefined ? [] : [row.id]))
	});
	return yield* eachBatched(
		inputs,
		ctx.db.query,
		Effect.fnUntraced(function* (input, i, read) {
			const before = existing[i];
			if (before !== undefined) {
				const closed = refuseClosedUpdate(
					before,
					input.effective_range === undefined ? {} : { effective_range: input.effective_range }
				);
				if (closed != null) return yield* ctx.refuse(closed);
			}
			// A departure is a ground with its last day; a ground written, or kept onto a moved last day, is one the
			// version governing the last day lists.
			const ground = 'exit_ground' in input ? input.exit_ground : before?.exit_ground;
			const range = input.effective_range ?? before?.effective_range;
			const unpaired = exitGroundRefusal({ ground, to: range?.to });
			if (unpaired != null) return yield* ctx.refuse(unpaired);
			if (
				ground != null &&
				ground !== '' &&
				(ground !== before?.exit_ground ||
					String(range?.to ?? '') !== String(before?.effective_range.to ?? ''))
			) {
				const company_id = input.company_id ?? before?.company_id;
				if (range?.to == null || company_id == null)
					return yield* ctx.refuse('An exit ground is written with the last day of work.');
				const entity = prefetched.entities.rows.find((row) => row.id === company_id);
				if (entity === undefined)
					return yield* ctx.refuse('This contract needs its actual entity.');
				const version = yield* Effect.fromResult(
					versionOn(prefetched.versions.rows, entity.settings_code, String(range.to))
				).pipe(Effect.catchTag('Refusal', (failure) => ctx.refuse(failure.message)));
				const rules = prefetched.rules.rows.find(
					(row) =>
						row.settings_id === version.id &&
						row.family === 'PARAMETERS' &&
						row.code === 'exit_grounds'
				);
				if (!kindsOf(rules?.rules).some((row) => row.code === ground))
					return yield* ctx.refuse(
						`${version.code} lists no exit ground ${ground} on ${String(range.to)}.`
					);
				// The exit's behaviours write its encashment and exit pay as the departure saves: an unpaid salary slip
				// reaching the last day was priced without them, so it is rebuilt after, never left short.
				const lastDay = String(range.to);
				const unpaid = prefetched.payslips.rows.find((slip) => {
					const to = dayKey(slip.salary_to);
					return (
						slip.employment_id === before?.id &&
						slip.status !== 'PAID' &&
						dayKey(slip.salary_from) != null &&
						to != null &&
						to >= lastDay
					);
				});
				if (unpaid !== undefined)
					return yield* ctx.refuse(
						`An unpaid payroll run already pays ${dayKey(unpaid.salary_from)} to ${dayKey(unpaid.salary_to)}. Delete it, save the departure, then create the run again so it pays the final salary, leave encashment and exit pay.`
					);
			}
			const facts = 'facts' in input ? input.facts : before?.facts;
			const overlap = refuseTermsOverlap(termsFromFacts(facts));
			if (overlap != null) return yield* ctx.refuse(overlap);
			// A paid period keeps the terms it was paid on: month-to-date statutory and projections read them again.
			if (before !== undefined && 'facts' in input) {
				const slips = prefetched.payslips.rows.filter((row) => row.employment_id === before.id);
				const paid = slips.flatMap((slip) => {
					const from = dayKey(slip.salary_from);
					const to = dayKey(slip.salary_to);
					return from == null || to == null ? [] : [{ from, to }];
				});
				const locked = refusePaidTermsChange(before.facts, input.facts, paid);
				if (locked != null) return yield* ctx.refuse(locked);
			}
			// The governing version's contract validations judge every new or changed term.
			if ('facts' in input) {
				const { effective_range: _inputRange, facts: _inputFacts, ...fields } = input;
				const { contract_terms, ...factsFields } = input.facts ?? {};
				yield* runEngine(
					admitContractTerms({
						contract: {
							...before,
							...fields,
							...(range === undefined
								? {}
								: {
										effective_range: {
											from: PlainDate(range.from),
											to: range.to == null ? null : PlainDate(range.to)
										}
									}),
							facts: {
								...factsFields,
								...(contract_terms === undefined
									? {}
									: {
											contract_terms:
												contract_terms === null
													? null
													: contract_terms.map(({ residency_since, ...term }) => ({
															...term,
															effective_range: {
																from: PlainDate(term.effective_range.from),
																to:
																	term.effective_range.to == null
																		? null
																		: PlainDate(term.effective_range.to)
															},
															...(residency_since === undefined
																? {}
																: {
																		residency_since:
																			residency_since == null ? null : PlainDate(residency_since)
																	})
														}))
										})
							}
						},
						before: before?.facts,
						prefetched
					}),
					read,
					ctx.refuse
				);
			}
			// `before` keeps what a duty may compare, never bank details or free text.
			const {
				bank: _bank,
				comments: _comments,
				...changed
			} = before === undefined ? {} : beforeOf(before, input);
			return before === undefined ? input : { ...input, before: changed };
		})
	);
});

export default model('employment_contract', {
	description:
		'One employment contract: one person, one legal entity and one uninterrupted stint. The first linked input permanently seals it. A planned end (a fixed term) is no departure; a departure is an exit ground with the last day, and it can be moved or undone (its effects are re-evaluated). Rehires create new contracts.',
	icon: 'lucide:briefcase',
	label: 'employee_number',
	fields: {
		employee_number: {
			kind: 'text'
		},
		contract_number: {
			kind: 'seq',
			per: ['employee_id', 'company_id']
		},
		bank: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					bank_name: {
						kind: 'text'
					},
					bank_code: {
						kind: 'text'
					},
					bank_account_number: {
						kind: 'text'
					},
					bank_account_name: {
						kind: 'text'
					}
				}
			},
			optional: true
		},
		effective_range: {
			kind: 'period',
			of: 'date',
			help: 'The first day of employment (when the person joined or started) to the last (when they left).'
		},
		signed_contract_end: {
			kind: 'date',
			optional: true,
			help: 'The planned end of a fixed-term contract; an early exit keeps it, so undoing the exit reopens to it.'
		},
		before: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true,
			help: 'The prior values of the fields the last update changed, recorded for the duties that answer a change.'
		},
		engagement: {
			kind: 'enum',
			values: ['EMPLOYEE', 'PAYEE'],
			default: 'EMPLOYEE',
			help: 'PAYEE: a person paid without employment (a consultant, a commission agent): paid through entries only, outside the headcount and separations.'
		},
		prior_service_months: {
			kind: 'int',
			min: 0,
			optional: true
		},
		exit_ground: {
			kind: 'text',
			optional: true
		},
		exit_facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true
		},
		comments: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'object',
			rest: { kind: 'json' },
			fields: {
				contract_terms: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						rest: { kind: 'json' },
						fields: {
							id: { kind: 'text', optional: true },
							employment_id: { kind: 'text', optional: true },
							effective_range: { kind: 'period', of: 'date' },
							base_salary: {
								kind: 'object',
								optional: true,
								rest: { kind: 'json' },
								fields: {
									value: { kind: 'number' },
									currency: { kind: 'currency' }
								}
							},
							currency: { kind: 'currency', optional: true },
							allowances: {
								kind: 'list',
								optional: true,
								of: {
									kind: 'object',
									rest: { kind: 'json' },
									fields: {
										code: { kind: 'text', optional: true },
										catalogue_id: { kind: 'text', optional: true },
										amount: {
											kind: 'object',
											rest: { kind: 'json' },
											fields: {
												value: { kind: 'number' },
												currency: { kind: 'currency', optional: true }
											}
										}
									}
								}
							},
							residency_status: { kind: 'text', optional: true },
							residency_since: { kind: 'date', optional: true },
							work_classification: { kind: 'text', optional: true },
							statutory_work_category: { kind: 'text', optional: true },
							employment_type: { kind: 'text', optional: true },
							shift_pattern_id: { kind: 'text', optional: true },
							facts: {
								kind: 'json',
								shape: { kind: 'record', of: { kind: 'json' } },
								optional: true
							}
						}
					}
				}
			}
		},
		employee_id: {
			kind: 'ref',
			to: 'employment_profile',
			inverse: 'employment_contract'
		},
		company_id: { kind: 'ref', to: 'entity', inverse: 'employment_contract' }
	},
	search: { text: ['employee_number', 'employee_id'] },
	read: {
		employment_contract: { fields: 'all' },
		'employment_contract.employee_id': { fields: 'all' },
		'employment_contract.company_id': { fields: 'all' }
	},
	create: {
		columns: { employment_contract: create_columns },
		transform: function* (rows, ctx) {
			const transformed = yield* transformRows(
				rows,
				rows.map(() => undefined),
				ctx
			);
			return rows.map((row, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...row, ...set };
			});
		}
	},
	update: {
		columns: { employment_contract: update_columns },
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	}
});
