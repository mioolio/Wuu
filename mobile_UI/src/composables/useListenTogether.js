// Explicit membership follows the real desktop clock. Storage syncMode is
// independent: a closed room never sends playback controls to the computer.
import { ref, computed, watch } from 'vue';
import { usePlayer } from './usePlayer.js';

function savedMembership() { try { return localStorage.getItem('listen-together') === '1'; } catch (_) { return false; } }
const enabled = ref(savedMembership());
const connected = ref(false);
const desktopConnected = ref(false);
const autoplayBlocked = ref(false);
const peerCount = ref(0);
const isHost = computed(() => false); // The actual desktop owns automatic advance.
const player = usePlayer();
let ws = null, myId = 0, connectionVersion = 0, applyVersion = 0;
let lastAppliedSeq = -1, reconnectTimer = null, reconnectAttempts = 0;
let latestSnapshot = null, latestAt = 0;

function sameSong(a, b) {
  if (!a || !b) return false;
  return a.audioPath && b.audioPath ? a.audioPath === b.audioPath : a.id === b.id;
}
function snapshotPosition(snapshot) {
  const elapsed = snapshot.isPlaying ? Math.max(0, (Date.now() - latestAt) / 1000) * (snapshot.playbackRate || 1) : 0;
  const target = Math.max(0, Number(snapshot.position) || 0) + elapsed;
  return snapshot.duration > 0 ? Math.min(snapshot.duration, target) : target;
}
async function applySnapshot(snapshot, userGesture = false) {
  if (!enabled.value || !desktopConnected.value || !snapshot) return false;
  const version = ++applyVersion;
  const target = snapshotPosition(snapshot);
  const shouldPlay = !!snapshot.isPlaying && (!autoplayBlocked.value || userGesture);
  player.setRemoteApplying(true);
  let result;
  try {
    if (!snapshot.song) {
      player.clearSong();
      autoplayBlocked.value = false;
      return true;
    }
    player.setPlaybackRate(snapshot.playbackRate, { notify: false });
    if (!sameSong(player.currentSong.value, snapshot.song)) {
      result = player.playSong(snapshot.song, { position: target, autoplay: shouldPlay,
        playbackRate: snapshot.playbackRate, restoreProgress: false, notify: false, remote: true });
    } else {
      const audio = player.getAudioEl();
      player.updateRemoteSongInfo(snapshot.song);
      // Paused state and explicit rejoin align exactly. Playing periodic updates
      // correct audible drift without changing the selected base playback rate.
      if (!audio || audio.paused || !snapshot.isPlaying || Math.abs(target - player.currentTime.value) > .4) {
        player.seekTo(target, { notify: false });
      }
      if (shouldPlay && audio?.paused) result = player.resume({ notify: false, remote: true });
      else if (!shouldPlay) player.pause({ notify: false });
      else result = true;
    }
  } finally { player.setRemoteApplying(false); }
  const playing = await result;
  if (version !== applyVersion || !enabled.value || !desktopConnected.value) return false;
  if (!snapshot.isPlaying) autoplayBlocked.value = false;
  else if (shouldPlay) autoplayBlocked.value = !playing;
  return !snapshot.isPlaying || !!playing;
}
function receiveSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  latestSnapshot = { ...snapshot, playbackRate: typeof snapshot.playbackRate === 'number' &&
    Number.isFinite(snapshot.playbackRate) ? Math.min(2, Math.max(.5, snapshot.playbackRate)) : 1 };
  latestAt = Date.now();
  desktopConnected.value = snapshot.desktopConnected !== false;
  void applySnapshot(latestSnapshot).catch(() => { if (enabled.value) autoplayBlocked.value = true; });
}
function connect() {
  if (!enabled.value || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
  const generation = ++connectionVersion;
  let socket;
  try { socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/together`); }
  catch (_) { scheduleReconnect(); return; }
  ws = socket;
  const current = () => enabled.value && ws === socket && generation === connectionVersion;
  socket.onopen = () => {
    if (!current()) return;
    connected.value = true; reconnectAttempts = 0; lastAppliedSeq = -1;
  };
  socket.onerror = () => {};
  socket.onclose = () => {
    if (!current()) return;
    ws = null; connected.value = false; desktopConnected.value = false; peerCount.value = 0;
    applyVersion++; player.cancelRemotePlayback(); scheduleReconnect();
  };
  socket.onmessage = event => {
    if (!current()) return;
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type === 'welcome') {
      myId = message.id; peerCount.value = message.peers || 1;
      desktopConnected.value = message.desktopConnected !== false;
      lastAppliedSeq = Number.isSafeInteger(message.seq) ? message.seq : -1;
      if (desktopConnected.value) receiveSnapshot(message.hostSong);
    } else if (message.type === 'peers') {
      peerCount.value = message.count || 0;
      desktopConnected.value = !!message.desktopConnected;
      if (!desktopConnected.value) { applyVersion++; player.cancelRemotePlayback(); }
    } else if (message.type === 'op') {
      if (Number.isSafeInteger(message.seq)) {
        if (message.seq <= lastAppliedSeq) return;
        lastAppliedSeq = message.seq;
      }
      if (message.op === 'state' && message.from === 0) receiveSnapshot(message.payload);
      else if (message.op === 'like') player.applyRemoteLike(message.payload?.index, !!message.payload?.liked);
    }
  };
}
function scheduleReconnect() {
  if (!enabled.value || reconnectTimer) return;
  const delay = Math.min(15000, 1000 * 2 ** reconnectAttempts++);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (enabled.value) connect(); }, delay);
}
function disconnect() {
  connectionVersion++; applyVersion++; player.cancelRemotePlayback();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
  const old = ws; ws = null;
  if (old) {
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try { old.close(); } catch (_) {}
  }
  connected.value = false; desktopConnected.value = false; peerCount.value = 0;
  autoplayBlocked.value = false; latestSnapshot = null;
}
function notifyLocalOp(op, payload = {}) {
  if (!enabled.value || !connected.value || !desktopConnected.value || ws?.readyState !== 1) return;
  const song = player.currentSong.value;
  const body = { songId: song?.id, audioPath: song?.audioPath,
    playbackRate: player.playbackRate.value, ...payload };
  try { ws.send(JSON.stringify({ type: 'op', op, payload: body })); } catch (_) {}
}
function alignNow() {
  if (!enabled.value || !connected.value) return;
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'get-state' }));
}
async function resumeTogether() {
  if (!enabled.value || !connected.value || !desktopConnected.value) return false;
  if (latestSnapshot?.isPlaying) return applySnapshot(latestSnapshot, true);
  const started = await player.resume({ notify: false });
  autoplayBlocked.value = !started;
  if (started) notifyLocalOp('play', { position: player.currentTime.value });
  return started;
}
watch(enabled, on => {
  try { localStorage.setItem('listen-together', on ? '1' : '0'); } catch (_) {}
  if (on) connect(); else disconnect();
}, { immediate: true, flush: 'sync' });
player.setOpNotifier(notifyLocalOp);
player.setListenStatusProvider(() => ({ enabled: enabled.value, connected: connected.value,
  desktopConnected: desktopConnected.value, isHost: false }));

export function useListenTogether() {
  return { enabled, connected, peerCount, desktopConnected, autoplayBlocked, isHost,
    myId: () => myId, alignNow, resumeTogether };
}
