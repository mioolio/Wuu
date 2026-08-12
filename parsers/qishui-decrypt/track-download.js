const { endpoints, fixed } = require('./qishui-auth')
const { TrackDecryptor } = require('./track-decryptor')

// 调试日志开关(与主进程 dbgLog 风格一致, 便于在终端筛选)
function dbgLog(...args) {
  console.log('[QISHUI]', '[track-download]', ...args)
}

function buildUrl(url, query = {}) {
  const target = new URL(url)

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      target.searchParams.set(key, value)
    }
  }

  return target.toString()
}

function getArtistName(trackPayload) {
  const artists = Array.isArray(trackPayload?.track?.artists) ? trackPayload.track.artists : []
  const firstArtist = artists[0]

  return (
    firstArtist?.simple_display_name ||
    firstArtist?.user_info?.nickname ||
    firstArtist?.name ||
    ''
  )
}

function getTrackV2Payload(reqBody) {
  const {
    aid = fixed.aid,
    sessionid,
    track_id,
  } = reqBody || {}

  return {
    aid,
    sessionid,
    track_id,
    media_type: 'track',
    queue_type: 'search_one_track',
    scene_name: 'search',
  }
}

// 从 cookie 字符串中提取指定名称的值
function extractCookieValue(cookieStr, name) {
  if (!cookieStr) return ''
  const m = cookieStr.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : ''
}

// 从 SSR 页面 HTML 中解析 _ROUTER_DATA (复用 qishui.js 逻辑)
function parseRouterDataFromHtml(html) {
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = scriptRe.exec(html)) !== null) {
    const content = m[1]
    if (!content.includes('_ROUTER_DATA')) continue
    const dataMatch = content.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\});/)
    if (dataMatch && dataMatch[1]) {
      try { return JSON.parse(dataMatch[1]) } catch (e) {}
    }
  }
  return null
}

// 通过外部后端获取 track 信息 (第三级回退)
const PARSE_BACKEND = 'http://qiuyu520.fun/qishuiParse/api/track/v2'
async function fetchTrackPayloadFromBackend({ track_id }) {
  dbgLog('fetchTrackPayloadFromBackend 请求: track_id=' + track_id)
  const body = JSON.stringify({
    track_id: String(track_id),
    media_type: 'track',
    queue_type: 'favorite_track_playlist',
    scene_name: 'undefined',
  })
  const resp = await fetch(PARSE_BACKEND, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error('后端请求失败: HTTP ' + resp.status + ' - ' + text.slice(0, 200))
  }
  const json = await resp.json()
  dbgLog('fetchTrackPayloadFromBackend 响应: ok=' + json.ok + ' keys=' + JSON.stringify(Object.keys(json || {})))
  if (!json.ok || !json.data) throw new Error(json.message || '外部后端返回错误')
  const data = json.data
  dbgLog('fetchTrackPayloadFromBackend data keys=' + JSON.stringify(Object.keys(data || {})))
  dbgLog('fetchTrackPayloadFromBackend 成功: url=' + (data.url ? '有' : '无') + ' title=' + (data.title || '') + ' artistName=' + (data.artistName || '') + ' contentType=' + (data.contentType || '未知'))

  // 尝试提取加密信息: 后端可能返回 spade_a 或 playAuth (两者等效, playAuth 可直接作为 spade_a 使用)
  const spadeA = data.spade_a || data.playAuth || (data.encrypt_info && data.encrypt_info.spade_a) || ''
  const encryptInfo = data.encrypt_info || (data.playAuth ? { spade_a: data.playAuth } : null)
  dbgLog('fetchTrackPayloadFromBackend spade_a=' + (spadeA ? '有 (长度=' + spadeA.length + ')' : '无') + ' encryptInfo=' + (encryptInfo ? '有' : '无') + ' playAuth=' + (data.playAuth ? '有 (长度=' + data.playAuth.length + ')' : '无'))

  // 构造兼容 payload
  const payload = {
    track: {
      id: String(track_id),
      name: data.title || '未知歌曲',
      duration: data.duration || 0,
      album: { name: data.album || data.albumName || '', id: '' },
      artists: data.artistName ? [{ simple_display_name: data.artistName }] : [],
      label_info: data.label_info || {},
      bit_rates: data.bit_rates || [],
      status: data.status || 0,
    },
    track_player: {
      video_model: data.url ? JSON.stringify({
        video_list: [{
          video_meta: { quality: data.quality || 'standard', vtype: data.vtype || 'm4a' },
          main_url: data.url,
          encrypt_info: encryptInfo || { spade_a: spadeA },
        }],
      }) : '',
      lyrics: data.lyrics || null,
    },
    __fromBackend: true,
    __directMainUrl: data.url || '',
    __directContentType: data.contentType || 'audio/mp4',
    __spadeA: spadeA,
    __encryptInfo: encryptInfo,
  }
  return payload
}

// 从 HTML 中查找 SSR 数据 (支持多种变量名)
function findSSRDataInHtml(html) {
  // 可能的 SSR 数据变量名
  const patterns = [
    { name: '_ROUTER_DATA', regex: /_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*[;\n]|_ROUTER_DATA\s*=\s*(\[[\s\S]*?\])\s*[;\n]/ },
    { name: '__INITIAL_STATE__', regex: /__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/ },
    { name: '__NEXT_DATA__', regex: /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/ },
    { name: '__SERVER_DATA__', regex: /__SERVER_DATA__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/ },
    { name: '__SSR_DATA__', regex: /__SSR_DATA__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/ },
    { name: '__NUXT__', regex: /__NUXT__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/ },
    { name: 'window.__DATA__', regex: /window\.__DATA__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/ },
    { name: 'window.__TRACK_DATA__', regex: /window\.__TRACK_DATA__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/ },
    { name: 'audioWithLyricsOption', regex: /"audioWithLyricsOption"\s*:\s*(\{[\s\S]*?\})\s*[,}]/ },
    { name: 'audioOpt', regex: /"audioOpt"\s*:\s*(\{[\s\S]*?\})\s*[,}]/ },
    { name: 'trackInfo', regex: /"trackInfo"\s*:\s*(\{[\s\S]*?\})\s*[,}]/ },
  ]

  // 先尝试精确匹配的脚本块
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let m
  const foundScripts = []
  while ((m = scriptRe.exec(html)) !== null) {
    const content = m[1]
    if (content.trim().length > 50) foundScripts.push(content.trim())
  }
  dbgLog('findSSRDataInHtml 找到 ' + foundScripts.length + ' 个脚本块, 总字符数=' + html.length)
  if (foundScripts.length > 0) {
    dbgLog('findSSRDataInHtml 第一个脚本块前200字符: ' + foundScripts[0].slice(0, 200))
  }

  // 尝试每个模式
  for (const pat of patterns) {
    // 先在脚本块中搜索
    for (const script of foundScripts) {
      const match = script.match(pat.regex)
      if (match) {
        const jsonStr = (match[1] || match[2] || '').trim()
        if (jsonStr) {
          try {
            const data = JSON.parse(jsonStr)
            dbgLog('findSSRDataInHtml 成功匹配 ' + pat.name + ' (脚本块中)')
            return { source: pat.name, data }
          } catch (e) {
            // 可能 JSON 被截断, 尝试在全文中搜索
          }
        }
      }
    }
    // 再在全文中搜索
    const match2 = html.match(pat.regex)
    if (match2) {
      const jsonStr = (match2[1] || match2[2] || '').trim()
      if (jsonStr) {
        try {
          const data = JSON.parse(jsonStr)
          dbgLog('findSSRDataInHtml 成功匹配 ' + pat.name + ' (全文中)')
          return { source: pat.name, data }
        } catch (e) {
          dbgLog('findSSRDataInHtml 匹配 ' + pat.name + ' 但 JSON 解析失败: ' + e.message + ' 前100字符=' + jsonStr.slice(0, 100))
        }
      }
    }
  }

  // 最后尝试: 搜索任何包含 track_id 或 trackName 的 JSON 对象
  const trackIdMatch = html.match(/"track_id"\s*:\s*"?(\d+)"?/)
  const trackNameMatch = html.match(/"trackName"\s*:\s*"([^"]+)"/)
  const audioUrlMatch = html.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/)
  if (trackNameMatch) {
    dbgLog('findSSRDataInHtml 找到 trackName=' + trackNameMatch[1])
  }
  if (audioUrlMatch) {
    dbgLog('findSSRDataInHtml 找到 audio url=' + audioUrlMatch[1].slice(0, 80))
  }

  return null
}

