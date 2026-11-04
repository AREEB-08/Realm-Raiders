/**
 * Seed the demo world (§10.8): three sealed NPC islands, and
 * (with --demo) a pre-seeded demo account with a General and a sealed base.
 *   pnpm --filter @realm/server seed [--demo]
 */
import { defaultAppearance } from '@realm/shared';
import { buildApp } from '../app';

const built = await buildApp({ QUIET: '1' });
await built.core.start();
const islands = await built.core.ctx.repo.islands.all();
console.log(`islands: ${islands.map((i) => i.name).join(', ')}`);
if (process.argv.includes('--demo')) {
  const login = (await built.core.handle('POST', '/auth/demo', {}, null)) as { playerId: string };
  const pid = login.playerId;
  await built.core.handle('PUT', '/general', { name: 'Brannoc', personality: 'bold', faction: 'thornmarch', appearance: defaultAppearance('thornmarch') }, pid);
  await built.core.handle('POST', '/chain/agent/relay', {}, pid);
  await built.core.handle('POST', '/base/seal/relay', {}, pid);
  const session = await (await import('../auth')).sessionIssuer(built.env).sign(pid);
  console.log(`demo player ${pid}\nsession token (paste into the app's dev panel or DEMO.md): ${session}`);
}
await built.close();
