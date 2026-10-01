// Mobile play reports share the desktop SongStats object in merged mode.
// Preserve dated listening records and duration while accepting old numeric counts.
function incrementPlayCount(data, audioPath) {
  if (!data.stats || typeof data.stats !== 'object' || Array.isArray(data.stats)) data.stats = {};
  const entry = data.stats[audioPath];
  const previous = entry && typeof entry === 'object' && !Array.isArray(entry)
    ? entry : { plays: typeof entry === 'number' ? entry : 0, duration: 0 };
  const plays = Number(previous.plays);
  const count = (Number.isFinite(plays) ? Math.max(0, plays) : 0) + 1;
  data.stats[audioPath] = { ...previous, plays: count };
  return count;
}

module.exports = { incrementPlayCount };
