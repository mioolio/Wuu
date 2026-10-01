// Read embedded local genre tags without downloading data or modifying media.
const fs = require('fs');
const { parseFile } = require('music-metadata');

const genreCache = new Map();
const supportedAudio = /\.(aac|m4a|mp3|wav|flac|ogg)$/i;

function normalizeGenres(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set();
  const genres = [];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const label = item.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) { seen.add(key); genres.push(label); }
  }
  return genres;
}

function fileKey(stat) { return `${stat.mtimeMs}:${stat.size}`; }
function isSupported(audioPath) { return typeof audioPath === 'string' && supportedAudio.test(audioPath) && !/\.enc\./i.test(audioPath); }

function getCachedGenres(audioPath) {
  const entry = genreCache.get(audioPath);
  if (!entry) return [];
  try {
    if (fileKey(fs.statSync(audioPath)) === entry.key) return entry.genres ? [...entry.genres] : [];
  } catch (_) {}
  genreCache.delete(audioPath);
  return [];
}

async function readSongGenres(audioPath) {
  if (!isSupported(audioPath)) return [];
  let stat;
  try { stat = await fs.promises.stat(audioPath); } catch (_) { genreCache.delete(audioPath); return []; }
  if (!stat.isFile()) { genreCache.delete(audioPath); return []; }
  const key = fileKey(stat);
  const cached = genreCache.get(audioPath);
  if (cached?.key === key) return [...await cached.pending];
  const entry = { key, genres: null, pending: null };
  entry.pending = parseFile(audioPath, { skipCovers: true, duration: false })
    .then(metadata => {
      entry.genres = normalizeGenres(metadata.common?.genre);
      return entry.genres;
    })
    .catch(() => {
      // A failed read remains retryable on the next library refresh.
      if (genreCache.get(audioPath) === entry) genreCache.delete(audioPath);
      return [];
    });
  genreCache.set(audioPath, entry);
  return [...await entry.pending];
}

async function enrichSongGenres(songs) {
  const present = new Set(songs.map(song => song.audioPath));
  for (const audioPath of genreCache.keys()) if (!present.has(audioPath)) genreCache.delete(audioPath);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, songs.length) }, async () => {
    while (next < songs.length) {
      const song = songs[next++];
      song.genre = await readSongGenres(song.audioPath);
    }
  }));
  return songs;
}

module.exports = { normalizeGenres, getCachedGenres, readSongGenres, enrichSongGenres };
