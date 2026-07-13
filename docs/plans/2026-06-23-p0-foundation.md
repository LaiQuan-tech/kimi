# P0 Foundation — 多租戶骨架 / 隔離 / 認證 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立 HR 差勤 SaaS 的 monorepo 地基：多租戶資料骨架（tenants/employees/departments）、行級 RLS by tenant 的雙防線、`requireTenant`/`requireRole` 認證中介層、租戶 onboarding 與白標讀取——並用「跨租戶隔離測試」證明資料不會外洩。

**Architecture:** 沿用 Realreal 的 npm workspace + Turbo monorepo（`apps/web` Next.js、`apps/api` Express、`apps/worker` BullMQ、`packages/db` Drizzle+Supabase、新增 `packages/rules`）。租戶隔離靠「API 層 `requireTenant` 強制 `tenant_id` + DB 層 RLS `current_tenant_id()` 兜底」雙防線。

**Tech Stack:** Node 22、TypeScript、npm workspaces、Turbo、Express 5、Drizzle ORM、Supabase（Postgres + Auth）、vitest、Zod。

**前置：** 需要一個 Supabase 專案（dev）。在 repo 根目錄 `.env`（不入 git）放 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`、`DATABASE_URL`。參考 `Realreal/apps/api/.env.local.example`。

---

## Task 0: 環境前置（人工，一次性）

**Step 1:** 建立 Supabase dev 專案，取得 URL / service_role key / anon key / DATABASE_URL（connection string，pooler 6543 給 app、direct 5432 給 migration）。
**Step 2:** repo 根目錄建 `.env`（內容如上），並建 `.gitignore` 含 `.env`、`node_modules`、`dist`、`.next`、`.turbo`。
**Step 3:** 確認 `node -v` ≥ 22、`npm -v` ≥ 10。

---

## Task 1: Monorepo 骨架 + 工具鏈

**Files:**
- Create: `package.json`（root, workspaces）、`turbo.json`、`tsconfig.base.json`、`.gitignore`、`vitest.config.ts`、`README.md`
- Reference: 照抄 `Realreal/package.json`、`Realreal/turbo.json` 結構並清掉電商相關 script。

**Step 1:** 寫 root `package.json`：

```json
{
  "name": "hr-saas",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "db:generate": "npm -w @hr/db run generate",
    "db:migrate": "npm -w @hr/db run migrate"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.6",
    "vitest": "^2",
    "@types/node": "^22"
  },
  "engines": { "node": ">=22" }
}
```

**Step 2:** 寫 `turbo.json`（沿用 Realreal 的 pipeline：`build` dependsOn `^build`，`test`/`typecheck` 無快取依賴）。
**Step 3:** 寫 `tsconfig.base.json`（`strict: true`、`moduleResolution: "bundler"`、`paths` 給 `@hr/db`、`@hr/rules`）。
**Step 4:** `npm install`（建立 workspace lockfile）。
**Step 5:** Commit。

```bash
git add -A && git commit -m "chore: monorepo scaffold (workspaces + turbo + tsconfig)"
```

---

## Task 2: `packages/db` — Drizzle + Supabase 連線

**Files:**
- Create: `packages/db/package.json`（name `@hr/db`）、`packages/db/drizzle.config.ts`、`packages/db/src/client.ts`、`packages/db/src/schema/index.ts`（空 barrel）
- Reference: `Realreal/packages/db/*`（drizzle.config、client 連線方式照抄）。

**Step 1:** `packages/db/package.json` 依賴 `drizzle-orm`、`postgres`、`@supabase/supabase-js`；script `generate`（drizzle-kit generate）、`migrate`（drizzle-kit migrate）。
**Step 2:** `drizzle.config.ts` 指向 `src/schema`、`migrations/`，用 `DATABASE_URL`（direct 5432）。
**Step 3:** `src/client.ts` 匯出 `db`（drizzle(postgres(DATABASE_URL))），與 `supabaseAdmin`（service_role，bypass RLS）、`supabaseAnon`（給驗 JWT）。照抄 Realreal `lib/supabase.ts` 模式。
**Step 4:** `npm -w @hr/db run generate` 應成功（即使無表，產生空 migration 目錄）。
**Step 5:** Commit `feat(db): drizzle + supabase client scaffolding`。

---

## Task 3: 核心 schema — tenants / employees / departments

**Files:**
- Create: `packages/db/src/schema/tenants.ts`、`employees.ts`、`departments.ts`，更新 `schema/index.ts`
- Test: `packages/db/src/schema/__tests__/schema.test.ts`

**Step 1: 寫 schema（Drizzle）。** `tenants.ts`：

```typescript
import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core"

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active|suspended
  branding: jsonb("branding").notNull().default({}),   // { logoUrl, primaryColor, appName }
  features: jsonb("features").notNull().default({}),    // { payroll, kpi, ai_assistant }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
```

`departments.ts`（`id`, `tenantId` notNull FK→tenants, `parentId` self-FK nullable, `name`, `managerEmpId` nullable）。
`employees.ts`（`id`, `tenantId` notNull FK, `userId` uuid nullable（→ auth.users）, `empNo`, `name`, `deptId` FK nullable, `employmentType` text（regular|special_paid|hourly）, `hireDate`, `role` text（platform_admin|hr_admin|manager|employee）, `status`）。

**Step 2: 失敗測試** — `schema.test.ts` 斷言三張表的欄位存在、`tenantId` 在 employees/departments 為 notNull（用 drizzle 的 table introspection 或型別層級 assert）。Run: `npm -w @hr/db test`，Expected: FAIL（表未匯出）。
**Step 3:** 更新 `schema/index.ts` barrel 匯出三表。
**Step 4:** Run 測試，Expected: PASS。
**Step 5: 產生 migration。** `npm -w @hr/db run generate` → 產生 `migrations/0001_core_tenancy.sql`。人工檢視確認 `tenant_id` 欄位與 FK 正確。
**Step 6:** Commit `feat(db): core tenancy schema (tenants/employees/departments)`。

---

## Task 4: RLS by tenant 雙防線（DB 層）

**Files:**
- Create: `packages/db/migrations/0002_rls_by_tenant.sql`（手寫 SQL，不經 drizzle generate）
- Reference: `Realreal/packages/db/migrations/0036_CRITICAL_enable_rls.sql`（照抄 `is_admin()` SECURITY DEFINER 模式 + DO-loop 套 policy 寫法）。

**Step 1: 寫 SQL migration。** 核心函式（從 JWT 取 tenant，SECURITY DEFINER 才能在 RLS 下讀）：

```sql
-- 取出目前請求的 tenant_id（來自 Supabase JWT app_metadata.tenant_id）
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id', '')::uuid $$;

-- 目前使用者在該租戶是否為 HR admin
CREATE OR REPLACE FUNCTION public.is_hr_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.tenant_id = public.current_tenant_id()
      AND e.role IN ('hr_admin','platform_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_hr_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id(), public.is_hr_admin() TO anon, authenticated, service_role;

-- GROUP A：同租戶可讀，HR 可寫（departments）
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY departments_tenant_read ON public.departments
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY departments_hr_write ON public.departments
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- GROUP B：本人 + HR 可讀（employees）
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employees_self_or_hr_read ON public.employees
  FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.is_hr_admin())
  );
CREATE POLICY employees_hr_write ON public.employees
  FOR ALL USING (tenant_id = public.current_tenant_id() AND public.is_hr_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_hr_admin());

-- tenants 本體：僅 service_role（平台超管經 API 操作）→ 啟 RLS、不給 policy
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
```

**Step 2: 套用到 dev DB。** Run: `npm -w @hr/db run migrate`，Expected: 成功，無錯。
**Step 3:** 人工在 Supabase SQL editor 確認三表 `rowsecurity = true`（`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tenants','employees','departments')`）。
**Step 4:** Commit `feat(db): RLS by tenant — current_tenant_id() + is_hr_admin() + policies`。

> 註：此處 RLS 是「兜底」。真正每次查詢仍由 API 層 `requireTenant` 強制帶 `tenant_id`（Task 6）。隔離測試在 Task 9。

---

## Task 5: `apps/api` Express 骨架

**Files:**
- Create: `apps/api/package.json`（`@hr/api`）、`apps/api/src/index.ts`、`apps/api/src/app.ts`、`apps/api/src/lib/supabase.ts`、`apps/api/src/lib/logger.ts`
- Reference: 照抄 `Realreal/apps/api/src/app.ts`（CORS 白名單、json parser、error handler、`/health`）與 `lib/supabase.ts`。

**Step 1:** `app.ts`：建立 Express app，掛 CORS（env `WEB_ORIGINS` 白名單）、`express.json()`、`/health` 回 `{status:"ok"}`、集中 error handler。
**Step 2:** `lib/supabase.ts`：匯出 `supabaseAdmin`（service_role）、`getUserFromToken(token)`（用 anon client `auth.getUser`）。
**Step 3:** `index.ts`：listen `PORT ?? 4000`。
**Step 4:** Smoke test：`curl localhost:4000/health` 回 200。寫成 vitest supertest：`app.test.ts` 斷言 `GET /health` → 200。Run PASS。
**Step 5:** Commit `feat(api): express skeleton + health + supabase client`。

---

## Task 6: 認證中介層 `requireAuth` / `requireTenant` / `requireRole`（TDD 重點）

**Files:**
- Create: `apps/api/src/middleware/auth.ts`、`tenant.ts`、`role.ts`
- Test: `apps/api/src/middleware/__tests__/tenant.test.ts`
- Reference: `Realreal/apps/api/src/middleware/auth.ts`（`requireAuth` 從 Bearer 取 user 照抄）。

**Step 1: 寫失敗測試** `tenant.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest"
import { requireTenant } from "../tenant"

function mockRes() { return { locals: {}, status: vi.fn().mockReturnThis(), json: vi.fn() } as any }

describe("requireTenant", () => {
  it("把 JWT 的 tenant_id 寫進 res.locals.tenantId 並 next()", () => {
    const req = { locals: {}, auth: { appMetadata: { tenant_id: "t-123" } } } as any
    const res = mockRes(); const next = vi.fn()
    requireTenant(req, res, next)
    expect(res.locals.tenantId).toBe("t-123")
    expect(next).toHaveBeenCalledOnce()
  })

  it("沒有 tenant_id 時回 403、不 next()", () => {
    const req = { auth: { appMetadata: {} } } as any
    const res = mockRes(); const next = vi.fn()
    requireTenant(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })
})
```

Run: `npm -w @hr/api test tenant`，Expected: FAIL（`requireTenant` 未定義）。

**Step 2: 寫 `auth.ts`** — `requireAuth`：取 `Authorization: Bearer`，`getUserFromToken`，把 `{ userId, email, appMetadata }` 放 `req.auth`；失敗 401。
**Step 3: 寫 `tenant.ts`**：

```typescript
import type { Request, Response, NextFunction } from "express"

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.auth?.appMetadata?.tenant_id
  if (!tenantId) return res.status(403).json({ error: "no_tenant" })
  res.locals.tenantId = tenantId
  next()
}
```

**Step 4: 寫 `role.ts`** — `requireRole(roles: string[])`：查 `employees`（`supabaseAdmin`，帶 `tenant_id = res.locals.tenantId AND user_id = req.auth.userId`），role 不在允許清單回 403。`requirePlatformAdmin = requireRole(['platform_admin'])`。
**Step 5:** Run 測試，Expected: PASS。
**Step 6:** Commit `feat(api): requireAuth/requireTenant/requireRole middleware`。

---

## Task 7: 租戶 onboarding `POST /admin/tenants`（TDD）

**Files:**
- Create: `apps/api/src/routes/admin-tenants.ts`，掛進 `app.ts`
- Test: `apps/api/src/routes/__tests__/admin-tenants.test.ts`
- Reference: `Realreal/apps/api/src/routes/admin-orders.ts`（Zod 驗證 + 狀態處理風格）。

**Step 1: 失敗測試** — `POST /admin/tenants`（platform_admin token）帶 `{ name, adminEmail }`：斷言回 201、回傳 `tenantId`，且 DB 有該 tenant 列、種子了預設 `rule_configs`（內建範本）、建立 HR admin employee（`app_metadata.tenant_id` 已寫入 Supabase Auth user）。非 platform_admin 回 403。Run FAIL。
**Step 2: 實作** route：
- Zod 驗 body。
- `supabaseAdmin` insert `tenants`（branding/features 預設）。
- `supabaseAuth.admin.createUser({ email, app_metadata: { tenant_id } })` → 取 userId。
- insert `employees`（role `hr_admin`, userId, tenantId）。
- 種子 `rule_configs`（P2 會用；此處先塞一筆預設 DSL 範本，scope 全集）。
- 回 `{ tenantId }`。
**Step 3:** Run PASS。
**Step 4:** Commit `feat(api): tenant onboarding endpoint (platform-admin only)`。

---

## Task 8: 白標讀取 `GET /api/tenant/branding`（TDD）

**Files:**
- Create: `apps/api/src/routes/tenant.ts`
- Test: `apps/api/src/routes/__tests__/tenant-branding.test.ts`

**Step 1: 失敗測試** — 已登入該租戶的 user 打 `GET /api/tenant/branding` 回 `{ branding, features }`（取自 `tenants`，經 `requireTenant`）。未帶 tenant → 403。Run FAIL。
**Step 2:** 實作：`requireAuth, requireTenant` 後查 `tenants` by `res.locals.tenantId`，回 `branding`+`features`。
**Step 3:** Run PASS。
**Step 4:** Commit `feat(api): GET /api/tenant/branding for white-label injection`。

---

## Task 9: 跨租戶隔離整合測試（安全關鍵，必過）

**Files:**
- Test: `apps/api/src/__tests__/tenant-isolation.test.ts`

**Step 1: 寫測試** — 種子租戶 A、B 各一名 hr_admin 與一名 employee。
- (a) 用 A 的 admin token 打需 `requireTenant` 的 employees list endpoint，**只**看到 A 的員工，看不到 B。
- (b) **DB 兜底測試**：用 A 使用者的 JWT 直接走 anon Supabase client（非 service_role）`select * from employees`，斷言**只回 A 的列**（證明即使 API 漏帶 where，RLS `current_tenant_id()` 仍擋住 B）。
- (c) A 的 employee（非 hr_admin）讀 B 的 employee → 空集/403。

```typescript
it("RLS 兜底：A 的 JWT 透過 anon client 讀不到 B 的員工", async () => {
  const anonAsA = supabaseAnonWithJwt(tokenA_employee)
  const { data } = await anonAsA.from("employees").select("id, tenant_id")
  expect(data!.every(r => r.tenant_id === tenantA)).toBe(true)
  expect(data!.some(r => r.tenant_id === tenantB)).toBe(false)
})
```

**Step 2:** Run，Expected: PASS（若失敗代表 RLS policy 有洞，**必須先修才能繼續**）。
**Step 3:** Commit `test: cross-tenant isolation (API + RLS double defense)`。

---

## Task 10: `packages/rules` 空殼（P2 才實作引擎）

**Files:**
- Create: `packages/rules/package.json`（`@hr/rules`）、`src/index.ts`、`src/rules-schema.ts`（Zod DSL 型別佔位）、`src/__tests__/placeholder.test.ts`

**Step 1:** 定義 `RuleConfig` Zod schema 骨架（attendance_bonus / overtime / night / payroll 四區，先寬鬆）。
**Step 2:** 一個 placeholder 測試：`parseRuleConfig(validSample)` 不丟錯。Run PASS。
**Step 3:** Commit `feat(rules): package shell + DSL schema placeholder`。

---

## Task 11: `apps/worker` 骨架

**Files:**
- Create: `apps/worker/package.json`（`@hr/worker`）、`src/worker.ts`、`src/lib/queue.ts`
- Reference: 照抄 `Realreal/apps/api/src/worker.ts`（BullMQ + `upsertJobScheduler` + Railway `/health` server），先只註冊一個 no-op `daily-attendance-settle`（`0 2 * * *` Asia/Taipei）佔位。

**Step 1:** 寫 `worker.ts`（health server + 註冊一條佔位 cron）。
**Step 2:** 本地啟動確認 log 印出排程已註冊、`/health` 回 200（需本機 Redis 或 env `REDIS_URL`）。
**Step 3:** Commit `feat(worker): bullmq skeleton + placeholder daily settle cron`。

---

## Task 12: `apps/web` Next.js 骨架 + 白標注入

**Files:**
- Create: `apps/web`（`create-next-app` App Router + Tailwind 4 + shadcn init）
- Modify: `apps/web/src/app/layout.tsx`（載入 branding，注入 CSS 變數）
- Reference: `Realreal/apps/web` 的 layout / lib/api-client 模式。

**Step 1:** scaffold Next.js（App Router、TS、Tailwind），複製 `Realreal/apps/web/src/components/ui/*` 進來。
**Step 2:** `lib/api-client.ts`（fetch wrapper 自動帶 Bearer，base url = `API_URL`）。
**Step 3:** layout 內（伺服器端）打 `GET /api/tenant/branding`，把 `primaryColor` 注入 `<html style="--brand:...">`，`appName` 設 title。先用 hardcoded token/stub 驗證注入生效（真正登入流程在 P1）。
**Step 4:** `npm -w @hr/web run build` 成功。
**Step 5:** Commit `feat(web): next.js skeleton + white-label branding injection`。

---

## P0 完成準則（Definition of Done）

- [ ] `npm run build` 與 `npm test` 全綠（含 Task 9 隔離測試）。
- [ ] 可用 platform_admin 經 API 建立一個租戶 + 第一位 HR admin。
- [ ] 跨租戶隔離測試證明 A 讀不到 B（API 層 + RLS 層）。
- [ ] 白標 branding 能注入 web layout。
- [ ] 設計文件與本計畫已 commit。

完成後接 P1（差勤核心：班別/排班/打卡/簽核/ESS）。
