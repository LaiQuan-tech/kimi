import { describe, it, expect, vi } from "vitest"
import type { Request, Response, NextFunction } from "express"
import { requireTenant } from "../tenant"

function makeRes() {
  const res = {
    locals: {} as Record<string, unknown>,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res as unknown as Response & {
    statusCode: number
    body: unknown
    locals: Record<string, unknown>
  }
}

describe("requireTenant", () => {
  it("writes tenantId to res.locals and calls next when present", () => {
    const req = {
      auth: { appMetadata: { tenant_id: "tenant-123" } },
    } as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    requireTenant(req, res, next)

    expect(res.locals.tenantId).toBe("tenant-123")
    expect(next).toHaveBeenCalledOnce()
  })

  it("responds 403 and does not call next when tenant_id is missing", () => {
    const req = { auth: { appMetadata: {} } } as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    requireTenant(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: "no_tenant" })
    expect(next).not.toHaveBeenCalled()
    expect(res.locals.tenantId).toBeUndefined()
  })

  it("responds 403 when req.auth is absent entirely", () => {
    const req = {} as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    requireTenant(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})
