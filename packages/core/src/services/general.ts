import { RoleOutputs, appearanceHash, type GeneralOutput } from '@realm/shared';
import type { z } from 'zod';
import type { Bodies } from '@realm/shared';
import { generalGreeting, generalProfileLine } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { HttpError, type GeneralDoc } from '../types';
import { loadPlayer } from './common';
import { generalDTO } from './home';

export async function putGeneral(ctx: Ctx, playerId: string, body: z.infer<typeof Bodies.putGeneral>) {
  await loadPlayer(ctx, playerId);
  const existing = await ctx.repo.generals.get(playerId);
  const doc: GeneralDoc = {
    id: playerId,
    name: body.name,
    personality: body.personality,
    faction: body.faction,
    appearance: body.appearance,
    appearanceHash: appearanceHash(body.appearance),
    agentId: existing?.agentId ?? null,
    agentTx: existing?.agentTx ?? null,
    portrait: existing?.portrait ?? null,
    firstLine: existing?.firstLine ?? null,
  };
  await ctx.repo.generals.put(doc);
  return { general: generalDTO(doc) };
}

export async function putPortrait(ctx: Ctx, playerId: string, png: string) {
  const g = await ctx.repo.generals.get(playerId);
  if (!g) throw new HttpError(400, 'create your General first');
  const clean = png.replace(/^data:image\/png;base64,/, '');
  if (clean.length * 0.75 > 300 * 1024) throw new HttpError(413, 'portrait must be ≤ 300 KB');
  g.portrait = await ctx.files.putPortrait(playerId, clean);
  await ctx.repo.generals.put(g);
  return { url: g.portrait };
}

/** ERC-8004 registration file for the General (§15.1; field names follow the current draft). */
export async function agentCard(ctx: Ctx, playerId: string) {
  const g = await ctx.repo.generals.get(playerId);
  if (!g) throw new HttpError(404, 'no General');
  const base = ctx.cfg.publicBaseUrl;
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `${g.name} the ${g.personality[0]!.toUpperCase()}${g.personality.slice(1)}`,
    description: 'General of the Emberwake Isles in Realm Raiders',
    image: g.portrait && base && !g.portrait.startsWith('data:') ? g.portrait : `${base}/portraits/${playerId}.png`,
    services: [{ name: 'realm-raiders', endpoint: `${base}/agents/${playerId}` }],
    realmRaiders: {
      personality: g.personality,
      faction: g.faction,
      appearanceHash: g.appearanceHash,
      officers: ['architect', 'strategist', 'night_captain', 'intel'],
    },
  };
}

export async function agentUri(ctx: Ctx, playerId: string) {
  const card = await agentCard(ctx, playerId);
  if (ctx.cfg.publicBaseUrl) return { agentURI: `${ctx.cfg.publicBaseUrl}/agents/${playerId}/card.json` };
  const json = JSON.stringify(card);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return { agentURI: `data:application/json;base64,${b64}` };
}

export async function confirmAgent(ctx: Ctx, playerId: string, txHash: `0x${string}`) {
  const { player } = await loadPlayer(ctx, playerId);
  const g = await ctx.repo.generals.get(playerId);
  if (!g) throw new HttpError(400, 'create your General first');
  const r = await ctx.chain.confirmPlayerTx('register', txHash, player.address);
  if (!r.ok || !r.agentId) throw new HttpError(409, `registration not confirmed: ${r.reason ?? 'no agent id'}`);
  g.agentId = r.agentId;
  g.agentTx = ctx.chain.ref('register', txHash, r.block);
  await ctx.repo.generals.put(g);
  return { agentId: g.agentId, agentTx: g.agentTx };
}

/** Fallback: the relayer registers the agent and transfers the card to the player. */
export async function relayAgent(ctx: Ctx, playerId: string) {
  const { player } = await loadPlayer(ctx, playerId);
  const g = await ctx.repo.generals.get(playerId);
  if (!g) throw new HttpError(400, 'create your General first');
  if (g.agentId) return { agentId: g.agentId, agentTx: g.agentTx };
  const { agentURI } = await agentUri(ctx, playerId);
  const { tx, agentId } = await ctx.chain.registerAgentFor(player.address, agentURI);
  g.agentId = agentId;
  g.agentTx = tx;
  await ctx.repo.generals.put(g);
  return { agentId, agentTx: tx };
}

export async function greetingTask(ctx: Ctx, playerId: string) {
  const g = await ctx.repo.generals.get(playerId);
  if (!g) throw new HttpError(400, 'create your General first');
  const out = await ctx.agents.run<GeneralOutput>({
    role: 'general',
    task: 'greeting',
    playerId,
    facts: { personality: g.personality, faction: g.faction },
    playerText: g.name,
    schema: RoleOutputs.general,
    fallback: () => generalGreeting(g.name, g.personality),
    check: (o) => (o.greeting.length > 200 ? 'greeting too long' : o.briefing?.length ? 'a greeting has no briefing' : null),
  });
  g.firstLine = out.output.greeting;
  await ctx.repo.generals.put(g);
  return out;
}

export async function profileLineTask(ctx: Ctx, playerId: string, wins: number, losses: number, renown: number) {
  const g = await ctx.repo.generals.get(playerId);
  const name = g?.name ?? 'The General';
  return ctx.agents.run<GeneralOutput>({
    role: 'general',
    task: 'profile',
    playerId,
    facts: { wins, losses, renown, personality: g?.personality ?? 'steadfast' },
    playerText: name,
    schema: RoleOutputs.general,
    fallback: () => generalProfileLine(name, wins, losses, renown),
  });
}
