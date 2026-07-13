import { describe, it, expect, vi, afterEach } from "vitest"
import type { Request, Response, NextFunction } from "express"
import { requirePlatformOperator } from "../platform"

// The guard is the second element of the composed array (first is requireAuth).
const guard = requirePlatformOperator[1] as (
  req: Request,
  res: Response,
  next: NextFunction,
) => void

function makeRes() {
  const res = {
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
  return res as unknown as Response & { statusCode: number; body: unknown }
}

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS

afterEach(() => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL
})

describe("requirePlatformOperator guard", () => {
  it("calls next when the authed email is on the allow-list (case-insensitive)", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@saas.com, ops@saas.com"
    const req = { auth: { email: "OPS@saas.com" } } as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    guard(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(0)
  })

  it("responds 403 when the authed email is not on the allow-list", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@saas.com"
    const req = { auth: { email: "random@tenant.com" } } as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    guard(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: "not_platform_operator" })
    expect(next).not.toHaveBeenCalled()
  })

  it("responds 403 when the allow-list env var is empty", () => {
    process.env.PLATFORM_ADMIN_EMAILS = ""
    const req = { auth: { email: "anyone@saas.com" } } as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    guard(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it("responds 403 when there is no authenticated email", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@saas.com"
    const req = { auth: { email: null } } as unknown as Request
    const res = makeRes()
    const next = vi.fn() as unknown as NextFunction

    guard(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})
