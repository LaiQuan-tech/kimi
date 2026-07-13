import { describe, it, expect } from "vitest"
import {
  bonusSupplementaryPremium,
  otherIncomeSupplementaryPremium,
  salaryWithholdingFixedRate,
  nonResidentWithholding,
  nhiEmployeePremium,
} from "../tw-tax.js"

describe("二代健保補充保費 — 高額獎金", () => {
  const insured = 40_000 // 門檻 = 4 × 40000 = 160,000

  it("累計未超過 4 倍投保金額 → 0", () => {
    expect(bonusSupplementaryPremium(insured, 0, 100_000)).toBe(0)
    expect(bonusSupplementaryPremium(insured, 100_000, 60_000)).toBe(0) // 累計剛好 160,000
  })

  it("本次跨越門檻 → 只對超過部分計費 (2.11%)", () => {
    // 之前 100,000，本次 100,000 → 累計 200,000，超過門檻 40,000 → 40000*0.0211=844
    expect(bonusSupplementaryPremium(insured, 100_000, 100_000)).toBe(844)
  })

  it("先前已全部超過門檻 → 本次全額計費", () => {
    // 之前 200,000(已超)，本次 50,000 → 全數 50,000 計費 → 1055
    expect(bonusSupplementaryPremium(insured, 200_000, 50_000)).toBe(1055)
  })

  it("零或負獎金 → 0", () => {
    expect(bonusSupplementaryPremium(insured, 0, 0)).toBe(0)
    expect(bonusSupplementaryPremium(insured, 0, -10)).toBe(0)
  })
})

describe("二代健保補充保費 — 其他類所得", () => {
  it("未達單筆門檻 (20,000) → 0", () => {
    expect(otherIncomeSupplementaryPremium(19_999)).toBe(0)
  })
  it("達門檻 → 全額 × 2.11%", () => {
    expect(otherIncomeSupplementaryPremium(20_000)).toBe(422) // 20000*0.0211
    expect(otherIncomeSupplementaryPremium(50_000)).toBe(1055)
  })
})

describe("薪資所得扣繳（定率法）", () => {
  it("未達起扣門檻 → 0", () => {
    expect(salaryWithholdingFixedRate(40_000, { threshold: 88_501 })).toBe(0)
  })
  it("達門檻 → 5% (預設)", () => {
    expect(salaryWithholdingFixedRate(100_000, { threshold: 88_501 })).toBe(5000)
  })
  it("可覆寫費率", () => {
    expect(salaryWithholdingFixedRate(100_000, { rate: 0.06 })).toBe(6000)
  })
})

describe("非居住者扣繳", () => {
  it("薪資預設 18%", () => {
    expect(nonResidentWithholding(100_000)).toBe(18_000)
  })
  it("零/負 → 0", () => {
    expect(nonResidentWithholding(0)).toBe(0)
  })
})

describe("健保費（本人 + 眷屬）", () => {
  const rate = 0.0517
  const share = 0.3

  // 每人 30000 * 0.0517 * 0.3 = 465.3；於總額一次四捨五入（非逐人取整）。
  it("本人無眷屬 → round(465.3) = 465", () => {
    expect(nhiEmployeePremium(30_000, 0, rate, share)).toBe(465)
  })

  it("2 名眷屬 → round(465.3 × 3) = 1396", () => {
    expect(nhiEmployeePremium(30_000, 2, rate, share)).toBe(1396)
  })

  it("眷屬超過 3 口以 3 口封頂 (本人+3 = ×4) → round(465.3 × 4) = 1861", () => {
    expect(nhiEmployeePremium(30_000, 5, rate, share)).toBe(1861)
  })
})
