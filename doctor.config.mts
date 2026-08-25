import { defineConfig, reactivePack, stringlyPack } from '../oss/packages/doctor/build/index.js';

/**
 * Reactive-ownership rules run beside the neutral baseline.
 *
 * The built-in `QRY1` matches a naming shape rather than the law it documents, so a timer driving
 * `query.refresh()` inside an `$effect` went unreported. These match the mechanism, and run the
 * same way in `.ts` and `.svelte`. The product detector is opt-in by name — `norbital` — because
 * the core ships no opinionated rules of its own.
 */
export default defineConfig({ packs: ['norbital', reactivePack, stringlyPack] });
