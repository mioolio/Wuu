import { describe, expect, it } from 'vitest';
import { fitSidebarWidth, normalizeSidebarWidth, SIDEBAR_DEFAULT_WIDTH, sidebarWidthLimit } from './sidebarPreferences';

describe('侧栏宽度与内容空间', () => {
  it.each([undefined, null, '210', NaN, Infinity, -Infinity])('无效宽度 %s 使用默认值', value => {
    expect(normalizeSidebarWidth(value)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
  it('保存宽度限制在可用范围，并取整到像素', () => {
    expect(normalizeSidebarWidth(40)).toBe(152);
    expect(normalizeSidebarWidth(400)).toBe(260);
    expect(normalizeSidebarWidth(211.6)).toBe(212);
  });
  it('800 像素窗口仍可完整展开，窄空间优先留下内容宽度', () => {
    expect(fitSidebarWidth(260, 800)).toBe(260);
    expect(sidebarWidthLimit(640)).toBe(160);
    expect(fitSidebarWidth(260, 640)).toBe(160);
    expect(640 - fitSidebarWidth(260, 640)).toBeGreaterThanOrEqual(480);
    expect(sidebarWidthLimit(500)).toBe(152);
  });
  it('窗口变大时恢复保存宽度，不把临时空间限制写入偏好', () => {
    const savedWidth = 240;
    expect(fitSidebarWidth(savedWidth, 640)).toBe(160);
    expect(fitSidebarWidth(savedWidth, 1100)).toBe(240);
  });
});
