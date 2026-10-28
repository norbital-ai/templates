import { REFERENCES_SHAPE } from './references.js';
import { RESEARCH_AGENT_NAMES } from './research_agents.js';

/** The closed set of `time_pay` keys, in pricing order: each key is a kind of time pay holding its lines. */
export const TIME_PAY_KEYS = [
	'BASIC',
	'OVERTIME',
	'REST_DAY_WORK',
	'REST_DAY_OVERTIME',
	'HOLIDAY_WORK',
	'HOLIDAY_OVERTIME',
	'NIGHT_WORK',
	'NIGHT_OVERTIME',
	'INCENTIVE',
	'PAID_HOLIDAY',
	'MINIMUM_WAGE_TOP_UP'
] as const;
/** One `time_pay` line: a salary slip posts quantity × rate (CEL over the payslip context) when eligibility holds. */
const TIME_PAY_LINE = {
	kind: 'object',
	optional: true,
	fields: {
		name: { kind: 'text', optional: true },
		references: { ...REFERENCES_SHAPE, optional: true },
		eligibility: { kind: 'text', format: 'cel' },
		quantity: { kind: 'text', format: 'cel' },
		rate: { kind: 'text', format: 'cel' },
		// the line is the contract amount scaled to the days employed; the payslip records its proration
		prorated: { kind: 'bool', optional: true },
		// the divisor a prorated line states on the payslip; required when `prorated`
		denominator: { kind: 'text', format: 'cel', optional: true },
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER'] },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'] },
		counts_toward: { kind: 'list', of: { kind: 'text' } }
	}
} as const;
/** One reserved kind of time pay: its lines, each keeping its own code (a tier, a part-time or daily variant). */
const TIME_PAY_KIND = {
	kind: 'list',
	optional: true,
	of: { kind: 'object', fields: { code: { kind: 'text' }, ...TIME_PAY_LINE.fields } }
} as const;