// 通过分享页 SSR 获取 track 信息 (不依赖风控敏感的 track_v2 API)
// 关键: music.douyin.com 的 SSR 接口不需要 cookie/签名, 直接返回 JSON 数据
async function fetchTrackPayloadFromSSR({ track_id }) {
  // 优先级: music.douyin.com (直接返回 JSON) > qishui.com (SPA shell, 已不可用)
  const urls = [
    {
      // 首选: music.douyin.com SSR 接口, 与视频 SSR 接口同源, 稳定可靠
      url: `https://music.douyin.com/qishui/share/track?__loader=track_page&__ssrDirect=true&track_id=${track_id}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/html',
        'Referer': 'https://www.qishui.com/',
      },
      label: 'music.douyin.com/share/track',
    },
    {
      // 备选: 使用 id 参数
      url: `https://music.douyin.com/qishui/share/track?__loader=track_page&__ssrDirect=true&id=${track_id}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/html',
        'Referer': 'https://www.qishui.com/',
      },
      label: 'music.douyin.com/share/track?id=',
    },
    {
      // 备选: 不带 __loader 参数
      url: `https://music.douyin.com/qishui/share/track?__ssrDirect=true&track_id=${track_id}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/html',
        'Referer': 'https://www.qishui.com/',
      },
      label: 'music.douyin.com/share/track(no_loader)',
    },
    {
      // 备选: qishui.com 分享页 (新版返回 SPA shell, 通常无数据, 但仍尝试)
      url: `https://www.qishui.com/track/${track_id}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.qishui.com/',
      },
      label: 'qishui.com/track/{id}',
    },
  ]

  let lastError = null

  for (const { url, headers, label } of urls) {
    dbgLog('fetchTrackPayloadFromSSR 尝试: ' + label + ' url=' + url)
    try {
      const resp = await fetch(url, { method: 'GET', headers })
      const text = await resp.text()
      const ct = resp.headers.get('content-type') || 'unknown'
      dbgLog('fetchTrackPayloadFromSSR [' + label + '] HTTP=' + resp.status + ' len=' + text.length + ' contentType=' + ct)

      if (!resp.ok) {
        lastError = new Error('HTTP ' + resp.status)
        continue
      }

      // 统一尝试 JSON 解析 (无论 content-type, 因为 SSR 可能返回 text/html 但内容是 JSON)
      // 方法1: 直接 JSON 解析 (适用于 music.douyin.com 返回的纯 JSON)
      try {
        const json = JSON.parse(text)
        dbgLog('fetchTrackPayloadFromSSR [' + label + '] JSON keys=' + JSON.stringify(Object.keys(json || {})))

        // 尝试多种提取策略
        const extracted = extractTrackDataFromJSON(json)
        if (extracted) {
          dbgLog('fetchTrackPayloadFromSSR [' + label + '] JSON 提取成功: title=' + extracted.title + ' url=' + (extracted.url ? '有' : '无'))
          return buildTrackPayloadFromExtracted(extracted)
        }

        // 特殊处理: music.douyin.com 可能返回 { trackOptions: {...} } 格式
        if (json.trackOptions && json.trackOptions.url) {
          const to = json.trackOptions
          dbgLog('fetchTrackPayloadFromSSR [' + label + '] 从 trackOptions 提取成功')
          return buildTrackPayloadFromExtracted({
            title: to.trackName || to.title || '未知歌曲',
            artist: to.artistName || to.artist || '未知歌手',
            album: to.albumName || to.album || '',
            duration: parseInt(to.duration || '0'),
            trackId: String(to.trackId || to.track_id || track_id),
            url: to.url,
            spadeA: (to.encrypt_info && to.encrypt_info.spade_a) || to.spade_a || to.playAuth || json.playAuth || '',
          })
        }

        // 特殊处理: { data: { track: {...} } } 格式
        if (json.data?.track) {
          const t = json.data.track
          const url = t.track_player?.video_model?.video_list?.[0]?.main_url || t.audio_url || ''
          if (url) {
            dbgLog('fetchTrackPayloadFromSSR [' + label + '] 从 data.track 提取成功')
            return buildTrackPayloadFromExtracted({
              title: t.name || '未知歌曲',
              artist: t.artists?.[0]?.simple_display_name || '未知歌手',
              album: t.album?.name || '',
              duration: t.duration || 0,
              trackId: String(t.id || track_id),
              url,
              spadeA: t.track_player?.video_model?.video_list?.[0]?.encrypt_info?.spade_a || t.playAuth || json.playAuth || '',
            })
          }
        }

        dbgLog('fetchTrackPayloadFromSSR [' + label + '] JSON 解析成功但未找到音频数据')
        lastError = new Error('JSON 响应中未找到音频数据')
        continue
      } catch (jsonErr) {
        // 不是 JSON, 继续尝试 HTML 解析
        dbgLog('fetchTrackPayloadFromSSR [' + label + '] 非 JSON 响应, 尝试 HTML 解析')
      }

      // 方法2: 从 HTML 中查找 SSR 数据
      const ssrData = findSSRDataInHtml(text)
      if (ssrData) {
        dbgLog('fetchTrackPayloadFromSSR [' + label + '] SSR 数据来源=' + ssrData.source)
        const extracted = extractTrackDataFromSSR(ssrData.data)
        if (extracted) {
          dbgLog('fetchTrackPayloadFromSSR [' + label + '] SSR 提取成功')
          return buildTrackPayloadFromExtracted(extracted)
        }
      }

      // 方法3: 正则提取 (兜底方案)
      const trackNameMatch = text.match(/"trackName"\s*:\s*"([^"]+)"/)
      const audioUrlMatch = text.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/)
      if (trackNameMatch && audioUrlMatch) {
        dbgLog('fetchTrackPayloadFromSSR [' + label + '] 正则提取成功: trackName=' + trackNameMatch[1])
        return buildTrackPayloadFromExtracted({
          title: trackNameMatch[1],
          artist: text.match(/"artistName"\s*:\s*"([^"]+)"/)?.[1] || '未知歌手',
          album: text.match(/"albumName"\s*:\s*"([^"]+)"/)?.[1] || '',
          duration: parseInt(text.match(/"duration"\s*:\s*(\d+)/)?.[1] || '0'),
          trackId: text.match(/"track_id"\s*:\s*"?(\d+)"?/)?.[1] || track_id,
          url: audioUrlMatch[1],
        })
      }

      lastError = new Error('未找到可解析的 SSR 数据')
    } catch (e) {
      dbgLog('fetchTrackPayloadFromSSR [' + label + '] 异常: ' + e.message)
      lastError = e
    }
  }

  throw lastError || new Error('所有 SSR URL 均失败')
}

// 从 SSR/JSON 数据中提取音频信息
function extractTrackDataFromSSR(data) {
  // 尝试多种数据结构
  const candidates = [
    data?.loaderData?.track_page?.audioWithLyricsOption,
    data?.loaderData?.track_page?.audioOpt,
    data?.data?.track_page?.audioWithLyricsOption,
    data?.data?.trackPage?.audioWithLyricsOption,
    data?.audioWithLyricsOption,
    data?.audioOpt,
    data?.track,
  ]

  for (const opt of candidates) {
    if (opt && (opt.url || opt.trackName || opt.title)) {
      const trackId = data?.loaderData?.track_page?.track_id || data?.data?.track_page?.track_id || data?.track_id || opt.id || ''
      const duration = opt.duration || (opt.trackInfo && opt.trackInfo.duration) || 0
      const albumName = (opt.trackInfo && opt.trackInfo.album && opt.trackInfo.album.name) || ''
      return {
        title: opt.trackName || opt.title || opt.name || '未知歌曲',
        artist: opt.artistName || opt.artist || opt.artist_name || '未知歌手',
        album: albumName,
        duration,
        trackId: String(trackId),
        url: opt.url || opt.audioUrl || '',
        spadeA: (opt.encrypt_info && opt.encrypt_info.spade_a) || opt.spade_a || opt.playAuth || data?.playAuth || '',
      }
    }
  }

  // 尝试 video_list 结构
  const videoList = data?.track_player?.video_model || data?.video_model
  if (videoList) {
    let vm = videoList
    if (typeof vm === 'string') { try { vm = JSON.parse(vm) } catch (e) {} }
    if (Array.isArray(vm?.video_list)) {
      const first = vm.video_list.find(v => v?.main_url)
      if (first) {
        return {
          title: data?.track?.name || '未知歌曲',
          artist: getArtistNameFromTrack(data?.track) || '未知歌手',
          album: data?.track?.album?.name || '',
          duration: data?.track?.duration || 0,
          trackId: String(data?.track?.id || ''),
          url: first.main_url,
          spadeA: first?.encrypt_info?.spade_a || data?.playAuth || first?.playAuth || '',
        }
      }
    }
  }

  return null
}

