// ===== 一起听 composable =====
// 通过桌面端 WebSocket 房间 (/ws/together) 实时同步多端播放
// 双方都能控制: 本地操作广播给其他端, 远端操作实时应用
// 进度同步策略 (不依赖时钟同步, 以消息到达时刻为基准):
//   偏差 > 0.4s  → 硬校正 (直接 seek)
//   偏差 > 0.12s → 微调 playbackRate ±2% 追赶 (听感无感知)
//   偏差 ≤ 0.12s → 恢复正常速率
import { ref, computed, watch } from 'vue';
import { usePlayer } from './usePlayer.js';

// 开关状态 (localStorage 持久化, 关闭 = 各听各的)
const enabled = ref(localStorage.getItem('listen-together') === '1');
const connected = ref(false);
const peerCount = ref(0);
const hostId = ref(0);  // 房间 host (最先加入者), 0=未知

let ws = null;
let myId = 0;
let lastAppliedSeq = 0;      // 已应用的最高操作序号 (乱序/过期丢弃)
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

// 是否本机为 host: hostId 未知(0)时视为自己是 host, 保证单人房间行为不变
const isHost = computed(() => hostId.value === 0 || hostId.value === myId);

// 远端操作应用期间抑制本地广播回环
let applyingRemote = false;

// usePlayer 单例 (模块级共享状态, 各组件调用拿到同一份)
const player = usePlayer();

