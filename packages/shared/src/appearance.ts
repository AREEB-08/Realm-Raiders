import { z } from 'zod';
import { canonicalHash } from './canonical';

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BODIES = ['warden', 'knight', 'ranger_scout', 'runecaller', 'longstrider'] as const;
export const HEADS = ['plain', 'scarred', 'bearded', 'braided'] as const;
export const HAIRS = ['none', 'short', 'long_braid', 'hood', 'horned_helm', 'circlet'] as const;
export const CLOAKS = ['none', 'short_cape', 'long_cloak', 'banner_pole'] as const;
export const WEAPONS = ['sword', 'axe', 'spear', 'staff', 'bow', 'hammer'] as const;
export const SHIELDS = ['round', 'heater', 'kite'] as const;
export const FACTION_IDS = ['thornmarch', 'hollowdeep', 'skyrend', 'ashenfen'] as const;
export const PERSONALITY_IDS = ['bold', 'cunning', 'steadfast', 'merry'] as const;

/** The General's look (§12.3). Its hash goes into the ERC-8004 agent card. */
export const Appearance = z.object({
  v: z.literal(1),
  body: z.enum(BODIES),
  head: z.enum(HEADS),
  hair: z.enum(HAIRS),
  cloak: z.enum(CLOAKS),
  weapon: z.enum(WEAPONS),
  shield: z.enum(SHIELDS).nullable(),
  colors: z.object({
    primary: HexColor,
    secondary: HexColor,
    metal: HexColor,
    skin: HexColor,
    hair: HexColor,
  }),
  faction: z.enum(FACTION_IDS),
});
export type Appearance = z.infer<typeof Appearance>;

export const appearanceHash = (a: Appearance) => canonicalHash(a);

export const BODY_NAMES: Record<(typeof BODIES)[number], string> = {
  warden: 'Warden',
  knight: 'Knight',
  ranger_scout: 'Ranger-scout',
  runecaller: 'Runecaller',
  longstrider: 'Longstrider',
};

export const SKIN_TONES = ['#f1d2b6', '#d9a982', '#b07a52', '#8a5a3b', '#5e3b26'] as const;
export const HAIR_COLORS = ['#2b1d14', '#5a3a22', '#a8743a', '#d8c08a', '#c9c9c9', '#7a2f1d'] as const;

export function defaultAppearance(faction: Appearance['faction'] = 'thornmarch'): Appearance {
  const palette = {
    thornmarch: { primary: '#3f6b3a', secondary: '#e8dfc8', metal: '#8c8f86' },
    hollowdeep: { primary: '#4b5563', secondary: '#e07b28', metal: '#6d6a65' },
    skyrend: { primary: '#27527a', secondary: '#c08a3e', metal: '#b07d3c' },
    ashenfen: { primary: '#5b3f7a', secondary: '#a9a6a0', metal: '#77736c' },
  }[faction];
  return {
    v: 1,
    body: 'warden',
    head: 'bearded',
    hair: 'short',
    cloak: 'long_cloak',
    weapon: 'sword',
    shield: 'heater',
    colors: { ...palette, skin: SKIN_TONES[1], hair: HAIR_COLORS[1] },
    faction,
  };
}