// 从 JSON 响应中提取数据
function extractTrackDataFromJSON(json) {
  if (!json) return null

  // 可能的 JSON结构 (按优先级排序)
  const candidates = [
    json?.trackOptions,      // music.douyin.com SSR 返回 { trackOptions: {...} }
    json?.audioOptions,      // 类似 videoOptions 的音频格式
    json?.data?.track,       // { data: { track: {...} } }
    json?.data,              // { data: { ... } }
    json?.track,             // { track: {...} }
    json?.track_page,        // { track_page: {...} }
    json?.trackPage,         // { trackPage: {...} }
    json?.loaderData?.track_page, // { loaderData: { track_page: {...} } }
    json?.result,            // { result: {...} }
  ]

  for (const c of candidates) {
    if (!c) continue
    if (c?.audioWithLyricsOption || c?.audioOpt || c?.url || c?.trackName || c?.title) {
      // 这是一个包含音频信息的对象
      const opt = c.audioWithLyricsOption || c.audioOpt || c
      if (opt) {
        return {
          title: opt.trackName || opt.title || opt.name || c.title || c.name || '未知歌曲',
          artist: opt.artistName || opt.artist || c.artistName || c.artist || '未知歌手',
          album: (opt.trackInfo && opt.trackInfo.album && opt.trackInfo.album.name) || c.album_name || c.album || '',
          duration: opt.duration || (opt.trackInfo && opt.trackInfo.duration) || c.duration || 0,
          trackId: String(c.track_id || opt.id || c.id || ''),
          url: opt.url || c.url || opt.audioUrl || '',
          spadeA: (opt.encrypt_info && opt.encrypt_info.spade_a) || opt.spade_a || c.spade_a || opt.playAuth || c.playAuth || '',
        }
      }
    }

    // 如果有 video_list
    if (c?.video_model || c?.track_player?.video_model) {
      const vm = c?.video_model || c?.track_player?.video_model
      let parsed = vm
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch (e) {} }
      if (Array.isArray(parsed?.video_list)) {
        const first = parsed.video_list.find(v => v?.main_url)
        if (first) {
          return {
            title: c?.track?.name || c?.name || '未知歌曲',
            artist: getArtistNameFromTrack(c?.track) || '未知歌手',
            album: c?.track?.album?.name || '',
            duration: c?.track?.duration || 0,
            trackId: String(c?.track?.id || ''),
            url: first.main_url,
            spadeA: first?.encrypt_info?.spade_a || c?.playAuth || first?.playAuth || '',
          }
        }
      }
    }
  }

  return null
}

// 从 track 数据获取艺人名
function getArtistNameFromTrack(track) {
  const artists = Array.isArray(track?.artists) ? track.artists : []
  const first = artists[0]
  return first?.simple_display_name || first?.user_info?.nickname || first?.name || ''
}

// 构建最终的 track payload
function buildTrackPayloadFromExtracted(extracted) {
  const payload = {
    track: {
      id: extracted.trackId || '',
      name: extracted.title,
      duration: extracted.duration || 0,
      album: { name: extracted.album || '', id: '' },
      artists: extracted.artist ? [{ simple_display_name: extracted.artist }] : [],
      label_info: {},
      bit_rates: [],
      status: 0,
    },
    track_player: {
      video_model: extracted.url ? JSON.stringify({
        video_list: [{
          video_meta: { quality: 'standard', vtype: 'm4a' },
          main_url: extracted.url,
          encrypt_info: { spade_a: extracted.spadeA || '' },
        }],
      }) : '',
    },
    __fromSSR: true,
    __directMainUrl: extracted.url,
    __directContentType: 'audio/mp4',
    __spadeA: extracted.spadeA || '',
    __encryptInfo: extracted.spadeA ? { spade_a: extracted.spadeA } : null,
  }
  dbgLog('buildTrackPayloadFromExtracted: title=' + extracted.title + ' url=' + (extracted.url ? '有' : '无') + ' spadeA=' + (extracted.spadeA ? '有 (长度=' + extracted.spadeA.length + ')' : '无'))
  return payload
}

// 三级回退链: SSR 页面 → 外部后端
async function tryTrackPayloadFallback(track_id, reason) {
  dbgLog('tryTrackPayloadFallback 开始: track_id=' + track_id + ' reason=' + reason)

  // 第一级: SSR 页面解析
  try {
    const ssrPayload = await fetchTrackPayloadFromSSR({ track_id: String(track_id) })
    if (ssrPayload && ssrPayload.__directMainUrl) {
      dbgLog('tryTrackPayloadFallback SSR 回退成功')
      return ssrPayload
    }
    dbgLog('tryTrackPayloadFallback SSR 返回无 directMainUrl, 继续后端回退')
  } catch (ssrErr) {
    dbgLog('tryTrackPayloadFallback SSR 回退失败: ' + ssrErr.message)
  }

  // 第二级: 外部后端
  try {
    const backendPayload = await fetchTrackPayloadFromBackend({ track_id: String(track_id) })
    if (backendPayload && backendPayload.__directMainUrl) {
      dbgLog('tryTrackPayloadFallback 外部后端回退成功')
      return backendPayload
    }
    dbgLog('tryTrackPayloadFallback 外部后端返回无 directMainUrl')
  } catch (beErr) {
    dbgLog('tryTrackPayloadFallback 外部后端回退失败: ' + beErr.message)
  }

  dbgLog('tryTrackPayloadFallback 所有回退均失败')
  return null
}

