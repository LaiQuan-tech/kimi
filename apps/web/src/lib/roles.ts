/**
 * 角色常數的單一來源（原本硬編在 AdminGate / ess-api 各處，收斂於此避免不一致）。
 * ADMIN_ROLES = 可進後台 /admin 的角色。專案分潤的「主管可見」另由後端依
 * 專案負責人 / 部門主管動態判定，不靠這個清單。
 */
export const ADMIN_ROLES: readonly string[] = ["hr_admin", "platform_admin"]

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role)
}
