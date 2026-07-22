import { describe, it, expect } from "vitest"
import { getTableColumns } from "drizzle-orm"
import {
  tenants,
  departments,
  employees,
  projects,
  projectMembers,
  projectShareAdjustments,
  projectDocuments,
} from "../index"

describe("tenants table", () => {
  const cols = getTableColumns(tenants)

  it("has the expected columns", () => {
    expect(Object.keys(cols).sort()).toEqual(
      ["id", "name", "status", "branding", "features", "createdAt"].sort(),
    )
  })
})

describe("departments table", () => {
  const cols = getTableColumns(departments)

  it("has the expected columns", () => {
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "parentId",
        "name",
        "managerEmpId",
      ]),
    )
  })

  it("tenantId is not null", () => {
    expect(cols.tenantId.notNull).toBe(true)
  })
})

describe("projects table", () => {
  const cols = getTableColumns(projects)

  it("has the expected columns", () => {
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "name",
        "code",
        "description",
        "status",
        "deptId",
        "leadEmpId",
        "shareMode",
        "bonusPool",
      ]),
    )
  })

  it("tenantId is not null and shareMode defaults to pool_pct", () => {
    expect(cols.tenantId.notNull).toBe(true)
    expect(cols.shareMode.default).toBe("pool_pct")
  })
})

describe("projectMembers table", () => {
  const cols = getTableColumns(projectMembers)

  it("has the expected columns", () => {
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "projectId",
        "employeeId",
        "roleInProject",
        "sharePct",
        "shareAmount",
      ]),
    )
  })

  it("tenantId is not null", () => {
    expect(cols.tenantId.notNull).toBe(true)
  })
})

describe("projectShareAdjustments table", () => {
  const cols = getTableColumns(projectShareAdjustments)

  it("has the expected columns", () => {
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "projectId",
        "employeeId",
        "field",
        "oldValue",
        "newValue",
        "changedByEmpId",
      ]),
    )
  })
})

describe("projectDocuments table", () => {
  const cols = getTableColumns(projectDocuments)

  it("has the expected columns", () => {
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "projectId",
        "fileName",
        "storagePath",
        "sizeBytes",
        "contentType",
      ]),
    )
  })

  it("tenantId is not null", () => {
    expect(cols.tenantId.notNull).toBe(true)
  })
})

describe("employees table", () => {
  const cols = getTableColumns(employees)

  it("has the expected columns", () => {
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "userId",
        "empNo",
        "name",
        "deptId",
        "employmentType",
        "hireDate",
        "role",
        "status",
      ]),
    )
  })

  it("tenantId is not null", () => {
    expect(cols.tenantId.notNull).toBe(true)
  })
})