async function fetchTrackPayload({ aid = fixed.aid, sessionid, track_id, mediaType = 'track', cookie }) {
  // 加入完整 query 参数(对齐其他汽水数据端点), aid 在 query, sessionid 在 Cookie + body
  const trackV2Url = buildUrl(endpoints.trackV2, {
    aid,
    iid: fixed.iid,
    version_code: fixed.version_code,
    region: fixed.region,
    geo_region: fixed.geo_region,
    os_region: fixed.os_region,
  })
  dbgLog('fetchTrackPayload 请求: track_id=' + track_id + ' media_type=' + mediaType + ' aid=' + aid + ' url=' + trackV2Url)
  dbgLog('fetchTrackPayload sessionid 长度=' + (sessionid ? sessionid.length : 0) + ' 前8字符=' + (sessionid ? sessionid.slice(0, 8) : '(空)'))
  const cookieHeader = cookie || `sessionid=${sessionid};`
  dbgLog('fetchTrackPayload cookie 长度=' + cookieHeader.length)

  // 从 cookie 提取 CSRF token 并添加到请求头 (新版风控要求)
  const csrfToken = extractCookieValue(cookieHeader, 'passport_csrf_token')
  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.qishui.com/',
    'Origin': 'https://www.qishui.com',
  }
  if (csrfToken) {
    headers['x-passport-csrf-token'] = csrfToken
    headers['x-csrf-token'] = csrfToken
    dbgLog('fetchTrackPayload CSRF token=' + csrfToken.slice(0, 8) + '...')
  }

  const trackV2Response = await fetch(trackV2Url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      aid,
      sessionid,
      track_id,
      media_type: mediaType,
      queue_type: 'search_one_track',
      scene_name: 'search',
    }),
  })

  // 先读取文本再解析, 避免 .json() 在空响应时抛 "Unexpected end of JSON input"
  const respText = await trackV2Response.text()

  // 诊断日志: 输出响应头, 便于排查空响应/重定向问题
  if (!respText || !respText.trim()) {
    const responseHeaders = {}
    try {
      for (const [key, value] of trackV2Response.headers) {
        if (['content-type', 'content-length', 'location', 'set-cookie', 'server', 'x-cache', 'x-response-cache'].includes(key.toLowerCase())) {
          responseHeaders[key] = value.length > 200 ? value.slice(0, 200) + '...' : value
        }
      }
    } catch (e) {}
    dbgLog('fetchTrackPayload 空响应诊断: HTTP=' + trackV2Response.status + ' headers=' + JSON.stringify(responseHeaders))
    dbgLog('fetchTrackPayload 响应体为空 (HTTP ' + trackV2Response.status + '), 可能被风控拦截, 尝试三级回退')

    // 三级回退链: SSR → 外部后端 → 抛出错误
    const fallbackPayload = await tryTrackPayloadFallback(track_id, '空响应')
    if (fallbackPayload) return fallbackPayload

    const error = new Error('汽水音乐 track_v2 返回空响应 (HTTP ' + trackV2Response.status + '), 可能被风控拦截, 请稍后重试 [track_id=' + track_id + ']')
    error.status = trackV2Response.status
    throw error
  }

  let trackPayload
  try {
    trackPayload = JSON.parse(respText)
  } catch (e) {
    dbgLog('fetchTrackPayload JSON 解析失败: ' + e.message + ' 响应前500字符=' + respText.slice(0, 500))
    const error = new Error('汽水音乐 track_v2 返回非 JSON 响应: ' + respText.slice(0, 200) + ' [track_id=' + track_id + ']')
    error.status = trackV2Response.status
    throw error
  }

  // 详细日志: 输出 HTTP 状态和响应结构, 便于排查"无可用音频"问题
  dbgLog('fetchTrackPayload HTTP status=' + trackV2Response.status)
  dbgLog('fetchTrackPayload respKeys=' + JSON.stringify(Object.keys(trackPayload || {})))
  // 输出完整响应(最多 2000 字符), 便于排查 status_code/status_info 错误
  dbgLog('fetchTrackPayload 完整响应=' + JSON.stringify(trackPayload, null, 2).slice(0, 2000))

  // 检测错误响应: 如果只有 status_code/status_info 而没有 track 数据, 说明请求失败
  if (trackPayload && trackPayload.status_code && !trackPayload.track && !trackPayload.track_player) {
    const statusInfo = trackPayload.status_info || {}
    dbgLog('fetchTrackPayload 错误: status_code=' + trackPayload.status_code + ' status_info=' + JSON.stringify(statusInfo) + ' 尝试三级回退')

    // 三级回退链: SSR → 外部后端 → 抛出错误
    const fallbackPayload = await tryTrackPayloadFallback(track_id, 'status_code=' + trackPayload.status_code)
    if (fallbackPayload) return fallbackPayload

    const errMsg = (statusInfo.message || statusInfo.error || `汽水音乐 API 返回错误 (status_code=${trackPayload.status_code})`) +
      ` [track_id=${track_id}]`
    const error = new Error(errMsg)
    error.status = trackV2Response.status
    error.payload = trackPayload
    throw error
  }

  if (!trackV2Response.ok) {
    dbgLog('fetchTrackPayload 失败响应=' + JSON.stringify(trackPayload, null, 2))
    // HTTP 错误也尝试回退
    const fallbackPayload = await tryTrackPayloadFallback(track_id, 'HTTP ' + trackV2Response.status)
    if (fallbackPayload) return fallbackPayload
    const error = new Error(trackPayload?.error || trackPayload?.message || `获取音频信息失败 (HTTP ${trackV2Response.status})`)
    error.status = trackV2Response.status
    error.payload = trackPayload
    throw error
  }

  // 输出 track_player 结构, 排查 video_model 是否存在
  const trackPlayer = trackPayload?.track_player || {}
  dbgLog('fetchTrackPayload track_player keys=' + JSON.stringify(Object.keys(trackPlayer)))
  dbgLog('fetchTrackPayload has video_model=' + !!trackPlayer.video_model + ' has lyrics=' + !!trackPlayer.lyrics)

  // 输出 track 的关键信息 (label_info, bit_rates, status), 用于判断 VIP/下架状态
  const track = trackPayload?.track || {}
  dbgLog('fetchTrackPayload track.name="' + (track.name || '') + '" id=' + track.id + ' status=' + track.status)
  dbgLog('fetchTrackPayload track.label_info=' + JSON.stringify(track.label_info || {}))
  dbgLog('fetchTrackPayload track.bit_rates=' + JSON.stringify(track.bit_rates || []))

  return trackPayload
}

// 抖音视频资源: 通过汽水音乐分享页 SSR 接口获取视频直链
// 关键发现: music.douyin.com 的 SSR 接口不需要 cookie/签名, 直接返回 douyinvod.com 直链
// 接口: GET https://music.douyin.com/qishui/share/ugc_video?__loader=ugc_video_page&__ssrDirect=true&ugc_video_id={video_id}
// 返回 JSON: { videoOptions: { url, duration, artistName, videoName, coverURL, width, height } }
async function fetchVideoPayloadFromSSR({ video_id }) {
  const ssrUrl = `https://music.douyin.com/qishui/share/ugc_video?__loader=ugc_video_page&__ssrDirect=true&ugc_video_id=${video_id}`
  dbgLog('fetchVideoPayloadFromSSR 请求: video_id=' + video_id + ' url=' + ssrUrl)
  try {
    const resp = await fetch(ssrUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/html',
      },
    })
    const text = await resp.text()
    dbgLog('fetchVideoPayloadFromSSR HTTP=' + resp.status + ' contentLength=' + text.length + ' contentType=' + resp.headers.get('content-type'))
    // SSR 接口返回 JSON, 但 content-type 可能是 text/html, 用 try/catch 解析
    let json
    try {
      json = JSON.parse(text)
    } catch (e) {
      // 如果不是 JSON, 可能是 HTML 页面, 尝试从 HTML 中提取 __NEXT_DATA__ 或 window._SSR_DATA
      dbgLog('fetchVideoPayloadFromSSR 响应不是 JSON, 尝试从 HTML 提取 SSR 数据')
      const match = text.match(/window\._SSR_DATA\s*=\s*({[\s\S]*?})\s*<\/script>/)
      if (match) {
        try { json = JSON.parse(match[1]) } catch (e2) {
          dbgLog('fetchVideoPayloadFromSSR 解析 _SSR_DATA 失败: ' + e2.message)
        }
      }
      if (!json) {
        throw new Error('SSR 响应不是 JSON 且未找到 _SSR_DATA')
      }
    }
    const videoOptions = json?.videoOptions || json?.video?.videoOptions
    if (!videoOptions?.url) {
      dbgLog('fetchVideoPayloadFromSSR 响应缺少 videoOptions.url, keys=' + JSON.stringify(Object.keys(json || {})))
      throw new Error('SSR 响应缺少 videoOptions.url')
    }
    dbgLog('fetchVideoPayloadFromSSR 成功: url=' + videoOptions.url.slice(0, 100) + '... duration=' + videoOptions.duration + ' artist=' + videoOptions.artistName)
    // 转换为统一的 payload 格式, 让 downloadTrackMedia 后续逻辑能复用
    return {
      __fromSSR: true,
      video: {
        title: videoOptions.videoName,
        duration: Math.round((videoOptions.duration || 0) * 1000),
        cover_url: { urls: [videoOptions.coverURL || ''] },
        artists: videoOptions.artistName ? [{ user_info: { nickname: videoOptions.artistName } }] : [],
        width: videoOptions.width,
        height: videoOptions.height,
      },
      // 直接提供 main_url, 跳过 video_model 解析逻辑
      __directMainUrl: videoOptions.url,
      __directContentType: 'video/mp4',
    }
  } catch (e) {
    dbgLog('fetchVideoPayloadFromSSR 失败: ' + e.message)
    throw e
  }
}

