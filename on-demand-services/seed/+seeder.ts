import { seeder } from '@norbital-ai/bolt';

/** The demo's private rows: `seed_bank/on-demand-services/rows/**` (docs/seeding.md). */
export default seeder({ bank: { tree: 'on-demand-services' } });
