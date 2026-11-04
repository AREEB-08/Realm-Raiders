import { z } from 'zod';

export const AGENT_ROLES = ['general', 'architect', 'strategist', 'night_captain', 'intel'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Tasks each role can be asked for over `POST /agents/:role/:task`. */
export const AGENT_TASKS: Record<AgentRole, readonly string[]> = {
  general: ['greeting', 'briefing', 'profile'],
  architect: ['tips', 'review'],
  strategist: ['commentary', 'callout'],
  night_captain: ['draft'],
  intel: ['report', 'targets'],
};

// ------------------------------------------------------------ tool arguments ---

export const ToolArgs = {
  get_player_state: z.object({}),
  list_targets: z.object({ max: z.number().int().min(1).max(3).optional() }),
  get_events: z.object({}),
  delegate: z.object({
    role: z.enum(['architect', 'strategist', 'night_captain', 'intel']),
    task: z.string().max(200),
  }),
  get_layout: z.object({}),
  analyze_layout: z.object({ layoutId: z.string().optional() }),
  propose_layout_patch: z.object({
    moves: z
      .array(z.object({ buildingId: z.string(), x: z.number().int().min(0).max(29), y: z.number().int().min(0).max(29) }))
      .max(5),
    rationale: z.string().max(280),
  }),
  get_target_base: z.object({}),
  list_plan_templates: z.object({}),
  run_simulations: z.object({
    planId: z.enum(['shieldwall', 'sapper_breach', 'drake_raid']),
    n: z.number().int().min(1).max(50),
  }),
  apply_coaching: z.object({
    planId: z.enum(['shieldwall', 'sapper_breach', 'drake_raid']),
    side: z.enum(['north', 'east', 'south', 'west']).optional(),
    waveDelayTicks: z.number().int().min(0).max(200).optional(),
    swap: z
      .object({
        from: z.enum(['shield', 'longbow', 'sapper', 'ravager', 'drake', 'mage']),
        to: z.enum(['shield', 'longbow', 'sapper', 'ravager', 'drake', 'mage']),
        housing: z.number().int().min(1).max(4),
      })
      .optional(),
  }),
  get_policy_options: z.object({}),
  draft_policy: z.object({
    repairPriority: z.enum(['walls', 'defenses', 'resources']),
    reserveGoldPct: z.number().int().min(0).max(80),
    autoRetaliate: z.boolean(),
    maxRetaliateCitadelDelta: z.number().int().min(-2).max(2).optional(),
    shieldIfLossesOverPct: z.number().int().min(10).max(100).optional(),
  }),
  get_battle_report: z.object({ battleId: z.string().optional() }),
  get_replay_events: z.object({ battleId: z.string().optional() }),
  get_opponent_history: z.object({ islandId: z.string().optional() }),
} as const;
export type ToolName = keyof typeof ToolArgs;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_player_state: "The player's resources, Renown, Citadel level and General.",
  list_targets: "List up to 3 sealed rival islands near the player's strength.",
  get_events: 'Recent events on the home island.',
  delegate: 'Ask another officer for a short answer.',
  get_layout: "The player's current base layout.",
  analyze_layout: 'Static analysis of a base: defence coverage per quadrant, exposed resource buildings, wall gaps.',
  propose_layout_patch: 'Propose up to 5 building moves. Server validates footprint/overlap.',
  get_target_base: 'The target base for this War Room.',
  list_plan_templates: 'The available attack plan templates.',
  run_simulations: 'Run N deterministic practice battles of a plan against the target base. Returns aggregate stats only.',
  apply_coaching: 'Apply allowed adjustments to a plan: deploy side, wave delay, troop swap of up to 4 housing.',
  get_policy_options: 'Allowed fields and ranges for the night policy.',
  draft_policy: "Draft tonight's autopilot defence policy from allowed options.",
  get_battle_report: 'Fetch result + key sim events for a battle id.',
  get_replay_events: 'Raw key events from a replay.',
  get_opponent_history: "An opponent's past raids and defences.",
};

/** Roles → allowed tools (§14.2). */
export const ROLE_TOOLS: Record<AgentRole, ToolName[]> = {
  general: ['get_player_state', 'list_targets', 'get_events', 'delegate'],
  architect: ['get_layout', 'analyze_layout', 'propose_layout_patch'],
  strategist: ['get_target_base', 'list_plan_templates', 'run_simulations', 'apply_coaching'],
  night_captain: ['get_policy_options', 'draft_policy'],
  intel: ['get_battle_report', 'get_replay_events', 'get_opponent_history'],
};

/** OpenAI `tools` JSON for a role, generated from the zod schemas. */
export function toolsFor(role: AgentRole) {
  return ROLE_TOOLS[role].map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: z.toJSONSchema(ToolArgs[name]) as Record<string, unknown>,
    },
  }));
}

// --------------------------------------------------------- role outputs ---

const Line = z.string().max(240);

export const RoleOutputs = {
  general: z.object({
    greeting: Line,
    briefing: z.array(Line).max(3).default([]),
    suggestedTarget: z.string().nullable().optional(),
  }),
  architect: z.object({
    tips: z.array(Line).max(3),
    rationale: Line.optional(),
  }),
  strategist: z.object({
    thoughts: z.array(Line).max(4).default([]),
    recommended: z.enum(['shieldwall', 'sapper_breach', 'drake_raid']).optional(),
    tips: z.record(z.string(), Line).optional(),
    callout: Line.optional(),
  }),
  night_captain: z.object({
    policy: ToolArgs.draft_policy,
    explanation: z.array(Line).max(5),
  }),
  intel: z.object({
    headline: Line,
    keyMoments: z.array(z.object({ tick: z.number().int(), text: Line })).max(5),
    opponentNotes: z.array(Line).max(3).default([]),
  }),
} as const;

export type GeneralOutput = z.infer<typeof RoleOutputs.general>;
export type ArchitectOutput = z.infer<typeof RoleOutputs.architect>;
export type StrategistOutput = z.infer<typeof RoleOutputs.strategist>;
export type NightCaptainOutput = z.infer<typeof RoleOutputs.night_captain>;
export type IntelOutput = z.infer<typeof RoleOutputs.intel>;

/** Wrap player-written text before it reaches a prompt (§14.6). */
export const playerText = (s: string) =>
  `<player_text>${s.slice(0, 200).replace(/<\/?player_text>/g, '')}</player_text>`;
