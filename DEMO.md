# Realm Raiders — demo run-sheet (5 minutes, one Android phone mirrored with scrcpy)

## The night before
| Check | Command / action | Expected |
|---|---|---|
| Tests green | `pnpm -r typecheck; pnpm -r test; pnpm e2e` | 0 errors, all pass |
| Originality | `pnpm check:originality` | ✓ |
| Determinism on the phone | sign-in screen → tap the crest 7× → `/dev/sim` | digest `0xc0afd3965bc7fff416f2285bea70284ee39fd4dd6a88ed8a996e8f2be1037ebe`, golden-1..3 `OK` |
| Relayer funded | `GET /health` → `relayerBalance` | ≥ 15 MON (live mode) |
| LLM up | `GET /health` → `llm.mode` | `live` (or `offline` on purpose) |
| APK | `pnpm apk` (debug) or `cd apps/client/android; .\gradlew.bat assembleRelease` | installs with `adb install -r …` |
| Backup video | record one full run with `scrcpy --record demo.mp4` | kept on the laptop |

## Start the stack (laptop)
```powershell
ollama serve                                   # if using the local Qwen officers (LLM_LOCAL_BASE_URL)
pnpm --filter @realm/server start              # :8787 (CHAIN_MODE / AGENTS_MODE from apps/server/.env)
cloudflared tunnel --url http://localhost:8787 # phone on venue Wi-Fi → put the https URL in VITE_API_URL, rebuild
scrcpy                                          # mirror the phone
```
Dry run of every on-chain moment: `pnpm tsx tools/live-run.ts` (prints the explorer link of each tx).
Pre-seeded account (optional): `pnpm --filter @realm/server seed -- --demo` prints a session token for a General "Brannoc" with a sealed base.

## Script (§2.3)
| Time | Screen | Do / say | Proof on screen |
|---|---|---|---|
| 0:00 | Landing (laptop) | "Your General, your council, provable raids." | — |
| 0:20 | 01 Sign in | Continue with Google (or **Guest commander**) | "Forging your seal…", no wallet popup |
| 0:40 | 02 General | Swap hair/armour/cloak, pick *Bold*, name him, **Raise your banner** | `Agent ID #n` chip → explorer |
| 1:20 | 03 Home | The General greets you in a speech bubble and recommends **Kragmoor Deep**; pinch to zoom the island | speech bubble |
| 1:35 | 04 Build | **Shop** → buy a Goldworks (ghost + ✓), **Walls** → drag a wall line, **Builder tips**, **SAVE BASE** | `Monad ✓` chip → `BaseSealed` |
| 2:00 | 05 → 06 | Swipe through targets full-screen, **ATTACK**; Sefa tries every plan 50 times ("94% wins") | win % counters climb |
| 2:40 | 07 Battle | **ATTACK!** → `Fair play ✓` chip → Autoplay, ×2; dragon breathes on the towers | `SeedLocked` |
| 3:20 | 08 Result | Stars; **Fair play verified ✓** → *How we know* (seed, replay hash, re-sim match) | `BattleResolved` |
| 3:40 | 09 → 10 | Night → **Draft for me** → **Save tonight's orders** → **Simulate tonight** → Morning Report → **Apply Architect fix** | `PolicyCommitted`, `AutopilotAction` |
| 4:20 | Auto Mode | **Auto** → 30 min → orders → lock; the officers collect, build, re-save and raid; **TAKE CONTROL** | `PolicyCommitted` + `AutopilotAction (auto)` |
| 4:45 | 12 Profile | Badges, Renown, ERC-8004 reputation; tap **verify** on a battle (re-simulates on the phone) | on-chain reads |

## If something breaks
| Symptom | Switch to |
|---|---|
| Google sign-in fails | email OTP, else **Guest commander** (`ALLOW_DEMO_AUTH=1`) |
| Sponsorship / chain errors | `CHAIN_MODE=mock` on the server (chips show "mock"); every screen still works |
| Server unreachable | the APK falls back to the in-app realm (`VITE_BACKEND=auto`), "Offline realm · mock Ledger" |
| LLM slow or down | nothing to do: officers fall back to their built-in rules within 4 s; or `AGENTS_MODE=offline` |
| Anything else | play the recorded video |

## Device checklist (physical phone)
- [ ] Google login via Custom Tabs returns to the app (`adb shell pm get-app-links xyz.realmraiders.app` → `verified`)
- [ ] `assetlinks.json` deployed at `https://<LANDING_HOST>/.well-known/assetlinks.json` with the debug + release SHA-256
- [ ] 55+ fps in battle (Chrome `chrome://inspect` → Performance)
- [ ] Back button returns from every screen except Battle
- [ ] Screen stays awake during a battle
