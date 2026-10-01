export const SIDEBAR_COLLAPSED_WIDTH = 56;
export const SIDEBAR_DEFAULT_WIDTH = 184;
export const SIDEBAR_MIN_WIDTH = 152;
export const SIDEBAR_MAX_WIDTH = 260;
const MIN_CONTENT_WIDTH = 480;

export function normalizeSidebarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
    : SIDEBAR_DEFAULT_WIDTH;
}

export function sidebarWidthLimit(workspaceWidth: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.floor(workspaceWidth - MIN_CONTENT_WIDTH)));
}

export function fitSidebarWidth(value: unknown, workspaceWidth: number): number {
  return Math.min(normalizeSidebarWidth(value), sidebarWidthLimit(workspaceWidth));
}