export const STATUTORY_FIELDS = {
	settings: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		employee_input_schema: {
			kind: 'json',
			optional: true
		},
		entity_input_schema: {
			kind: 'json',
			optional: true
		},
		sealed_at: {
			kind: 'instant',
			optional: true
		},
		voided_at: {
			kind: 'instant',
			optional: true
		},
		void_reason: {
			kind: 'text',
			optional: true
		},
		payroll: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					currency: { kind: 'text', optional: true },
					timezone: { kind: 'text', optional: true },
					tax_year_start_month: { kind: 'int', optional: true },
					minor_units: { kind: 'int', min: 0, max: 4, optional: true },
					rolling_hours_months: { kind: 'int', min: 1, optional: true },
					history_months: { kind: 'int', min: 1, optional: true },
					pay_date: { kind: 'text', format: 'cel', optional: true },
					week_start: { kind: 'int', min: 0, max: 6, optional: true },
					semi_monthly_split: { kind: 'int', min: 1, max: 27, optional: true },
					ten_day_splits: { kind: 'list', of: { kind: 'int', min: 1, max: 27 }, optional: true },
					permanent_when: { kind: 'text', format: 'cel', optional: true },
					roster_week: { kind: 'enum', values: ['ROLLING', 'CALENDAR'], optional: true },
					base_salary_required: { kind: 'bool', optional: true },
					off_cycle_families: { kind: 'list', of: { kind: 'text' }, optional: true },
					monthly_wage: { kind: 'text', format: 'cel', optional: true },
					negative_net: { kind: 'enum', values: ['refuse', 'allow'], optional: true },
					exit_overpayment: { kind: 'enum', values: ['note', 'deduct'], optional: true },
					attendance: {
						kind: 'object',
						fields: {
							step_hours: { kind: 'number' },
							rounding: { kind: 'enum', values: ['DOWN', 'UP', 'HALF_UP'] },
							overtime_window: { kind: 'enum', values: ['AFTER_SHIFT', 'EXPLICIT'] },
							untimed_credit_day_types: { kind: 'list', of: { kind: 'text' } }
						},
						optional: true
					}
				}
			}
		},
		// pay for time employed and worked, by reserved kind, each kind's lines under their own codes; a kind the
		// jurisdiction does not pay is omitted and an unknown key is refused
		time_pay: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					BASIC: TIME_PAY_KIND,
					OVERTIME: TIME_PAY_KIND,
					REST_DAY_WORK: TIME_PAY_KIND,
					REST_DAY_OVERTIME: TIME_PAY_KIND,
					HOLIDAY_WORK: TIME_PAY_KIND,
					HOLIDAY_OVERTIME: TIME_PAY_KIND,
					NIGHT_WORK: TIME_PAY_KIND,
					NIGHT_OVERTIME: TIME_PAY_KIND,
					INCENTIVE: TIME_PAY_KIND,
					PAID_HOLIDAY: TIME_PAY_KIND,
					MINIMUM_WAGE_TOP_UP: TIME_PAY_KIND
				}
			},
			default: {}
		},
		change_summary: {
			kind: 'text',
			optional: true
		},
		effective_range: {
			kind: 'period',
			of: 'date'
		},
		sources: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					entries: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								// the one research agent this entry serves; its instructions name that agent's subject matter only. An
								// entry is a live official page, never a document link: documents are found from it on each run
								agent: { kind: 'enum', values: RESEARCH_AGENT_NAMES },
								url: { kind: 'text', format: 'url' },
								instructions: { kind: 'text' }
							}
						}
					},
					// each agent's supplementary instructions for this jurisdiction
					agents: {
						kind: 'object',
						fields: {
							catalog: { kind: 'text', optional: true },
							contribution: { kind: 'text', optional: true },
							rules: { kind: 'text', optional: true },
							behaviour: { kind: 'text', optional: true },
							obligations: { kind: 'text', optional: true },
							settings: { kind: 'text', optional: true }
						},
						optional: true
					}
				}
			}
		}
	},
	adhoc_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'CAP', 'ALLOW']
								},
								amount: {
									kind: 'text',
									format: 'cel'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		qualifies_when: {
			kind: 'text',
			format: 'cel',
			optional: true
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			}
		},
		payable_after_exit: {
			kind: 'bool',
			default: false,
			help: 'Entries of this class may fall after the employment ends (non-compete pay, instalments of a separation payment) and are paid on a payslip of their own period.'
		}
	},
	allowance_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		eligibility: {
			kind: 'text',
			format: 'cel'
		},
		amount: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL amount over the payslip context; `allowance.amount` is the contract’s monthly figure.'
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			},
			default: []
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT']
		},
		automatic: {
			kind: 'bool',
			default: false,
			help: 'Priced on every salary slip without a contract line (a statutory or conditional allowance): `allowance.amount` is 0 and the eligibility decides.'
		}
	},
	claim_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'CAP', 'ALLOW'],
									help: 'BLOCK pays up to the limit, ALLOW pays all; either flags the excess on the run.'
								},
								amount: {
									kind: 'text',
									format: 'cel'
								},
								window: {
									kind: 'enum',
									values: ['ENTRY', 'PERIOD', 'CALENDAR_YEAR'],
									optional: true,
									help: 'What the limit meters: each claim alone (default), or the settlement period or calendar year less the claims of the class already taken in it.'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		qualifies_when: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			}
		}
	},
	leave_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		description: {
			kind: 'text',
			optional: true
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR'],
			default: 'DAY',
			help: 'What a request charges: DAY the planned working days of its range (rest and off days and published holidays charge nothing), CALENDAR_DAY every day of it, HOUR the scheduled hours of its planned working days.'
		},
		unplanned_days: {
			kind: 'enum',
			values: ['EVERY_DAY_BUT_HOLIDAYS', 'REFUSE'],
			optional: true,
			help: 'What a DAY request charges over a range with no planned shift at all: EVERY_DAY_BUT_HOLIDAYS every day of it less published holidays, REFUSE asks for the shifts to be planned first. Required on a DAY class.'
		},
		can_encash: {
			kind: 'bool',
			help: 'Whether untaken days of the class may be paid out. Stated on every class: no default decides it.'
		},
		encash_on_exit: {
			kind: 'bool',
			default: false
		},
		encash_at_window_end: {
			kind: 'bool',
			default: false,
			help: 'On the last day of the class’s window (a calendar or service year), its untaken balance is encashed as on exit.'
		},
		entitlement: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					unit: { kind: 'text', optional: true },
					days: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL entitlement in days over `service_months`, `bands`, `as_of`, the subject roots and `taken`; absent means the class is not metered.'
					},
					overdraw: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL over `service_months`, `as_of` and the subject roots: the most days the balance may run below zero (advance leave). Required with days.'
					},
					window: {
						kind: 'enum',
						values: ['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT', 'ROLLING'],
						optional: true,
						help: 'The span the balance is metered over; absent means LIFETIME. EVENT meters each entry.facts.event_id (or window_key) on its own; ROLLING the window_months ending on the day read.'
					},
					window_months: {
						kind: 'int',
						optional: true,
						help: 'ROLLING (required): the months the window reaches back from the day read (that day included). On any class, the span of its taken.rolling root, which only a class stating it has.'
					},
					service_year_offset_months: {
						kind: 'int',
						optional: true,
						help: 'SERVICE_YEAR: months after the employment start the first service year begins.'
					},
					window_key: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL over `entry` (the movement’s columns and facts) naming the EVENT window a movement counts in, e.g. `entry.facts.child_id`; absent means entry.facts.event_id.'
					},
					carry_forward: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL on the previous window: the most unused days carried into the next CALENDAR_YEAR or SERVICE_YEAR window; absent carries nothing.'
					},
					carry_depth: {
						kind: 'int',
						optional: true,
						help: 'Required with carry_forward: how many windows carried days may still be carried (1: once).'
					},
					consumes_after_days: {
						kind: 'int',
						optional: true,
						help: 'With consumes_code: the first N units of the class (in the pool’s window) are its own; only those past N draw on the pool.'
					},
					hours_per_day: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'With consumes_code and a non-day unit: CEL over the subject, the units one pool day holds.'
					},
					bands: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								service_months: { kind: 'int' },
								days: { kind: 'int' }
							}
						},
						optional: true
					}
				}
			},
			optional: true
		},
		is_npl: {
			kind: 'bool',
			default: false
		},
		pay_fraction: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		share_by: {
			kind: 'enum',
			values: ['WORKING_DAYS', 'CALENDAR_DAYS'],
			default: 'WORKING_DAYS',
			help: 'How a leave row spanning pay periods is shared between them.'
		},
		consumes_code: {
			kind: 'text',
			optional: true
		},
		pay: {
			kind: 'json',
			help: 'The payslip lines the class prices: each posts quantity × rate when eligible, CEL over the payslip context (`leave.rows` holds every class’s rows of the period). Each line is priced once a slip, so a line counting several classes’ rows lives on one of them.',
			shape: {
				kind: 'list',
				// a time line's fields, with its code (the payslip line's component code)
				of: { kind: 'object', fields: { code: { kind: 'text' }, ...TIME_PAY_LINE.fields } }
			},
			default: []
		}
	},
	loan_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'],
			default: 'NET'
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			default: 'SUBTRACT',
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'CAP', 'ALLOW']
								},
								amount: {
									kind: 'text',
									format: 'cel'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		}
	},
	suspension_catalog: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		counts_as_attended: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL: whether a suspended scheduled day counts as attended (blank = no).'
		},
		scheduled: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL: whether a suspended day stays a scheduled day (blank = yes).'
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL: whether a suspended day of this kind is paid, over the payslip context with `day` and `suspension` (blank = yes).'
		},
		quantity: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL: the quantity one suspended day pays (blank = 1).'
		},
		rate: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL: the rate one suspended day pays; quantity × rate is `work.days[].suspended.pay`, which the pay lines read (blank = 0).'
		},
		pay: {
			kind: 'json',
			help: 'The payslip lines suspended days post on a salary slip: each posts quantity × rate when eligible, CEL over the payslip context (`work.days[].suspended` holds every kind’s days of the period). Each line is priced once a slip, so a line totalling several kinds’ days lives on one of them.',
			shape: {
				kind: 'list',
				// a time line's fields, with its code (the payslip line's component code)
				of: { kind: 'object', fields: { code: { kind: 'text' }, ...TIME_PAY_LINE.fields } }
			},
			default: []
		}
	},
	statutory_contribution_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		/** The scheme's short name on payslips and the salary listing; a missing label reads as its humanised code. */
		label: {
			kind: 'text',
			optional: true
		},
		/** Presentation order of the scheme's lines and columns; unordered schemes follow, by code. */
		display_order: {
			kind: 'int',
			optional: true
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		configuration: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					assess_without_wage: { kind: 'bool', optional: true },
					carry_uncovered: {
						kind: 'object',
						optional: true,
						help: 'The employee share net cannot cover is advanced and recovered later: `advance` is CEL over `carry.short` (what net lacks) and `carry.share` (the scheme’s employee share), `recover` CEL over `carry.owed` (outstanding) and `carry.left` (what this slip’s net leaves).',
						fields: {
							advance: { kind: 'text', format: 'cel' },
							recover: { kind: 'text', format: 'cel' }
						}
					},
					governed_by: { kind: 'text', optional: true },
					order: { kind: 'number', optional: true },
					as_of: { kind: 'text', optional: true },
					annual_reconciliation: {
						kind: 'object',
						optional: true,
						fields: {
							when: { kind: 'text', format: 'cel' },
							part: { kind: 'text' },
							ceiling: { kind: 'text', format: 'cel' },
							through: { kind: 'text', format: 'cel' },
							on_underpaid: {
								kind: 'enum',
								values: ['CATCH_UP', 'REFUSE'],
								help: 'Earlier months paid less than the recalculated liability: CATCH_UP adds the shortfall to this month, REFUSE stops for review.'
							},
							on_overpaid: {
								kind: 'enum',
								values: ['WARN', 'REFUSE'],
								help: 'Earlier months paid more than the recalculated liability: WARN keeps this month and warns (refund outside payroll), REFUSE stops for review.'
							},
							on_current_excess: {
								kind: 'enum',
								values: ['REFUSE', 'SETTLE'],
								help: "This month's earlier slips already exceed the reconciled month charge: REFUSE stops for review, SETTLE credits the excess on this slip."
							},
							on_original_error: {
								kind: 'enum',
								values: ['REFUSE', 'CATCH_UP'],
								help: 'An earlier month paid less than its own original assessment: REFUSE stops for review, CATCH_UP lets on_underpaid settle it.'
							}
						}
					},
					warn_when: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { when: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
						},
						optional: true
					},
					person: {
						kind: 'record',
						of: { kind: 'text', format: 'cel' },
						optional: true,
						help: 'Person facts this scheme reads, each a CEL expression over the statutory context (for example the age basis), merged into `person`.'
					},
					wage_adjustments: {
						kind: 'list',
						optional: true,
						help: 'Parts of the slip this scheme taxes or exempts beyond what is paid (a taxable excess, an exempt share): each prices quantity × rate over the payslip context on a salary slip and posts it, unpaid, to the schemes it counts toward.',
						of: {
							kind: 'object',
							fields: {
								code: { kind: 'text' },
								name: { kind: 'text', optional: true },
								references: { ...REFERENCES_SHAPE, optional: true },
								eligibility: { kind: 'text', format: 'cel' },
								quantity: { kind: 'text', format: 'cel' },
								rate: { kind: 'text', format: 'cel' },
								direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'] },
								counts_toward: { kind: 'list', of: { kind: 'text' } }
							}
						}
					},
					assessable: {
						kind: 'record',
						of: { kind: 'text', format: 'cel' },
						optional: true,
						help: 'The month-to-date assessable amount of each wage part (ceilings, projections), CEL over `wage`, `month`, `year`, `period` and `terms`. A part without an expression is assessed as paid.'
					},
					assessment: { kind: 'text', format: 'cel', optional: true },
					refuse_when: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { when: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
						},
						optional: true,
						help: 'Guards evaluated before the rules: the first that holds refuses the payslip with its message.'
					},
					rules: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								when: { kind: 'text', format: 'cel', optional: true },
								employee: { kind: 'text', format: 'cel', optional: true },
								employer: { kind: 'text', format: 'cel', optional: true },
								contribution: { kind: 'text', format: 'cel', optional: true }
							}
						},
						optional: true
					},
					limitation: { kind: 'text', optional: true }
				}
			},
			help: 'Original legal policy plus executable input, record, derivation, assessment and finalization configuration. Missing source evidence never establishes zero liability.'
		}
	},
	behaviour: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		references: { kind: 'custom', of: 'references', optional: true },
		order: {
			kind: 'int',
			help: 'Run order among the rules one event selects, ascending (code breaks a tie): a later rule sees the writes before it.'
		},
		target_collection: { kind: 'text', optional: true },
		events: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, default: [] },
		when: { kind: 'text', format: 'cel', optional: true },
		fields: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, optional: true },
		reads: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } }, optional: true },
		effect: { kind: 'text', format: 'cel', optional: true },
		definition: {
			kind: 'json',
			optional: true,
			help: 'The one obligation or task this rule raises (due, schemes, amount, months, applies_when, trigger, …): its effect reads it as `behaviour.definition`.'
		}
	},
	rule_set: {
		family: {
			kind: 'text',
			help: 'VALIDATIONS (checks), PARAMETERS (law tables read as `rules.<code>`) or EXPORTS (file layouts).'
		},
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		content_hash: {
			kind: 'text',
			optional: true
		},
		source_identity: {
			kind: 'json',
			optional: true,
			help: 'Original jurisdiction/source location and hash plus retained source IDs. Newly authored native identity never impersonates a retired source row.'
		},
		rules: {
			kind: 'json',
			help: 'Authoritative family data, ordered entries and digest-keyed executable programs. No jurisdiction fallback supplies regulatory policy.'
		}
	}
} as const;
