/** contracts/deployments/<chainId>.json → packages/shared/src/deployments.json */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '..', 'contracts', 'deployments');
const target = join(here, '..', 'src', 'deployments.json');
const current = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const chainId = f.replace('.json', '');
    current[chainId] = {
      chainId: Number(chainId),
      RealmLedger: d.RealmLedger ?? null,
      ClanSiege: d.ClanSiege ?? null,
      RealmBadges: d.RealmBadges ?? null,
      RealmAgentRegistry: d.RealmAgentRegistry ?? null,
      RealmDuels: d.RealmDuels ?? (current[chainId] as { RealmDuels?: string } | undefined)?.RealmDuels ?? null,
      relayer: d.relayer ?? null,
      deployedAt: d.deployedAt ?? new Date().toISOString(),
    };
    console.log(`chain ${chainId}: RealmLedger ${d.RealmLedger}`);
  }
}
writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