// 抖音视频资源: 优先用 SSR 接口获取视频直链, 失败则回退到 video_v2/track_v2 端点
// 真正视频类型的响应结构: { video, player_infos: [{ video_model, ... }] }
// UGC 创作的响应结构: { track, track_player: { video_model, ... } }
// video_v2 是风控敏感接口, 必须用完整 cookie (含 passport_csrf_token, ttwid 等), 仅 sessionid 会被风控降级返回空数据
async function fetchVideoPayload({ aid = fixed.aid, sessionid, video_id, vid, cookie }) {
  // 优先尝试 SSR 接口 (无需 cookie/签名, 对所有用户可用)
  try {
    const ssrResult = await fetchVideoPayloadFromSSR({ video_id })
    if (ssrResult) {
      dbgLog('fetchVideoPayload SSR 接口成功, 跳过 video_v2/track_v2 尝试')
      return ssrResult
    }
  } catch (e) {
    dbgLog('fetchVideoPayload SSR 接口失败, 回退到 video_v2/track_v2: ' + e.message)
  }

  const commonQuery = {
    aid,
    iid: fixed.iid,
    version_code: fixed.version_code,
    region: fixed.region,
    geo_region: fixed.geo_region,
    os_region: fixed.os_region,
  }
  const trackV2Url = buildUrl(endpoints.trackV2, commonQuery)
  const videoV2Url = buildUrl(endpoints.videoV2, commonQuery)
  // 优先用完整 cookie (含 passport_csrf_token 等), 没有则回退到只用 sessionid
  const cookieHeader = cookie || `sessionid=${sessionid};`
  dbgLog('fetchVideoPayload 请求: video_id=' + video_id + ' vid=' + (vid || '(无)') + ' aid=' + aid + ' cookie长度=' + cookieHeader.length)

  // video_id 是数字字符串(如 "7658326053748240249"), vid 是字符串格式(如 "v1e00fgi0000...")
  const idNum = video_id // 数字字符串
  const idStr = vid || video_id // 优先用 vid 字符串格式

  // 同时尝试 track_v2 和 video_v2 端点 + 多种请求体格式
  // 格式2 (track_v2 + track_id + media_type=video) 返回了骨架响应 (risk_result + expire_at 但无 video),
  // 说明请求被风控接受但响应被简化, 需要添加更多字段 (player_type, video_format_list 等) 才能拿到完整数据
  const variants = [
    // === track_v2 端点 + 扩展字段 (基于格式2 骨架响应, 添加更多字段触发完整响应) ===
    // 格式1: track_v2 + track_id + media_type=video + player_type=h5 (PC 客户端常用)
    { url: trackV2Url, label: 'track_v2+track_id+video+player_h5', body: { aid, sessionid, track_id: idNum, media_type: 'video', player_type: 'h5', queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式2: track_v2 + track_id + media_type=video + player_type=pc
    { url: trackV2Url, label: 'track_v2+track_id+video+player_pc', body: { aid, sessionid, track_id: idNum, media_type: 'video', player_type: 'pc', queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式3: track_v2 + track_id + media_type=video + video_format_list
    { url: trackV2Url, label: 'track_v2+track_id+video+fmt_list', body: { aid, sessionid, track_id: idNum, media_type: 'video', video_format_list: ['mp4'], queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式4: track_v2 + track_id + media_type=video + need_render
    { url: trackV2Url, label: 'track_v2+track_id+video+render', body: { aid, sessionid, track_id: idNum, media_type: 'video', need_render: true, queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式5: track_v2 + track_id + media_type=video, 不带 scene_name/queue_type (避免被简化)
    { url: trackV2Url, label: 'track_v2+track_id+video+noscene', body: { aid, sessionid, track_id: idNum, media_type: 'video' } },
    // 格式6: track_v2 + track_id + media_type=video, scene_name=play
    { url: trackV2Url, label: 'track_v2+track_id+video+scene_play', body: { aid, sessionid, track_id: idNum, media_type: 'video', queue_type: 'search_one_track', scene_name: 'play' } },
    // 格式7: track_v2 + track_id + media_type=video, scene_name=collection
    { url: trackV2Url, label: 'track_v2+track_id+video+scene_coll', body: { aid, sessionid, track_id: idNum, media_type: 'video', queue_type: 'search_one_track', scene_name: 'collection' } },
    // 格式8: track_v2 + track_id + media_type=video + 多字段组合
    { url: trackV2Url, label: 'track_v2+track_id+video+combo', body: { aid, sessionid, track_id: idNum, media_type: 'video', player_type: 'h5', video_format_list: ['mp4'], need_render: true, migrate_priority: 0, force_format: 0, queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式9: 原格式2 (作为基线对比)
    { url: trackV2Url, label: 'track_v2+track_id+video+baseline', body: { aid, sessionid, track_id: idNum, media_type: 'video', queue_type: 'search_one_track', scene_name: 'search' } },

    // === video_v2 端点 + 扩展字段 ===
    // 格式10: video_v2 + video_id + media_type=video + player_type
    { url: videoV2Url, label: 'video_v2+video_id+video+player_h5', body: { aid, sessionid, video_id: idNum, media_type: 'video', player_type: 'h5', queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式11: video_v2 + vid + media_type=video + player_type
    { url: videoV2Url, label: 'video_v2+vid+video+player_h5', body: { aid, sessionid, vid: idStr, media_type: 'video', player_type: 'h5', queue_type: 'search_one_track', scene_name: 'search' } },
    // 格式12: video_v2 + video_id + media_type=video + 多字段组合
    { url: videoV2Url, label: 'video_v2+video_id+video+combo', body: { aid, sessionid, video_id: idNum, media_type: 'video', player_type: 'h5', video_format_list: ['mp4'], need_render: true, queue_type: 'search_one_track', scene_name: 'search' } },
  ]

  let lastError = null
  let videoPayload = null

  // 从 cookie 提取 CSRF token (风控敏感接口需要)
  const csrfToken = extractCookieValue(cookieHeader, 'passport_csrf_token')

  for (let i = 0; i < variants.length; i++) {
    const { url, label, body } = variants[i]
    dbgLog('fetchVideoPayload 尝试格式 #' + (i + 1) + ' (' + label + '): ' + JSON.stringify(body))
    try {
      const headers = {
        Cookie: cookieHeader,
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.qishui.com/',
        'Origin': 'https://www.qishui.com',
      }
      if (csrfToken) {
        headers['x-passport-csrf-token'] = csrfToken
        headers['x-csrf-token'] = csrfToken
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const json = await resp.json()
      dbgLog('fetchVideoPayload 格式 #' + (i + 1) + ' (' + label + ') HTTP=' + resp.status + ' respKeys=' + JSON.stringify(Object.keys(json || {})) + ' 完整响应=' + JSON.stringify(json, null, 2).slice(0, 1200))

      // 检测成功响应: 真正视频有 video + player_infos; UGC 创作有 track + track_player
      const hasVideo = json && json.video && !json.status_code
      const hasTrackPlayer = json && json.track_player && !json.status_code
      const hasTrack = json && json.track && !json.status_code
      if (hasVideo || hasTrackPlayer || hasTrack) {
        videoPayload = json
        dbgLog('fetchVideoPayload 格式 #' + (i + 1) + ' (' + label + ') 成功' + (hasVideo ? ' (真正视频类型)' : ' (UGC 创作类型)'))
        break
      }

      // 记录错误, 继续尝试下一种格式
      const statusInfo = json?.status_info || {}
      lastError = new Error(statusInfo.message || statusInfo.error || statusInfo.status_msg || `汽水音乐 API 返回错误 (status_code=${json?.status_code})` + ` [video_id=${video_id}]`)
      lastError.status = resp.status
      lastError.payload = json
    } catch (e) {
      lastError = e
    }
  }

  if (!videoPayload) {
    dbgLog('fetchVideoPayload 所有格式均失败, 最后错误: ' + (lastError?.message || '(未知)'))
    throw lastError || new Error('video_v2 所有请求格式均失败 [video_id=' + video_id + ']')
  }

  // 输出响应结构 (同时支持 track_player 和 player_infos)
  const tp = videoPayload?.track_player || {}
  const pi = videoPayload?.player_infos || []
  dbgLog('fetchVideoPayload track_player keys=' + JSON.stringify(Object.keys(tp)) + ' player_infos 长度=' + pi.length)
  dbgLog('fetchVideoPayload has video=' + !!videoPayload.video + ' has track=' + !!videoPayload.track)

  return videoPayload
}

// 直接从 SSR 提供的 main_url 下载视频 (跳过 video_model 解析)
// SSR 接口返回的是 douyinvod.com 直链, 无需解密, 直接下载即可
async function downloadFromDirectMainUrl({ directMainUrl, contentType, trackPayload, track_id, quality, vid, isRealVideo }) {
  dbgLog('downloadFromDirectMainUrl 开始: url=' + directMainUrl.slice(0, 100) + '... contentType=' + contentType + ' isRealVideo=' + isRealVideo)

  // 直链下载 (SSR/后端返回的 URL 通常是 douyinvod.com 或其他 CDN 直链)
  // 关键: douyinvod.com 需要正确的 Referer 头, 否则返回 200 但内容为空/错误
  const isDouyinVod = directMainUrl.includes('douyinvod.com') || directMainUrl.includes('bytevcloud.com') || directMainUrl.includes('bytedance.com')
  const downloadHeaders = {
    'User-Agent': 'Cronet/TTNetVersion:3cd4fda3 2025-07-21 QuicVersion:52c2b40d 2025-04-03',
    'Range': 'bytes=0-',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Accept': '*/*',
  }
  if (isDouyinVod) {
    downloadHeaders['Referer'] = 'https://www.qishui.com/'
    downloadHeaders['Origin'] = 'https://www.qishui.com'
    dbgLog('downloadFromDirectMainUrl 检测到字节 CDN URL, 添加 Referer/Origin 头')
  }

  let mediaResponse = await fetch(directMainUrl, {
    headers: downloadHeaders,
    redirect: 'follow',
  })

  // 如果用 Cronet UA 失败 (非 OK, 或 200 OK 但 content-length 为 0), 回退到 Chrome UA 重试
  const contentLen = mediaResponse.headers.get('content-length')
  const needFallback = !mediaResponse.ok || (mediaResponse.status === 200 && (!contentLen || contentLen === '0'))
  if (needFallback) {
    dbgLog('downloadFromDirectMainUrl Cronet UA 失败 (HTTP=' + mediaResponse.status + ' content-length=' + (contentLen || 'none') + '), 尝试 Chrome UA 回退')
    const chromeHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Range': 'bytes=0-',
      'Accept-Encoding': 'identity',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    }
    if (isDouyinVod) {
      chromeHeaders['Referer'] = 'https://www.qishui.com/'
      chromeHeaders['Origin'] = 'https://www.qishui.com'
    }
    const retryResp = await fetch(directMainUrl, { headers: chromeHeaders, redirect: 'follow' })
    if (!retryResp.ok) {
      const errorText = await retryResp.text().catch(() => '')
      dbgLog('downloadFromDirectMainUrl 所有 UA 均失败: HTTP ' + retryResp.status + ' body=' + errorText.slice(0, 200))
      const error = new Error(errorText || `upstream status ${retryResp.status}`)
      error.status = retryResp.status
      throw error
    }
    mediaResponse = retryResp
    dbgLog('downloadFromDirectMainUrl Chrome UA 回退成功: HTTP=' + mediaResponse.status)
  }

  if (!mediaResponse.ok) {
    const errorText = await mediaResponse.text().catch(() => '')
    dbgLog('downloadFromDirectMainUrl 错误: 下载失败 HTTP ' + mediaResponse.status + ' body=' + errorText.slice(0, 200))
    const error = new Error(errorText || `upstream status ${mediaResponse.status}`)
    error.status = mediaResponse.status
    throw error
  }

  const buffer = Buffer.from(await mediaResponse.arrayBuffer())
  dbgLog('downloadFromDirectMainUrl 下载完成, size=' + buffer.length + ' HTTP=' + mediaResponse.status + ' content-length=' + (mediaResponse.headers.get('content-length') || 'unknown'))

  // 验证音频有效性: 检查文件头魔数
  if (buffer.length < 100) {
    dbgLog('downloadFromDirectMainUrl 错误: 文件太小 (' + buffer.length + ' bytes), 无效')
    throw new Error('下载文件太小 (' + buffer.length + ' bytes), 可能是错误响应')
  }
  // 检查是否为有效的 m4a/mp3/flac 文件
  const headerStr = buffer.slice(0, 16).toString('hex')
  const asciiHeader = buffer.slice(0, 16).toString('ascii')
  dbgLog('downloadFromDirectMainUrl 文件头: hex=' + headerStr + ' ascii="' + asciiHeader.replace(/[^\x20-\x7E]/g, '.') + '"')
  // 常见音频文件头: fLaC(flac), ID3(mp3), ....ftyp(m4a/mp4), OggS(ogg), RIFF(wav)
  // m4a/mp4 的特征: 前4字节是 size, 然后是 "ftyp" (hex: 000000...66747970)
  const hasFtyp = /ftyp/.test(asciiHeader)
  const hasFlac = /fLaC/.test(asciiHeader)
  const hasMp3 = /ID3/.test(asciiHeader) || /^fff[0-9a-f]/.test(headerStr)
  const hasOgg = /OggS/.test(asciiHeader)
  const hasRiff = /RIFF/.test(asciiHeader)
  const isLikelyAudio = hasFtyp || hasFlac || hasMp3 || hasOgg || hasRiff

  // 检查是否为 HTML/JSON 错误页面
  if (asciiHeader.startsWith('<!doc') || asciiHeader.startsWith('<html')) {
    dbgLog('downloadFromDirectMainUrl 错误: 下载到 HTML 错误页面')
    throw new Error('下载到 HTML 错误页面而非音频数据, URL 可能已过期或需要认证')
  }
  if (asciiHeader.startsWith('{') || asciiHeader.startsWith('[')) {
    dbgLog('downloadFromDirectMainUrl 错误: 下载到 JSON 数据 (可能是 API 错误响应)')
    throw new Error('下载到 JSON 数据而非音频, 可能是风控拦截或 URL 已失效')
  }

  if (!isLikelyAudio && buffer.length > 200) {
    // 可能是加密的 m4a (encv/enca 盒头), 继续尝试解密流程
    dbgLog('downloadFromDirectMainUrl 警告: 文件头不匹配已知音频格式, 可能是加密数据, 继续尝试解密')
  } else if (isLikelyAudio) {
    dbgLog('downloadFromDirectMainUrl 文件头验证通过: ' + (hasFtyp ? 'mp4/m4a' : hasFlac ? 'flac' : hasMp3 ? 'mp3' : hasOgg ? 'ogg' : hasRiff ? 'wav' : 'unknown'))
  }

  // 根据 isRealVideo 从不同字段提取元数据
  let title, artist
  if (isRealVideo) {
    // 真正视频: video SSR payload
    const videoOptions = trackPayload?.video || {}
    title = videoOptions.title || videoOptions.videoName || 'unknown'
    artist = Array.isArray(videoOptions.artists) ? (videoOptions.artists[0]?.user_info?.nickname || 'unknown') : (videoOptions.artistName || 'unknown')
  } else {
    // 普通歌曲: track SSR payload 或 track_v2 payload
    const track = trackPayload?.track || {}
    title = track.name || track.title || 'unknown'
    const artists = track.artists || []
    if (Array.isArray(artists) && artists.length > 0) {
      artist = artists[0].simple_display_name || artists[0].name || artists[0].nickname || 'unknown'
    } else {
      artist = 'unknown'
    }
  }

  // 根据 contentType 决定扩展名
  let ext = '.mp4'
  let finalContentType = 'video/mp4'
  if (contentType) {
    if (contentType.includes('audio/flac')) { ext = '.flac'; finalContentType = 'audio/flac' }
    else if (contentType.includes('audio/mpeg')) { ext = '.mp3'; finalContentType = 'audio/mpeg' }
    else if (contentType.includes('audio/mp4') || contentType.includes('m4a')) { ext = '.m4a'; finalContentType = 'audio/mp4' }
    else if (contentType.includes('video/mp4')) { ext = '.mp4'; finalContentType = 'video/mp4' }
    else if (contentType.includes('video')) { ext = '.mp4'; finalContentType = 'video/mp4' }
    else if (contentType.includes('audio')) { ext = '.m4a'; finalContentType = 'audio/mp4' }
  } else if (!isRealVideo) {
    ext = '.m4a'
    finalContentType = 'audio/mp4'
  }

  const fileName = `${title} - ${artist}${ext}`.replace(/[<>:"/\\|?*]/g, '_')

  // 获取 spade_a 加密信息 (从多个可能位置)
  let spadeA = ''
  const encryptInfo = trackPayload?.__encryptInfo
  if (trackPayload?.__spadeA) {
    spadeA = trackPayload.__spadeA
    dbgLog('downloadFromDirectMainUrl spade_a 来自 __spadeA: 长度=' + spadeA.length)
  } else if (encryptInfo?.spade_a) {
    spadeA = encryptInfo.spade_a
    dbgLog('downloadFromDirectMainUrl spade_a 来自 __encryptInfo: 长度=' + spadeA.length)
  } else {
    // 尝试从 video_model 中提取
    const vm = trackPayload?.track_player?.video_model
    if (vm) {
      try {
        const parsed = typeof vm === 'string' ? JSON.parse(vm) : vm
        const firstItem = parsed?.video_list?.[0]
        if (firstItem?.encrypt_info?.spade_a) {
          spadeA = firstItem.encrypt_info.spade_a
          dbgLog('downloadFromDirectMainUrl spade_a 来自 video_model: 长度=' + spadeA.length)
        }
      } catch (e) {}
    }
  }

  // 检测加密: 即使没有 spade_a, 也检查文件是否包含加密标记
  if (!spadeA && buffer.length > 1000) {
    // 加密的 m4a 文件 stsd 盒中包含 "enca" 而非 "mp4a"
    // 搜索前 1MB 数据是否包含 "enca" 和 "senc" 标记
    const searchLen = Math.min(buffer.length, 1048576) // 1MB
    const headSlice = buffer.slice(0, searchLen).toString('latin1')
    const hasEnca = headSlice.includes('enca')
    const hasSenc = headSlice.includes('senc')
    if (hasEnca || hasSenc) {
      dbgLog('downloadFromDirectMainUrl 警告: 文件包含加密标记 (enca=' + hasEnca + ' senc=' + hasSenc + ') 但无 spade_a, 音频可能无法播放')
    }
  }

  // 无 spade_a: 跳过解密, 直接返回原始 buffer
  if (!spadeA) {
    dbgLog('downloadFromDirectMainUrl 无 spade_a, 跳过解密')
    dbgLog('downloadFromDirectMainUrl 完成, ext=' + ext + ' size=' + buffer.length + ' fileName=' + fileName)
    return {
      buffer,
      fileName,
      contentType: finalContentType,
      trackPayload,
    }
  }

  // 有 spade_a: 解密音频
  dbgLog('downloadFromDirectMainUrl 有 spade_a (长度=' + spadeA.length + '), 开始解密')
  try {
    const decryptor = new TrackDecryptor()
    const decResult = decryptor.decrypt({
      encryptedBuffer: buffer,
      spadeA,
      media: { title, artist },
    })
    dbgLog('downloadFromDirectMainUrl 解密完成, ext=' + decResult.extension + ' size=' + decResult.buffer.length)
    return {
      buffer: decResult.buffer,
      fileName: decResult.fileName,
      contentType: decResult.extension === '.flac' ? 'audio/flac' : 'audio/mp4',
      trackPayload,
    }
  } catch (decErr) {
    dbgLog('downloadFromDirectMainUrl 解密失败: ' + decErr.message + ' 返回原始 buffer')
    // 解密失败, 返回原始 buffer (可能是未加密的)
    return {
      buffer,
      fileName,
      contentType: finalContentType,
      trackPayload,
    }
  }
}

async function downloadTrackMedia({ sessionid, track_id, quality, aid = fixed.aid, mediaType = 'track', vid, cookie }) {
  dbgLog('downloadTrackMedia 开始: track_id=' + track_id + ' quality=' + quality + ' aid=' + aid + ' mediaType=' + mediaType + ' vid=' + (vid || '(无)') + ' cookie长度=' + (cookie || '').length)

  // UGC 创作歌曲(抖音原声): track.id 是汽水内部数字ID, track.media_type='ugc_clip'
  //   请求: track_v2 + track_id=数字 + media_type='ugc_clip'
  //   响应: { track, track_player: { video_model } }
  //
  // 真正视频类型(收藏的抖音视频): track.vid 是字符串格式(如 v1e00fgi0000...), track.video_id 是数字字符串
  //   请求: video_v2 + vid=字符串vid 或 video_id=数字字符串
  //   响应: { video, player_infos: [{ video_model }] }
  //
  // fallback 链:
  // 1. mediaType='video' + vid 存在: 优先尝试 video_v2 (用 vid 字符串)
  // 2. 失败则尝试 track_v2 + media_type='ugc_clip' (兼容 UGC 创作歌曲)
  // 3. 普通歌曲: track_v2 + media_type='track'
  // 4. 失败(ERR_RESOURCE_NOT_FOUND) + 有 vid: fallback 到 video_v2
  let trackPayload
  let isRealVideo = false // 标记是否为真正视频类型(影响 metadata 提取)

  if (mediaType === 'video' && vid) {
    // 视频类型: 优先尝试 video_v2 (用 vid 字符串格式)
    // 但 vid 可能是数字字符串(如 "7658326053748240249") 也可能是字符串格式(如 "v1e00fgi0000...")
    // 缓存分析显示真正视频用字符串格式 vid (v1e00fgi0000...) 请求 video_v2
    const isStringVid = typeof vid === 'string' && vid.startsWith('v')
    dbgLog('downloadTrackMedia 视频类型: vid=' + vid + ' isStringVid=' + isStringVid)

    if (isStringVid) {
      // 真正视频: vid 是字符串格式, 直接走 video_v2 (内部会优先尝试 SSR 接口)
      try {
        trackPayload = await fetchVideoPayload({ aid, sessionid, video_id: String(track_id), vid, cookie })
        // SSR 接口返回 __fromSSR/__fromBackend 标记, 直接带 main_url, 不需要解析 video_model
        if ((trackPayload?.__fromSSR || trackPayload?.__fromBackend) && trackPayload?.__directMainUrl) {
          dbgLog('downloadTrackMedia SSR/后端直链模式, 跳过 video_model 解析 source=' + (trackPayload?.__fromSSR ? 'SSR' : 'backend'))
          isRealVideo = true
          // 直接用直链下载视频
          return await downloadFromDirectMainUrl({
            directMainUrl: trackPayload.__directMainUrl,
            contentType: trackPayload.__directContentType || 'video/mp4',
            trackPayload,
            track_id,
            quality,
            vid,
            isRealVideo: true,
          })
        }
        isRealVideo = !!trackPayload?.player_infos
        dbgLog('downloadTrackMedia video_v2 成功, isRealVideo=' + isRealVideo)
      } catch (e) {
        dbgLog('downloadTrackMedia video_v2 失败: ' + e.message + ', 回退到 track_v2 + ugc_clip')
        // 回退到 track_v2 + ugc_clip
        trackPayload = await fetchTrackPayload({ aid, sessionid, track_id: String(track_id), mediaType: 'ugc_clip', cookie })
      }
    } else {
      // UGC 创作: vid 是数字字符串, 先尝试 track_v2 + ugc_clip
      const mediaTypeVariants = ['ugc_clip', 'audio', 'video', 'track']
      let lastError = null
      let found = false
      for (const mt of mediaTypeVariants) {
        try {
          dbgLog('downloadTrackMedia UGC 尝试 track_v2: track_id=' + track_id + ' media_type=' + mt)
          trackPayload = await fetchTrackPayload({ aid, sessionid, track_id: String(track_id), mediaType: mt, cookie })
          found = true
          dbgLog('downloadTrackMedia UGC 成功: media_type=' + mt)
          break
        } catch (e) {
          lastError = e
          const statusCode = e.payload?.status_code
          dbgLog('downloadTrackMedia UGC 失败: media_type=' + mt + ' status_code=' + statusCode)
          if (statusCode !== 1000004 && statusCode !== 1000005) {
            throw e
          }
        }
      }
      if (!found) {
        // 所有 media_type 都失败, fallback 到 video_v2 用 vid 请求
        dbgLog('downloadTrackMedia UGC 所有 media_type 均失败, fallback 到 video_v2, video_id=' + vid)
        try {
          trackPayload = await fetchVideoPayload({ aid, sessionid, video_id: String(track_id), vid, cookie })
          isRealVideo = !!trackPayload?.player_infos
        } catch (e2) {
          throw lastError || e2
        }
      }
    }
  } else {
    // 普通歌曲: 用 track_id + media_type='track'
    try {
      trackPayload = await fetchTrackPayload({ aid, sessionid, track_id: String(track_id), cookie })
      // SSR/后端直链模式: fetchTrackPayload 内部回退成功, 直接带 main_url, 跳过 video_model 解析
      if ((trackPayload?.__fromSSR || trackPayload?.__fromBackend) && trackPayload?.__directMainUrl) {
        dbgLog('downloadTrackMedia 普通歌曲 SSR/后端直链模式, source=' + (trackPayload?.__fromSSR ? 'SSR' : 'backend') + ' 跳过 video_model 解析')
        return await downloadFromDirectMainUrl({
          directMainUrl: trackPayload.__directMainUrl,
          contentType: trackPayload.__directContentType || 'audio/mp4',
          trackPayload,
          track_id,
          quality,
          vid,
          isRealVideo: false,
        })
      }
    } catch (e) {
      const isNotFound = (e.payload && e.payload.status_code === 1000005) ||
                         /ERR_RESOURCE_NOT_FOUND/i.test(e.message || '')
      if (isNotFound && vid) {
        // track_v2 用 track_id 找不到, fallback 用 vid 请求 video_v2
        dbgLog('downloadTrackMedia track_v2(track_id=' + track_id + ') 返回 ERR_RESOURCE_NOT_FOUND, fallback 到 video_v2, video_id=' + vid)
        trackPayload = await fetchVideoPayload({ aid, sessionid, video_id: String(track_id), vid, cookie })
        isRealVideo = !!trackPayload?.player_infos
      } else {
        throw e
      }
    }
  }

  // 提取 video_model: 真正视频在 player_infos[0].video_model, UGC 创作在 track_player.video_model
  let videoModelRaw = null
  if (isRealVideo) {
    // 真正视频类型: player_infos 数组
    const playerInfos = trackPayload?.player_infos || []
    if (playerInfos.length > 0) {
      videoModelRaw = playerInfos[0]?.video_model
      dbgLog('downloadTrackMedia 从 player_infos[0].video_model 提取, media_id=' + playerInfos[0]?.media_id)
    }
  } else {
    // UGC 创作/普通歌曲: track_player.video_model
    videoModelRaw = trackPayload?.track_player?.video_model
  }

  if (!videoModelRaw) {
    dbgLog('downloadTrackMedia 错误: video_model 不存在')
    dbgLog('downloadTrackMedia isRealVideo=' + isRealVideo + ' track_player=' + JSON.stringify(trackPayload?.track_player || {}, null, 2).slice(0, 500) + ' player_infos=' + JSON.stringify(trackPayload?.player_infos || [], null, 2).slice(0, 500))
    const error = new Error('track video_model not found')
    error.status = 404
    throw error
  }

  let videoModel = null

  try {
    videoModel = typeof videoModelRaw === 'string' ? JSON.parse(videoModelRaw) : videoModelRaw
  } catch (parseErr) {
    dbgLog('downloadTrackMedia 错误: video_model JSON 解析失败: ' + parseErr.message)
    dbgLog('downloadTrackMedia video_model 原始值(前200字符)=' + String(videoModelRaw).slice(0, 200))
    const error = new Error('track video_model parse failed')
    error.status = 500
    throw error
  }

  const videoList = Array.isArray(videoModel?.video_list) ? videoModel.video_list : []
  // 输出所有可用音质, 便于排查 quality 不匹配
  const availableQualities = videoList.map((item) => ({
    quality: item?.video_meta?.quality,
    has_main_url: !!item?.main_url,
    is_vip: item?.video_meta?.is_vip,
    need_vip: item?.need_vip,
    size: item?.video_meta?.size,
  }))
  dbgLog('downloadTrackMedia 可用音质列表=' + JSON.stringify(availableQualities))

  // 获取 label_info.quality_map (真正视频从 video.label_info, UGC 从 track.label_info)
  const labelInfo = isRealVideo
    ? (trackPayload?.video?.label_info || {})
    : (trackPayload?.track?.label_info || {})
  const qualityMap = labelInfo.quality_map || {}
  // 判断某个音质是否非 VIP 可播放
  const isFreeQuality = (q) => {
    const playDetail = qualityMap[q]?.play_detail
    return playDetail && !playDetail.need_vip && !playDetail.need_purchase
  }

  // 选择策略:
  // 1. 优先匹配指定 quality 且非 VIP
  // 2. 回退: 第一个非 VIP 且有 main_url 的音质
  // 3. 再回退: 第一个有 main_url 的音质(可能是 VIP 音质)
  let matchedItem = videoList.find((item) => item?.video_meta?.quality === quality && item?.main_url && isFreeQuality(item?.video_meta?.quality))
  if (!matchedItem) {
    dbgLog('downloadTrackMedia quality="' + quality + '" 未找到非VIP精确匹配, 尝试非VIP音质回退')
    matchedItem = videoList.find((item) => item?.main_url && isFreeQuality(item?.video_meta?.quality))
  }
  if (!matchedItem) {
    dbgLog('downloadTrackMedia 未找到非VIP音质, 回退到第一个有 main_url 的音质(可能需要VIP)')
    matchedItem = videoList.find((item) => item?.main_url)
  } else {
    dbgLog('downloadTrackMedia 选中非VIP音质: quality=' + matchedItem?.video_meta?.quality)
  }

  if (!matchedItem?.main_url) {
    dbgLog('downloadTrackMedia 错误: 所有音质都没有 main_url, video_list 完整结构=' + JSON.stringify(videoList, null, 2))
    const error = new Error('no downloadable quality found')
    error.status = 404
    throw error
  }

  dbgLog('downloadTrackMedia 选中的音质: quality=' + matchedItem?.video_meta?.quality + ' has_spade_a=' + !!matchedItem?.encrypt_info?.spade_a)

  // 抓包确认: douyinvod.com 直链需要特定请求头才能成功下载
  // - Range: bytes=0- (必需, 否则服务器拒绝)
  // - User-Agent: Cronet/TTNet (抖音系客户端 UA)
  // - Accept-Encoding: identity (禁用 gzip, 避免二进制流被压缩)
  const mediaResponse = await fetch(matchedItem.main_url, {
    headers: {
      'User-Agent': 'Cronet/TTNetVersion:3cd4fda3 2025-07-21 QuicVersion:52c2b40d 2025-04-03',
      'Range': 'bytes=0-',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive',
    },
    redirect: 'follow',
  })

  if (!mediaResponse.ok) {
    const errorText = await mediaResponse.text().catch(() => '')
    dbgLog('downloadTrackMedia 错误: 音频下载失败 HTTP ' + mediaResponse.status + ' body=' + errorText.slice(0, 200))
    const error = new Error(errorText || `upstream status ${mediaResponse.status}`)
    error.status = mediaResponse.status
    throw error
  }

  const encryptedBuffer = Buffer.from(await mediaResponse.arrayBuffer())
  dbgLog('downloadTrackMedia 加密音频下载完成, size=' + encryptedBuffer.length)

  // 获取 spade_a (加密信息)
  const spadeA = matchedItem?.encrypt_info?.spade_a || ''
  // 获取文件格式 (UGC 创作歌曲通常是 mp3, 无需解密)
  const vtype = matchedItem?.video_meta?.vtype || ''
  dbgLog('downloadTrackMedia spade_a=' + (spadeA ? '有' : '无') + ' vtype=' + vtype)

  // 提取标题/艺人 (真正视频从 video, UGC/普通从 track)
  const metaSource = isRealVideo ? trackPayload?.video : trackPayload?.track
  const title = isRealVideo
    ? (metaSource?.title || metaSource?.description || 'unknown')
    : (metaSource?.name || 'unknown')
  const artist = isRealVideo
    ? (Array.isArray(metaSource?.artists) ? (metaSource.artists[0]?.user_info?.nickname || metaSource.artists[0]?.name || metaSource.artists[0]?.simple_display_name || 'unknown') : 'unknown')
    : (getArtistName(trackPayload) || 'unknown')

  // 无 spade_a 的音频: 跳过解密, 直接返回原始 buffer
  if (!spadeA) {
    dbgLog('downloadTrackMedia 无 spade_a, 跳过解密, 直接返回原始 buffer')
    // 根据 vtype 决定扩展名 (真正视频可能是 mp4/video)
    let ext = '.m4a'
    if (vtype === 'mp3') ext = '.mp3'
    else if (vtype === 'flac') ext = '.flac'
    else if (vtype === 'm4a') ext = '.m4a'
    else if (vtype === 'mp4' || vtype === 'video') ext = '.mp4'
    const fileName = `${title} - ${artist}${ext}`.replace(/[<>:"/\\|?*]/g, '_')
    const contentType = ext === '.flac' ? 'audio/flac' : (ext === '.mp3' ? 'audio/mpeg' : (ext === '.mp4' ? 'video/mp4' : 'audio/mp4'))
    dbgLog('downloadTrackMedia 跳过解密完成, ext=' + ext + ' size=' + encryptedBuffer.length)
    return {
      buffer: encryptedBuffer,
      fileName,
      contentType,
      trackPayload,
    }
  }

  // 有 spade_a 的加密音频: 走正常解密流程
  const decryptor = new TrackDecryptor()
  const result = decryptor.decrypt({
    encryptedBuffer,
    spadeA,
    media: {
      title,
      artist,
    },
  })

  dbgLog('downloadTrackMedia 解密完成, ext=' + result.extension + ' size=' + result.buffer.length)

  return {
    buffer: result.buffer,
    fileName: result.fileName,
    contentType: result.extension === '.flac' ? 'audio/flac' : 'audio/mp4',
    trackPayload,
  }
}

module.exports = {
  getTrackV2Payload,
  downloadTrackMedia,
}
