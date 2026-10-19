import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'procurement commercial work scoped by order.',
	capabilities: {
		apps: ['operations']
	},
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
			update: {
				previous: {
					direction: {
						eq: 'purchasing'
					}
				},
				where: {
					status: { ne: 'confirmed' },
					direction: {
						eq: 'purchasing'
					}
				}
			},
			approval: {
				update: [
					{
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
						match: { record: { status: { eq: 'confirmed' } }, changed: ['status'] },
						steps: [['Commercial Managers']]
					}
				]
			},
			moves: 'all',
			actions: ['cancel', 'close'],
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
	},
	automations: ['export_order']
});
