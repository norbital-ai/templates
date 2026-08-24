import { defineConfig, reactivePack, stringlyPack } from '../oss/packages/doctor/build/index.js';

/**
 * Reactive-ownership rules run beside the built-in detector, not instead of it.
 *
 * The built-in `QRY1` matches a naming shape rather than the law it documents, so a timer driving
 * `query.refresh()` inside an `$effect` went unreported. These match the mechanism, and run the
 * same way in `.ts` and `.svelte`.
 */
export default defineConfig({ packs: [reactivePack, stringlyPack] });
