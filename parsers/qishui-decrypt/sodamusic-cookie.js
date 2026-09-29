const fs = require('fs')
const os = require('os')
const path = require('path')

const COOKIE_DB_PATH = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'SodaMusic',
  'Network',
  'Cookies',
)

function getCookieDbPath() {
  return COOKIE_DB_PATH
}

function isWindowsPlatform() {
  return process.platform === 'win32'
}

// sql.js 实例缓存(避免每次调用都加载 WASM)
let _sqlInstance = null

async function getSqlInstance() {
  if (_sqlInstance) return _sqlInstance
  const initSqlJs = require('sql.js')
  _sqlInstance = await initSqlJs()
  return _sqlInstance
}

async function readSessionIdFromCookieDatabase(databasePath) {
  const SQL = await getSqlInstance()
  const fileBuffer = fs.readFileSync(databasePath)
  const db = new SQL.Database(fileBuffer)

  try {
    const result = db.exec(`
      SELECT name, value, host_key
      FROM cookies
      WHERE host_key IN ('.qishui.com', 'qishui.com')
        AND name = 'sessionid'
      LIMIT 1
    `)

    if (!result || result.length === 0) return ''

    const rows = result[0].values
    if (!rows || rows.length === 0) return ''

    return String(rows[0][1] || '').trim()
  } finally {
    db.close()
  }
}

// 读取汽水音乐客户端所有 qishui.com 的 cookie, 拼成 "name1=value1; name2=value2; ..." 格式
// video_v2 等风控敏感接口需要完整 cookie (passport_csrf_token, ttwid, sid_tt 等), 仅 sessionid 会被风控降级
async function readAllCookiesFromDatabase(databasePath) {
  const SQL = await getSqlInstance()
  const fileBuffer = fs.readFileSync(databasePath)
  const db = new SQL.Database(fileBuffer)

  try {
    const result = db.exec(`
      SELECT name, value, host_key
      FROM cookies
      WHERE host_key IN ('.qishui.com', 'qishui.com', '.douyin.com', 'douyin.com')
    `)

    if (!result || result.length === 0) return ''

    const rows = result[0].values
    if (!rows || rows.length === 0) return ''

    // 拼接成 cookie 字符串, 去重 (同名 cookie 保留第一个)
    const seen = new Set()
    const parts = []
    for (const row of rows) {
      const name = String(row[0] || '').trim()
      const value = String(row[1] || '').trim()
      if (!name || !value || seen.has(name)) continue
      seen.add(name)
      parts.push(name + '=' + value)
    }
    return parts.join('; ')
  } finally {
    db.close()
  }
}

async function getSessionIdFromSodaMusicCookies() {
  if (!isWindowsPlatform()) {
    return {
      supported: false,
      reason: '当前后端非Windows系统，无法使用一键登录',
      cookieDbPath: getCookieDbPath(),
      sessionid: '',
    }
  }

  const cookieDbPath = getCookieDbPath()

  if (!fs.existsSync(cookieDbPath)) {
    return {
      supported: false,
      reason: '请先安装PC端汽水音乐，并完成登录',
      cookieDbPath,
      sessionid: '',
    }
  }

  try {
    const sessionid = await readSessionIdFromCookieDatabase(cookieDbPath)

    if (!sessionid) {
      return {
        supported: false,
        reason: '汽水音乐登录状态获取失败，请确保账号已正常登录',
        cookieDbPath,
        sessionid: '',
        cookie: '',
      }
    }

    // 读取完整 cookie (video_v2 等风控敏感接口需要完整 cookie, 不能只有 sessionid)
    let cookie = ''
    try {
      cookie = await readAllCookiesFromDatabase(cookieDbPath)
    } catch (e) {
      // 读取完整 cookie 失败时回退到只用 sessionid
      cookie = `sessionid=${sessionid};`
    }

    return {
      supported: true,
      reason: '',
      cookieDbPath,
      sessionid,
      cookie,
    }
  } catch (error) {
    const message = String(error?.message || '')

    if (
      message.includes('EBUSY') ||
      message.includes('locked') ||
      message.includes('busy') ||
      message.includes('unable to open database file')
    ) {
      return {
        supported: false,
        reason: '汽水音乐正在运行中，请退出后再使用一键登录',
        cookieDbPath,
        sessionid: '',
      }
    }

    throw error
  }
}

module.exports = {
  getCookieDbPath,
  getSessionIdFromSodaMusicCookies,
  isWindowsPlatform,
  readSessionIdFromCookieDatabase,
  readAllCookiesFromDatabase,
}
