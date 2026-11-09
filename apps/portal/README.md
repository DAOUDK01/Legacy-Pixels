# Legacy Pixels Workforce Portal — frontend (`apps/portal`)

Browser portal for the Legacy Pixels Workforce system, built to *Technical specification 1.0* (23 Oct 2026).
Next.js 15 (App Router) + TypeScript + Tailwind CSS + TanStack Query.

The NestJS API isn't built yet, so the portal ships with an **in-browser mock API** (`src/mock`) that implements
the same `/v1` routes, error envelope, `If-Match` versioning, idempotency keys, scoped authorization and
state machines described in the spec. When the real API exists, switch one environment variable.

## Run it

From the repository root (`Legacy_Pixels/`) — the root `package.json` forwards to this app — or from `apps/portal` itself:

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign in by picking a demo person on the login screen (the OIDC provider is simulated). Each person has
a different role, so the navigation, data and actions change:

| Person | Role(s) |
| --- | --- |
| Ayesha Raza | Owner (payroll final approval, policy approval, evidence access) |
| Bilal Ahmed | Administrator (identities, devices, settings — no pay or screenshots) |
| Sana Malik | HR (records, attendance/leave approvals, assets) |
| Omar Farooq | Payroll officer (prepare, propose adjustments, export — cannot final-approve) |
| Hamza Qureshi | Manager (Design and Video teams) |
| Zara Khan | Reviewer / team lead |
| Ali Hassan, Fatima Noor, Usman Tariq, Hira Aslam | Employees |
| Nadia Iqbal | Auditor (read-only, time-boxed grant) |
| Kamran Shah | Suspended — sign-in is denied |

Demo data lives in `localStorage` and survives reloads. Reset it from the login screen or **Administration → Demo controls**
(which can also simulate a Google Drive outage and network latency).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: normative calculations (score 88.0, rubric 87.50, payroll 106500), CSV safety |

## Connecting the real API

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_API_MODE=http
NEXT_PUBLIC_API_BASE_URL=https://api.example.internal/v1
```

All screens call `request()` in `src/lib/api/transport.ts`. In `http` mode it sends cookies (`credentials: "include"`),
`If-Match`, `Idempotency-Key` and `X-CSRF-Token` headers and parses the spec's error envelope
(`code, message, fieldErrors, requestId, retryable`). The portal never talks to PostgreSQL or Google Drive directly.
Sign-in redirects to `${API_BASE}/auth/oidc/start`.

## Layout

```
src/
  app/                 routes (App Router); (portal)/ is the authenticated shell
  components/ui        design-system primitives (Button, Dialog, Table, QueryState…)
  components/shell     sidebar, top bar, search, notifications, idle timeout
  components/domain    StateBadge, Person, MoneyText, VersionConflictDialog, ReportMeta
  lib/types.ts         entity/DTO types (spec §21–23)
  lib/rbac.ts          role → action.resource:scope permissions (spec §3) — UI hints only
  lib/calc             fixed-precision money, rubric, productivity score, payroll line maths
  lib/time.ts          IANA timezone helpers (business dates vs UTC timestamps)
  mock/                mock API: db, seed, router, per-domain handlers
```

## Notes on spec conformance

- Authorization is enforced by the (mock) API; navigation visibility is only a convenience.
- Every list/detail screen handles loading, empty, forbidden, error, stale and offline states.
- Money is never floating point (`lib/calc/money.ts` uses scaled BigInt); displayed components are rounded half-up then summed.
- Tracking screens explain plainly what is and isn't collected; gaps show as *unknown*, never idle or worked time.
- Productivity scores are shown for coaching only and never feed wages automatically.
- No CRM, sales, revenue or profitability metrics appear anywhere.
