import type {
  AgentLogDoc,
  AgentMemoryDoc,
  AutoSessionDoc,
  BaseDoc,
  BattleDoc,
  Doc,
  GemLogDoc,
  GeneralDoc,
  IslandDoc,
  KvDoc,
  PlayerDoc,
  PolicyDoc,
  ReportDoc,
  ResourcesDoc,
  TxDoc,
  WarRoomDoc,
} from './types';

export interface Table<T extends Doc> {
  get(id: string): Promise<T | undefined>;
  put(doc: T): Promise<void>;
  delete(id: string): Promise<void>;
  all(): Promise<T[]>;
  find(pred: (doc: T) => boolean): Promise<T[]>;
}

export interface Repo {
  players: Table<PlayerDoc>;
  generals: Table<GeneralDoc>;
  bases: Table<BaseDoc>;
  resources: Table<ResourcesDoc>;
  islands: Table<IslandDoc>;
  warRooms: Table<WarRoomDoc>;
  battles: Table<BattleDoc>;
  policies: Table<PolicyDoc>;
  reports: Table<ReportDoc>;
  agentMemory: Table<AgentMemoryDoc>;
  agentLog: Table<AgentLogDoc>;
  txs: Table<TxDoc>;
  kv: Table<KvDoc>;
  gemLog: Table<GemLogDoc>;
  autoSessions: Table<AutoSessionDoc>;
}

export const TABLE_NAMES = [
  'players',
  'generals',
  'bases',
  'resources',
  'islands',
  'warRooms',
  'battles',
  'policies',
  'reports',
  'agentMemory',
  'agentLog',
  'txs',
  'kv',
  'gemLog',
  'autoSessions',
] as const satisfies readonly (keyof Repo)[];

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory table (client offline mode, tests). Stores clones so callers can't alias state. */
export class MemoryTable<T extends Doc> implements Table<T> {
  readonly rows = new Map<string, T>();
  constructor(private readonly onChange?: () => void) {}
  async get(id: string) {
    const v = this.rows.get(id);
    return v ? clone(v) : undefined;
  }
  async put(doc: T) {
    this.rows.set(doc.id, clone(doc));
    this.onChange?.();
  }
  async delete(id: string) {
    this.rows.delete(id);
    this.onChange?.();
  }
  async all() {
    return [...this.rows.values()].map(clone);
  }
  async find(pred: (doc: T) => boolean) {
    return [...this.rows.values()].filter(pred).map(clone);
  }
}

export type RepoSnapshot = Partial<Record<keyof Repo, Doc[]>>;

export class MemoryRepo implements Repo {
  players: MemoryTable<PlayerDoc>;
  generals: MemoryTable<GeneralDoc>;
  bases: MemoryTable<BaseDoc>;
  resources: MemoryTable<ResourcesDoc>;
  islands: MemoryTable<IslandDoc>;
  warRooms: MemoryTable<WarRoomDoc>;
  battles: MemoryTable<BattleDoc>;
  policies: MemoryTable<PolicyDoc>;
  reports: MemoryTable<ReportDoc>;
  agentMemory: MemoryTable<AgentMemoryDoc>;
  agentLog: MemoryTable<AgentLogDoc>;
  txs: MemoryTable<TxDoc>;
  kv: MemoryTable<KvDoc>;
  gemLog: MemoryTable<GemLogDoc>;
  autoSessions: MemoryTable<AutoSessionDoc>;

  constructor(onChange?: (table: keyof Repo) => void) {
    const t = <D extends Doc>(name: keyof Repo) => new MemoryTable<D>(() => onChange?.(name));
    this.players = t('players');
    this.generals = t('generals');
    this.bases = t('bases');
    this.resources = t('resources');
    this.islands = t('islands');
    this.warRooms = t('warRooms');
    this.battles = t('battles');
    this.policies = t('policies');
    this.reports = t('reports');
    this.agentMemory = t('agentMemory');
    this.agentLog = t('agentLog');
    this.txs = t('txs');
    this.kv = t('kv');
    this.gemLog = t('gemLog');
    this.autoSessions = t('autoSessions');
  }

  snapshot(skip: (keyof Repo)[] = []): RepoSnapshot {
    const out: RepoSnapshot = {};
    for (const name of TABLE_NAMES) {
      if (skip.includes(name)) continue;
      out[name] = [...(this[name] as MemoryTable<Doc>).rows.values()];
    }
    return out;
  }

  restore(snap: RepoSnapshot) {
    for (const name of TABLE_NAMES) {
      const rows = snap[name];
      if (!rows) continue;
      const table = this[name] as MemoryTable<Doc>;
      table.rows.clear();
      for (const r of rows) table.rows.set(r.id, r);
    }
  }
}
