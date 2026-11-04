# Realm Raiders

Android island-raid strategy game on Monad, set in an original world (the Emberwake Isles). Built from `../main_project/Project_Guide.md`; see `DEMO.md` for the live-demo run sheet.

## Run it
```powershell
pnpm install
pnpm dev:local                 # app only: the whole realm runs in-browser on a mock Ledger → http://localhost:5173
pnpm dev                       # app + API server (:8787)
pnpm apk                       # web build → cap sync → debug APK (apps/client/android/app/build/outputs/apk/debug/)
cd apps/client/android; .\gradlew.bat assembleRelease   # signed release APK (needs android/keystore.properties)
pnpm -r typecheck; pnpm -r test; pnpm e2e; pnpm check:originality
pnpm verify-replay packages/battle-engine/fixtures/golden-1.rrpl     # → OK 0x0e3f15cb… 3★ 100%
pnpm digest                    # 200-seed determinism digest (must equal the phone's /dev/sim: tap the sign-in crest 7×)
```

### AI officers (live, no API keys)
`apps/server/.env` is set to `AGENTS_MODE=live` with a local **Qwen3 4B** through Ollama:
```powershell
ollama serve     # once; model already pulled: qwen3:4b (qwen3:8b is also pulled but is ~10 s/answer on a 6 GB GPU)
```
Hosted Qwen (Model Studio / OpenRouter) is used first when `LLM_BASE_URL`/`LLM_API_KEY` are set. Every officer falls back to its rule-based "field manual" after 4 s, on invalid JSON, or when an answer quotes a number that is not in its facts.

### Monad testnet (live)
Deployed and source-verified (Sourcify / MonadVision) on 2026-11-03; the server runs with `CHAIN_MODE=live`.

| Contract | Address |
|---|---|
| RealmLedger | [`0xec0e5ae643491f288f0332f695dc2f20fdbd0352`](https://testnet.monadvision.com/address/0xec0e5ae643491f288f0332f695dc2f20fdbd0352) |
| RealmBadges | [`0xfe87d11da421427f0a72f587efc7dcc13f0d4d70`](https://testnet.monadvision.com/address/0xfe87d11da421427f0a72f587efc7dcc13f0d4d70) |
| ERC-8004 Identity / Reputation (canonical) | `0x8004A818…BD9e` / `0x8004B663…8713` |
| Relayer / referee | `0x0F6d70f0F779e7d680C4126D94E345eF7B226337` (key in gitignored `apps/server/.env`) |

```powershell
pnpm --filter @realm/server start        # live server on :8787 (needs `ollama serve` for live officers)
pnpm tsx tools/live-run.ts               # plays every on-chain moment through the API and prints the explorer links
pnpm verify-replay <battleId> --api http://localhost:8787 --chain   # re-checks a raid against RealmLedger
pnpm --filter @realm/contracts deploy    # (re)deploy; then: pnpm --filter @realm/contracts verify
```

### Play on a phone
- **Offline (any phone):** install `app-debug.apk` or `app-release.apk`; with no server in reach the whole realm runs on the phone (mock Ledger).
- **Live (same Wi-Fi as this PC):** start the server, allow Node through Windows Firewall on port 8787, and install the **debug** APK — it tries `http://10.0.2.2:8787` (emulator) then `http://192.168.0.104:8787` (this PC, set in `apps/client/.env`). Release builds need an HTTPS server URL (e.g. `cloudflared tunnel --url http://localhost:8787`) in `VITE_API_URL` before building.
- Agent cards registered on-chain point at `PUBLIC_BASE_URL`; set it to a public HTTPS host for cards that resolve outside this PC.
Foundry path (if installed): `cd contracts; forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git; forge test -vv; forge script script/Deploy.s.sol …`.

### Google / email sign-in
Create a Privy app (Google + email, Monad Testnet gas sponsorship, allowed origin `https://localhost`, redirect `https://<LANDING_HOST>/redirect`), then set `VITE_PRIVY_APP_ID` (client) and `PRIVY_APP_ID` / `PRIVY_APP_SECRET` (server). Until then **Guest commander** sign-in is used.

## Layout
`packages/battle-engine` deterministic integer engine · `packages/game-data` every number · `packages/shared` schemas, ABIs, hashes · `packages/core` game services shared by the server **and** the in-app offline realm · `apps/server` Fastify + SQLite + WebSocket + officers + viem relayer · `apps/client` React + Phaser + Three + Capacitor (screens 01–12) · `apps/landing` (with `/.well-known/assetlinks.json` and `/redirect`) · `contracts` · `tools/verify-replay.ts`.

## Signing
Release keystore: `C:\Users\moham\.realm-raiders\realm-release.keystore` (outside git; **back it up**), referenced by `apps/client/android/keystore.properties` (gitignored). Its SHA-256 and the debug key's are in `apps/landing/public/.well-known/assetlinks.json`.

## Deviations from the guide (also in guide §6, D25–D33)
- New folder `realm-raiders/` instead of `main_project/`; extra package `packages/core` so the APK plays fully offline.
- All art, the 3D General, the boss and audio are procedural and original (no CC0 packs yet; `tools/assets/import.mjs` is ready for them).
- Rules: starting ember 100; all troop types available (Muster Hall sets troop level); loot scales with destruction; `end` action in replays; replays carry the sealed base as a trailer; `recordDefence`/`DefenseRecorded` on RealmLedger; night raids are General-less raiding parties of `4 + 2×CL` housing; the starter base has its 2 caltrop pits.
- Node 22.14 + pnpm 10 (guide: Node 24 / pnpm 12). Foundry could not be installed here, so contracts compile with solc-js 0.8.38 and run on an in-process EVM; the viem deploy script replaces `forge script`.
- Local officers use `qwen3:4b` (not 8B) to fit the 4 s budget on a 6 GB laptop GPU, answer in one round from their facts (no tool rounds locally), and pass a number-grounding check.
