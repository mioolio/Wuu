// Read embedded local genre tags without downloading data or modifying media.
const fs = require('fs');
const { parseFile } = require('music-metadata');

const genreCache = new Map();
const supportedAudio = /\.(aac|m4a|mp3|wav|flac|ogg)$/i;
const parseQueue = [];
let activeParses = 0;
let backgroundVersion = 0;

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

function validCacheEntry(audioPath) {
  const entry = genreCache.get(audioPath);
  if (!entry) return null;
  try {
    if (fileKey(fs.statSync(audioPath)) === entry.key) return entry;
  } catch (_) {}
  genreCache.delete(audioPath);
  return null;
}

function getCachedGenres(audioPath) {
  const entry = validCacheEntry(audioPath);
  return entry?.genres ? [...entry.genres] : [];
}

// One limit for background refreshes and callers that explicitly await tags.
function withParseSlot(task) {
  return new Promise(resolve => {
    parseQueue.push({ task, resolve });
    startQueuedParses();
  });
}

function startQueuedParses() {
  while (activeParses < 4 && parseQueue.length) {
    const { task, resolve } = parseQueue.shift();
    activeParses++;
    Promise.resolve().then(task).catch(() => []).then(resolve).finally(() => {
      activeParses--;
      startQueuedParses();
    });
  }
}

async function readSongGenres(audioPath) {
  if (!isSupported(audioPath)) return [];
  let stat;
  try { stat = await fs.promises.stat(audioPath); } catch (_) { genreCache.delete(audioPath); return []; }
  if (!stat.isFile()) { genreCache.delete(audioPath); return []; }
  const key = fileKey(stat);
  const cached = genreCache.get(audioPath);
  if (cached?.key === key) return [...await cached.pending];
  const entry = { key, genres: null, pending: null, published: false };
  genreCache.set(audioPath, entry);
  entry.pending = withParseSlot(async () => {
    try {
      // A queued read may have been superseded, or its file removed/replaced.
      const before = await fs.promises.stat(audioPath);
      if (genreCache.get(audioPath) !== entry || !before.isFile() || fileKey(before) !== key) {
        if (genreCache.get(audioPath) === entry) genreCache.delete(audioPath);
        return [];
      }
      const metadata = await parseFile(audioPath, { skipCovers: true, duration: false });
      const after = await fs.promises.stat(audioPath);
      if (genreCache.get(audioPath) !== entry || !after.isFile() || fileKey(after) !== key) {
        if (genreCache.get(audioPath) === entry) genreCache.delete(audioPath);
        return [];
      }
      entry.genres = normalizeGenres(metadata.common?.genre);
      return entry.genres;
    } catch (_) {
      // A failed read remains retryable on the next library refresh.
      if (genreCache.get(audioPath) === entry) genreCache.delete(audioPath);
      return [];
    }
  });
  return [...await entry.pending];
}

async function enrichSongGenres(songs) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, songs.length) }, async () => {
    while (next < songs.length) {
      const song = songs[next++];
      song.genre = await readSongGenres(song.audioPath);
    }
  }));
  return songs;
}

async function parseGenreUpdatesInBackground(songs, onUpdate) {
  const version = ++backgroundVersion;
  const present = new Set(songs.map(song => song.audioPath));
  for (const audioPath of genreCache.keys()) if (!present.has(audioPath)) genreCache.delete(audioPath);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, songs.length) }, async () => {
    while (version === backgroundVersion && next < songs.length) {
      const song = songs[next++];
      const { audioPath } = song;
      const cached = validCacheEntry(audioPath);
      if (cached?.genres) {
        // The list may have been copied while another scan was still reading.
        if (cached.published || (Array.isArray(song.genre) && song.genre.length === cached.genres.length && song.genre.every((label, index) => label === cached.genres[index]))) continue;
      } else await readSongGenres(audioPath);
      // A refresh supersedes its old queue; pending reads are shared with the new one.
      if (version !== backgroundVersion) return;
      const entry = validCacheEntry(audioPath);
      if (!entry || !entry.genres || entry.published) continue;
      entry.published = true;
      try { onUpdate({ audioPath, genre: [...entry.genres] }); } catch (_) {}
    }
  }));
}

module.exports = { normalizeGenres, getCachedGenres, readSongGenres, enrichSongGenres, parseGenreUpdatesInBackground };
