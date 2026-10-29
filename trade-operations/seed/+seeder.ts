import { seeder } from '@norbital-ai/bolt';

/** The demo's private rows: `seed_bank/trade-operations/rows/**` (docs/seeding.md). */
export default seeder({ bank: { tree: 'trade-operations' } });
