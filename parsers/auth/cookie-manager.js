// =========== Cookie 管理器 ===========
// 移植自 go-music-dl core/service.go CookieManager
// 每个 source 独立存储 cookie (仅内存, 不再持久化)

class CookieManager {
  constructor() {
    this.cookies = {};  // { source: "cookie_string" }
  }

  get(source) {
    return this.cookies[source] || '';
  }

  // 从 Set-Cookie 响应头更新 cookie (供各平台解析器被动捕获)
  updateFromResponse(source, resp) {
    const setCookie = resp.headers.get('set-cookie');
    if (!setCookie) return;
    // 合并 cookie
    const existing = this.get(source);
    const map = this._parseCookieString(existing);
    for (const sc of setCookie.split(/,\s*(?=[A-Za-z]+=)/)) {
      const kv = sc.split(';')[0].trim();
      const eq = kv.indexOf('=');
      if (eq > 0) {
        map.set(kv.slice(0, eq), kv.slice(eq + 1));
      }
    }
    this.cookies[source] = this._stringifyCookieMap(map);
  }

  _parseCookieString(str) {
    const map = new Map();
    if (!str) return map;
    for (const part of str.split(';')) {
      const kv = part.trim();
      const eq = kv.indexOf('=');
      if (eq > 0) map.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
    return map;
  }

  _stringifyCookieMap(map) {
    return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

// 单例
const CM = new CookieManager();
module.exports = CM;
