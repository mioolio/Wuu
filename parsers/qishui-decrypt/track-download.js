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

async function fetchTrackPayload({ aid = fixed.aid, sessionid, track_id, mediaType = 'track' }) {
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
  const trackV2Response = await fetch(trackV2Url, {
    method: 'POST',
    headers: {
      Cookie: `sessionid=${sessionid};`,
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.qishui.com/',
    },
    body: JSON.stringify({
      aid,
      sessionid,
      track_id,
      media_type: mediaType,
      queue_type: 'search_one_track',
      scene_name: 'search',
    }),
  })

  const trackPayload = await trackV2Response.json()

  // 详细日志: 输出 HTTP 状态和响应结构, 便于排查"无可用音频"问题
  dbgLog('fetchTrackPayload HTTP status=' + trackV2Response.status)
  dbgLog('fetchTrackPayload respKeys=' + JSON.stringify(Object.keys(trackPayload || {})))
  // 输出完整响应(最多 2000 字符), 便于排查 status_code/status_info 错误
  dbgLog('fetchTrackPayload 完整响应=' + JSON.stringify(trackPayload, null, 2).slice(0, 2000))

  // 检测错误响应: 如果只有 status_code/status_info 而没有 track 数据, 说明请求失败
  if (trackPayload && trackPayload.status_code && !trackPayload.track && !trackPayload.track_player) {
    const statusInfo = trackPayload.status_info || {}
    dbgLog('fetchTrackPayload 错误: status_code=' + trackPayload.status_code + ' status_info=' + JSON.stringify(statusInfo))
    const errMsg = (statusInfo.message || statusInfo.error || `汽水音乐 API 返回错误 (status_code=${trackPayload.status_code})`) +
      ` [track_id=${track_id}]`
    const error = new Error(errMsg)
    error.status = trackV2Response.status
    error.payload = trackPayload
    throw error
  }

  if (!trackV2Response.ok) {
    dbgLog('fetchTrackPayload 失败响应=' + JSON.stringify(trackPayload, null, 2))
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

  for (let i = 0; i < variants.length; i++) {
    const { url, label, body } = variants[i]
    dbgLog('fetchVideoPayload 尝试格式 #' + (i + 1) + ' (' + label + '): ' + JSON.stringify(body))
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.qishui.com/',
        },
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
  dbgLog('downloadFromDirectMainUrl 开始: url=' + directMainUrl.slice(0, 100) + '... contentType=' + contentType)

  // 抓包确认: douyinvod.com 直链需要特定请求头才能成功下载
  // - Range: bytes=0- (必需, 否则服务器拒绝)
  // - User-Agent: Cronet/TTNet (抖音系客户端 UA)
  // - Accept-Encoding: identity (禁用 gzip, 避免二进制流被压缩)
  const mediaResponse = await fetch(directMainUrl, {
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
    dbgLog('downloadFromDirectMainUrl 错误: 视频下载失败 HTTP ' + mediaResponse.status + ' body=' + errorText.slice(0, 200))
    const error = new Error(errorText || `upstream status ${mediaResponse.status}`)
    error.status = mediaResponse.status
    throw error
  }

  const buffer = Buffer.from(await mediaResponse.arrayBuffer())
  dbgLog('downloadFromDirectMainUrl 视频下载完成, size=' + buffer.length)

  // 从 SSR 响应提取元数据
  const videoOptions = trackPayload?.video || {}
  const title = videoOptions.title || 'unknown'
  const artist = Array.isArray(videoOptions.artists) ? (videoOptions.artists[0]?.user_info?.nickname || 'unknown') : 'unknown'

  const ext = '.mp4'
  const fileName = `${title} - ${artist}${ext}`.replace(/[<>:"/\\|?*]/g, '_')

  dbgLog('downloadFromDirectMainUrl 完成, ext=' + ext + ' size=' + buffer.length + ' fileName=' + fileName)

  return {
    buffer,
    fileName,
    contentType: 'video/mp4',
    trackPayload,
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
        // SSR 接口返回 __fromSSR 标记, 直接带 main_url, 不需要解析 video_model
        if (trackPayload?.__fromSSR && trackPayload?.__directMainUrl) {
          dbgLog('downloadTrackMedia SSR 直链模式, 跳过 video_model 解析')
          isRealVideo = true
          // 直接用 SSR 返回的 main_url 下载视频
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
        trackPayload = await fetchTrackPayload({ aid, sessionid, track_id: String(track_id), mediaType: 'ugc_clip' })
      }
    } else {
      // UGC 创作: vid 是数字字符串, 先尝试 track_v2 + ugc_clip
      const mediaTypeVariants = ['ugc_clip', 'audio', 'video', 'track']
      let lastError = null
      let found = false
      for (const mt of mediaTypeVariants) {
        try {
          dbgLog('downloadTrackMedia UGC 尝试 track_v2: track_id=' + track_id + ' media_type=' + mt)
          trackPayload = await fetchTrackPayload({ aid, sessionid, track_id: String(track_id), mediaType: mt })
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
      trackPayload = await fetchTrackPayload({ aid, sessionid, track_id: String(track_id) })
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