// WS 地址: 与页面同源, 开发环境经 Vite 代理转发到桌面端
function _wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/together`;
}

// ===== 连接管理 =====
function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try {
    ws = new WebSocket(_wsUrl());
  } catch (e) {
    _scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected.value = true;
    reconnectAttempts = 0;
    // 重连后服务器的序号可能从头开始。
    lastAppliedSeq = 0;
  };
  ws.onclose = () => {
    connected.value = false;
    peerCount.value = 0;
    _scheduleReconnect();
  };
  ws.onerror = () => {
    try { ws.close(); } catch (e) { /* 忽略 */ }
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'welcome') {
      myId = msg.id;
      peerCount.value = msg.peers || 1;
      hostId.value = msg.hostId || 0;
      // 加入即拉取: 优先 host 当前歌曲上下文 (歌名+进度+播放态, 手动开启时立即对齐),
      // 无 hostSong (host 空闲) 时回退最近一次广播操作
      if (msg.hostSong && msg.hostSong.song) {
        _applyRemoteOp({ op: 'song', payload: msg.hostSong }, true);
      } else if (msg.lastOp) {
        _applyRemoteOp(msg.lastOp, true);
      }
    } else if (msg.type === 'op') {
      _applyRemoteOp(msg, false);
    } else if (msg.type === 'peers') {
      peerCount.value = msg.count;
      if (typeof msg.hostId === 'number') hostId.value = msg.hostId;
    } else if (msg.type === 'peer-left') {
      // 对端退出: 剩余成员暂停播放 (对端可能是意外关闭页面/断网)
      if (typeof msg.hostId === 'number') hostId.value = msg.hostId;
      if (msg.count < peerCount.value) peerCount.value = msg.count;
      const audio = player.getAudioEl();
      if (audio && !audio.paused) {
        player.setRemoteApplying(true);
        try { player.pause(); } finally { player.setRemoteApplying(false); }
      }
    }
  };
}

function disconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
  if (ws) {
    // 移除 onclose 防止触发重连
    ws.onclose = null;
    try { ws.close(); } catch (e) { /* 忽略 */ }
    ws = null;
  }
  connected.value = false;
  peerCount.value = 0;
  hostId.value = 0;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// 指数退避重连 (1s → 15s 封顶)
function _scheduleReconnect() {
  if (!enabled.value || reconnectTimer) return;
  const delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempts++));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (enabled.value) connect();
  }, delay);
}

// ===== 本地操作广播 (usePlayer 控制 hook) =====
function notifyLocalOp(op, payload) {
  if (!enabled.value || !connected.value || applyingRemote) return;
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: 'op', op, payload: payload || {} }));
  } catch (e) { /* 发送失败静默, 心跳会再次校准 */ }
}

// ===== 远端操作应用 =====
function _applyRemoteOp(entry, isWelcome) {
  if (!entry || !entry.op) return;
  // seq 仲裁: 欢迎消息不校验 (迟到者强制追平), 广播消息丢弃过期序号
  if (!isWelcome && typeof entry.seq === 'number') {
    if (entry.seq <= lastAppliedSeq) return;
    lastAppliedSeq = entry.seq;
  }

  applyingRemote = true;
  player.setRemoteApplying(true);
  try {
    const audio = player.getAudioEl();
    switch (entry.op) {
      case 'song': {
        _applySongPayload(entry.payload || {});
        break;
      }
      case 'play':
        player.resume();
        break;
      case 'pause':
        player.pause();
        if (Number.isFinite(entry.payload?.position)) player.seekTo(entry.payload.position);
        break;
      case 'seek': {
        // 歌对不上时忽略进度跳转, 防止把时间同步到另一首歌上
        const p = entry.payload || {};
        const mySongId = player.currentSong.value ? player.currentSong.value.id : null;
        if (p.songId != null && mySongId != null && p.songId !== mySongId) break;
        if (audio && typeof p.position === 'number') {
          player.seekTo(p.position);
        }
        if (p.isPlaying) player.resume();
        break;
      }
      case 'like': {
        // 他端点赞/取消点赞: 同步红心状态
        player.applyRemoteLike(entry.payload.index, !!entry.payload.liked);
        break;
      }
      case 'state': {
        // 进度校准心跳: 只信任 host 发出的, 防止两端互相拖拽时间
        if (hostId.value !== 0 && entry.from !== hostId.value) break;
        const p = entry.payload || {};
        const mySongId = player.currentSong.value ? player.currentSong.value.id : null;
        // 歌不同: 不同步时间; host 心跳携带完整歌曲时自动切过去 (失步自愈)
        if (p.songId != null && mySongId != null && p.songId !== mySongId) {
          if (p.song) _applySongPayload({ song: p.song, position: p.position, isPlaying: p.isPlaying });
          break;
        }
        if (!audio || audio.paused || !p.isPlaying) {
          if (audio) audio.playbackRate = 1;
          break;
        }
        const target = (p.position || 0) + 0.15;  // 传输延迟估算
        const drift = target - audio.currentTime;
        if (Math.abs(drift) > 0.4) {
          player.seekTo(target);                                 // 硬校正
        } else if (Math.abs(drift) > 0.12) {
          audio.playbackRate = drift > 0 ? 1.02 : 0.98;          // 微调追赶
        } else {
          audio.playbackRate = 1;                                // 追平恢复
        }
        break;
      }
    }
  } finally {
    applyingRemote = false;
    player.setRemoteApplying(false);
  }
}

// 应用切歌载荷: 同歌对齐进度/播放态, 异歌直接切换 (含迟到进度对齐)
function _applySongPayload(payload) {
  const song = payload.song;
  if (!song) return;
  const audio = player.getAudioEl();
  const cur = player.currentSong.value;
  if (cur && cur.id === song.id) {
    // 同一首歌: 仅对齐进度与播放态
    if (audio && typeof payload.position === 'number') {
      player.seekTo(payload.position);
    }
    if (payload.isPlaying && audio && audio.paused) player.resume();
    if (!payload.isPlaying && audio && !audio.paused) player.pause();
  } else {
    player.playSong(song, {
      position: payload.position,
      autoplay: !!payload.isPlaying,
      restoreProgress: false,
      notify: false,
    });
  }
}

// ===== 心跳: 每 5s 广播播放状态供对端校准 =====
// 携带 songId 供对端判断是否同一首歌; 仅 host 额外携带完整歌曲对象,
// 对端发现歌不同时自动切换过去 (失步自愈)
function _startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!enabled.value || !connected.value) return;
    const audio = player.getAudioEl();
    if (!audio || audio.paused) return;
    const song = player.currentSong.value;
    if (!song) return;
    const payload = {
      position: audio.currentTime,
      isPlaying: true,
      rate: audio.playbackRate,
      songId: song.id,
    };
    if (isHost.value) payload.song = song;
    notifyLocalOp('state', payload);
  }, 5000);
}

// ===== 开关联动 =====
watch(enabled, (on) => {
  localStorage.setItem('listen-together', on ? '1' : '0');
  if (on) {
    connect();
    _startHeartbeat();
  } else {
    disconnect();
  }
}, { immediate: true });

// host 变化 (前 host 退出, 本机继任): 若本机有 pending 的切歌请求则补切
watch(isHost, (v) => {
  if (v) player.flushPendingAdvance();
});

// 初始化时向 usePlayer 注册广播 hook (本地操作 → WS 广播)
player.setOpNotifier(notifyLocalOp);
// 注册一起听状态查询 (usePlayer 的 ended 处理据此判断是否本机负责切歌)
player.setListenStatusProvider(() => ({
  enabled: enabled.value,
  connected: connected.value,
  isHost: isHost.value,
}));

export function useListenTogether() {
  return {
    enabled,
    connected,
    peerCount,
    isHost,
    myId: () => myId,
  };
}
