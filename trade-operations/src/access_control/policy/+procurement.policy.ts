import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'procurement commercial work scoped by order.',
	capabilities: {
		apps: ['operations']
	},
	automations: ['orders_revise'],
	grants: {
		ext_purchase_orders: {
			read: { order: { is: { direction: { eq: 'purchasing' }, owner: { eq: { actor: 'id' } } } } },
			history: {
				order: { is: { direction: { eq: 'purchasing' }, owner: { eq: { actor: 'id' } } } }
			}
		},
		document_templates: { read: { status: { eq: 'published' } } },
		transactions: {
			read: { order: { is: { direction: { eq: 'purchasing' }, owner: { eq: { actor: 'id' } } } } },
			history: {
				order: { is: { direction: { eq: 'purchasing' }, owner: { eq: { actor: 'id' } } } }
			}
		},
		parties: {
			queries: ['progress'],
			read: true
		},
		products: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			queries: ['erp_availability'],
			read: true
		},
		credit_snapshots: {
			read: true
		},
		commercial_settings: {
			read: true
		},
		pricing_floors: {
			history: true,
			read: true
		},
		commission_rules: {
			read: true
		},
		sys_user: {
			read: true,
			fields: ['id', 'name']
		},
		contacts: {
			read: true,
			create: true,
			update: true
		},
		orders: {
			read: {
				direction: {
					eq: 'purchasing'
				}
			},
			history: {
				direction: {
					eq: 'purchasing'
				}
			},
			create: {
				direction: {
					eq: 'purchasing'
				}
			},
			// a confirmation needs a commercial manager; any other edit of an unconfirmed order is direct
			update: {
				previous: {
					direction: {
						eq: 'purchasing'
					}
				},
				where: {
					direction: {
						eq: 'purchasing'
					}
				},
				approval: (write, flow) =>
					write.record.status !== 'confirmed' ||
					write.changed.every((field) => ['title', 'notes', 'archived'].includes(field))
						? flow.allow()
						: write.changed.includes('status')
							? flow.step('Commercial review', { teams: ['commercial_managers'] })
							: flow.deny('errors.order_sealed')
			},
			moves: 'all',
			queries: [
				'document_preview',
				'document_versions',
				'confirmation_check',
				'quotation_export',
				'sealed_export',
				'ar_aging',
				'sales_analysis',
				'sales_detail',
				'commission'
			]
		},
		order_lines: {
			read: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			history: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			create: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			update: {
				previous: {
					order: {
						is: {
							direction: {
								eq: 'purchasing'
							}
						}
					}
				},
				where: {
					order: {
						is: {
							direction: {
								eq: 'purchasing'
							}
						}
					}
				}
			},
			delete: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			}
		},
		activities: {
			read: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			history: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			create: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			update: {
				previous: {
					order: {
						is: {
							direction: {
								eq: 'purchasing'
							}
						}
					}
				},
				where: {
					order: {
						is: {
							direction: {
								eq: 'purchasing'
							}
						}
					}
				}
			}
		},
		source_payments: {
			queries: ['ledger'],
			history: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			},
			read: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			}
		},
		source_sales_lines: {
			history: { order: { is: { direction: { eq: 'purchasing' } } } },
			read: {
				order: {
					is: {
						direction: {
							eq: 'purchasing'
						}
					}
				}
			}
		}
	}
});
