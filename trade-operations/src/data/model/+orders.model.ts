import { model } from '@norbital-ai/bolt';
const snapshotShape = {
	kind: 'object',
	fields: {
		title: { kind: 'text', optional: true },
		document_title: { kind: 'text', optional: true },
		warehouse: { kind: 'text', optional: true },
		party_code: {
			kind: 'text'
		},
		party_name: {
			kind: 'text'
		},
		direction: {
			kind: 'text'
		},
		currency: {
			kind: 'text'
		},
		tax_inclusive: {
			kind: 'bool'
		},
		valid_from: { kind: 'text', optional: true },
		valid_until: { kind: 'text', optional: true },
		payment_terms: {
			kind: 'text'
		},
		delivery_terms: {
			kind: 'text'
		},
		contract_version: {
			kind: 'text'
		},
		lines: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					id: {
						kind: 'text'
					},
					product: { kind: 'text', optional: true },
					product_code: {
						kind: 'text'
					},
					product_name: {
						kind: 'text'
					},
					unit: {
						kind: 'text'
					},
					quantity: {
						kind: 'text'
					},
					unit_price: {
						kind: 'text'
					},
					discount_pct: {
						kind: 'text'
					},
					tax_rate: {
						kind: 'text'
					},
					net: {
						kind: 'text'
					},
					tax: {
						kind: 'text'
					},
					total: {
						kind: 'text'
					},
					floor_net: {
						kind: 'text'
					},
					commission_factor: {
						kind: 'text'
					},
					commission_basis_unit: {
						kind: 'text'
					}
				}
			}
		},
		net: {
			kind: 'text'
		},
		tax: {
			kind: 'text'
		},
		total: {
			kind: 'text'
		},
		order_id: {
			kind: 'text'
		}
	}
} as const;
const commissionShape = {
	kind: 'object',
	fields: {
		engine_version: { kind: 'text', optional: true },
		eligibility_expression: { kind: 'text', optional: true },
		amount_expression: { kind: 'text', optional: true },
		parameters: {
			kind: 'list',
			optional: true,
			of: { kind: 'object', fields: { name: { kind: 'text' }, value: { kind: 'text' } } }
		},
		rule_id: {
			kind: 'text'
		},
		effective_on: {
			kind: 'text'
		},
		currency: {
			kind: 'text'
		},
		basis_unit: {
			kind: 'text'
		},
		fixed_rate: {
			kind: 'text'
		},
		spread_pct: {
			kind: 'text'
		}
	}
} as const;
export default model({
	description: 'orders',
	label: 'number',
	fields: {
		freight_treatment: { kind: 'enum', values: ['deduct', 'include'], default: 'deduct' },
		number: {
			kind: 'seq',
			pattern: 'TR-{yyyy}-{0000}'
		},
		title: {
			kind: 'text'
		},
		direction: {
			kind: 'enum',
			values: ['sales', 'purchasing']
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: {
					to: ['confirmed', 'cancelled']
				},
				confirmed: {
					to: ['draft', 'closed', 'cancelled'],
					edit: [
						'reason',
						'closure_snapshot',
						'contract_versions',
						'operational_contracts',
						'check_hash'
					]
				},
				closed: {
					edit: 'none'
				},
				cancelled: {
					edit: 'none'
				}
			}
		},
		ordered_on: {
			kind: 'date',
			default: {
				today: ''
			}
		},
		currency: {
			kind: 'currency'
		},
		tax_inclusive: {
			kind: 'bool',
			default: false
		},
		valid_from: { kind: 'date', optional: true },
		valid_until: { kind: 'date', optional: true },
		payment_terms: {
			kind: 'text'
		},
		delivery_terms: {
			kind: 'text',
			optional: true
		},
		notes: {
			kind: 'text',
			optional: true
		},
		check_hash: {
			kind: 'text',
			optional: true,
			hidden: true
		},
		reason: {
			kind: 'text',
			optional: true
		},
		// Price-free projection of the approved contracts for scoped stock reads.
		operational_contracts: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						seal_hash: { kind: 'text' },
						lines: {
							kind: 'list',
							of: {
								kind: 'object',
								fields: {
									id: { kind: 'text' },
									product: { kind: 'text', optional: true },
									unit: { kind: 'text' },
									quantity: { kind: 'text' }
								}
							}
						}
					}
				}
			}
		},
		contract_version: { kind: 'int', default: 1, min: 1 },
		contract_versions: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						version: { kind: 'int' },
						seal_hash: { kind: 'text' },
						contract: { kind: 'text' },
						approved_at: { kind: 'instant' },
						approved_by: { kind: 'text' },
						ordered_on: { kind: 'date' },
						freight_treatment: { kind: 'enum', values: ['deduct', 'include'] },
						snapshot: snapshotShape,
						commission: { ...commissionShape, optional: true }
					}
				}
			}
		},
		sealed_at: {
			kind: 'instant',
			optional: true
		},
		sealed_by: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		sealed_contract_version: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		sealed_contract: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		sealed_snapshot: {
			kind: 'json',
			shape: snapshotShape,
			optional: true
		},
		closure_snapshot: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						order_line: { kind: 'text' },
						product_name: { kind: 'text' },
						unit: { kind: 'text' },
						ordered: { kind: 'text' },
						fulfilled: { kind: 'text' },
						released: { kind: 'text' }
					}
				}
			}
		},
		seal_hash: {
			hidden: true,
			kind: 'text',
			optional: true
		},
		party_name: {
			kind: 'text',
			optional: true
		},
		net: {
			kind: 'sum',
			of: 'lines.net'
		},
		tax: {
			kind: 'sum',
			of: 'lines.tax'
		},
		total: {
			kind: 'sum',
			of: 'lines.total'
		},
		line_count: {
			kind: 'count',
			of: 'lines'
		},
		sealed_commission: {
			hidden: true,
			kind: 'json',
			optional: true,
			shape: commissionShape
		}
	},
	search: {
		text: ['number', 'title', 'party_name']
	}
});
