// Keep the welcome snapshot aligned with the operations already broadcast to the
// room. Either member may select a song; only the host may calibrate via state.
function normalizeTogetherRate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(2, Math.max(.5, value)) : 1;
}
function mergeTogetherState(current, entry, isHost) {
  const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
  const position = Number.isFinite(payload.position) ? Math.max(0, payload.position) : null;

  if ((entry.op === 'song' || (isHost && entry.op === 'state')) &&
      payload.song && typeof payload.song === 'object' && !Array.isArray(payload.song)) {
    if (payload.songId != null && payload.song.id != null && payload.songId !== payload.song.id) return current;
    return { song: payload.song, position: position ?? 0, isPlaying: !!payload.isPlaying,
      playbackRate: normalizeTogetherRate(payload.playbackRate ?? payload.rate) };
  }
  if (!current || !current.song) return current;
  if (payload.songId != null && payload.songId !== current.song.id) return current;
  if (payload.audioPath != null && payload.audioPath !== current.song.audioPath) return current;

  if (entry.op === 'play' || entry.op === 'pause') {
    // Older clients omit songId for room-wide play/pause controls.
    return { ...current, position: position ?? current.position, isPlaying: entry.op === 'play' };
  }
  if (entry.op === 'seek' || entry.op === 'rate' || (isHost && entry.op === 'state')) {
    return {
      ...current,
      position: position ?? current.position,
      isPlaying: typeof payload.isPlaying === 'boolean' ? payload.isPlaying : current.isPlaying,
      playbackRate: payload.playbackRate != null || payload.rate != null
        ? normalizeTogetherRate(payload.playbackRate ?? payload.rate) : current.playbackRate,
    };
  }
  return current;
}

module.exports = { mergeTogetherState, normalizeTogetherRate };
