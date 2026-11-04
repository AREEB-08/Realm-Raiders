import { normalizeBase, baseHash, keccak, utf8 } from '@realm/battle-engine';
import { BADGES, GEM_REWARDS, NPC_ISLANDS, STARTING_GEMS, STARTING_WALLET, starterLayout, type BadgeKey } from '@realm/game-data';
import type { EventCard, Hex, TxRef } from '@realm/shared';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PlayerSigner } from '../chain/types';
import type { Ctx } from '../ctx';
import { HttpError, type BaseDoc, type GeneralDoc, type PlayerDoc, type ResourcesDoc } from '../types';
import { grantGems } from './gems';

export function uid(prefix = ''): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export const chainBattleId = (id: string): Hex => keccak(utf8(id));

export function newBurner(): { key: Hex; address: Hex } {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address };
}

export function npcBurner(npcKey: string): { key: Hex; address: Hex } {
  const key = keccak(utf8(`realm-raiders:npc:${npcKey}`));
  return { key, address: privateKeyToAccount(key).address };
}

export function freshBase(id: string, now: number): BaseDoc {
  const layout = starterLayout();
  const collectedAt: Record<string, number> = {};
  for (const b of layout.buildings) collectedAt[b.id] = now;
  return {
    id,
    layout,
    version: 1,
    sealedHash: null,
    sealedVersion: null,
    sealedLayout: null,
    sealTx: null,
    sealedAt: null,
    timers: {},
    collectedAt,
    pendingPatch: null,
    nextSeq: 100,
  };
}

export function freshResources(id: string, now: number): ResourcesDoc {
  return {
    id,
    ...STARTING_WALLET,
    renown: 0,
    updatedAt: now,
    stats: { raidsWon: 0, raidsLost: 0, defWon: 0, defLost: 0, nightWatchWins: 0 },
    badges: [],
    badgeTxs: {},
    events: [],
    shieldUntil: 0,
    gems: STARTING_GEMS,
  };
}

export async function createPlayer(
  ctx: Ctx,
  p: { authSub: string; address: Hex; isGuest: boolean; burnerKey: Hex | null; npcKey?: string | null },
): Promise<PlayerDoc> {
  const now = ctx.now();
  const player: PlayerDoc = {
    id: uid('p_'),
    authSub: p.authSub,
    address: p.address,
    createdAt: now,
    isGuest: p.isGuest,
    burnerKey: p.burnerKey,
    npcKey: p.npcKey ?? null,
  };
  await ctx.repo.players.put(player);
  await ctx.repo.bases.put(freshBase(player.id, now));
  await ctx.repo.resources.put(freshResources(player.id, now));
  return player;
}

export async function loadPlayer(ctx: Ctx, playerId: string) {
  const player = await ctx.repo.players.get(playerId);
  if (!player) throw new HttpError(401, 'unknown player');
  let base = await ctx.repo.bases.get(playerId);
  let res = await ctx.repo.resources.get(playerId);
  const now = ctx.now();
  if (!base) await ctx.repo.bases.put((base = freshBase(playerId, now)));
  if (!res) await ctx.repo.resources.put((res = freshResources(playerId, now)));
  const general = (await ctx.repo.generals.get(playerId)) ?? null;
  return { player, base, res, general };
}

export function signerOf(player: PlayerDoc, sig?: { signature?: string; deadline?: number }): PlayerSigner {
  return {
    address: player.address,
    privateKey: player.burnerKey,
    signature: sig?.signature as Hex | undefined,
    deadline: sig?.deadline,
  };
}

export function pushEvent(res: ResourcesDoc, card: Omit<EventCard, 'id'>, now: number) {
  res.events.unshift({ id: uid('e_'), ...card, at: card.at ?? now });
  res.events = res.events.slice(0, 12);
}

/** Award a soulbound badge once (on-chain via RealmBadges), and note it in the feed. */
export async function awardBadge(ctx: Ctx, player: PlayerDoc, res: ResourcesDoc, key: BadgeKey): Promise<{ id: number; name: string; tx: TxRef | null } | null> {
  const badge = BADGES.find((b) => b.key === key)!;
  if (res.badges.includes(badge.id)) return null;
  let tx: TxRef | null = null;
  try {
    tx = await ctx.chain.awardBadge(player.address, badge.id);
  } catch (e) {
    ctx.log(`badge ${key} award failed`, (e as Error).message);
  }
  res.badges.push(badge.id);
  res.badgeTxs[String(badge.id)] = tx;
  pushEvent(res, { icon: 'badge', title: `Badge earned: ${badge.name}`, body: `${badge.desc} · +${GEM_REWARDS.badge} Gems`, at: ctx.now(), tx }, ctx.now());
  if (!player.npcKey) await grantGems(ctx, res, GEM_REWARDS.badge, 'badge', `New badge: ${badge.name}`);
  return { id: badge.id, name: badge.name, tx };
}

export async function generalOf(ctx: Ctx, playerId: string): Promise<GeneralDoc | null> {
  return (await ctx.repo.generals.get(playerId)) ?? null;
}

/**
 * The seeded demo world (§10.8): three NPC islands, each owned by an NPC with a burner key,
 * each base sealed in the Ledger. Idempotent; re-seals if the chain was reset.
 */
export async function ensureWorld(ctx: Ctx) {
  for (const npc of NPC_ISLANDS) {
    let island = await ctx.repo.islands.get(npc.key);
    const burner = npcBurner(npc.key);
    let owner = (await ctx.repo.players.find((p) => p.npcKey === npc.key))[0];
    if (!owner) {
      owner = await createPlayer(ctx, {
        authSub: `npc:${npc.key}`,
        address: burner.address,
        isGuest: false,
        burnerKey: burner.key,
        npcKey: npc.key,
      });
    }
    const layout = npc.layout();
    if (!island) {
      island = {
        id: npc.key,
        ownerPlayerId: owner.id,
        npcKey: npc.key,
        name: npc.name,
        ownerName: npc.owner,
        difficulty: npc.difficulty,
        blurb: npc.blurb,
        stored: { ...npc.stored },
        layout,
      };
      await ctx.repo.islands.put(island);
    }
    const base = (await ctx.repo.bases.get(owner.id))!;
    base.layout = layout;
    const hash = baseHash(normalizeBase(layout));
    const onChain = await ctx.chain.sealOf(owner.address);
    if (!onChain || onChain.baseHash.toLowerCase() !== hash.toLowerCase()) {
      try {
        base.sealTx = await ctx.chain.sealBaseFor(signerOf(owner), hash, 1);
      } catch (e) {
        ctx.log(`could not seal ${npc.name}`, (e as Error).message);
      }
    }
    base.sealedHash = hash;
    base.sealedLayout = layout;
    base.sealedVersion = 1;
    base.sealedAt = base.sealedAt ?? ctx.now();
    await ctx.repo.bases.put(base);
  }
}
