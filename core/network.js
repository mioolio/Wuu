// =========== 网络与文件名工具 ===========
// fetchWithTimeout: 带超时的 fetch (防止损坏链接挂起, 导致整批下载卡住)
// sanitizeFileName: 清理文件名非法字符
// timeoutMs: 总超时(含下载 body), 默认 60 秒
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// 清理文件名非法字符
// Windows 文件夹/文件名不能以 . 或空格结尾(会被系统自动截断, 导致路径异常)
// 也不能以这些字符开头/包含: \ / : * ? " < > |
function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[.\s]+$/g, '')  // 去除结尾的 . 和空格(Windows 限制)
    .trim() || '_';  // 全空时用 _ 兜底, 避免空名
}

module.exports = { fetchWithTimeout, sanitizeFileName };
