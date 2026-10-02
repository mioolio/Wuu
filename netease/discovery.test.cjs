const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fetchDiscoveryCandidates } = require('./discovery');

const raw = (id, fee = 0, extra = {}) => ({ id, name: `歌曲${id}`, fee, ar: [{ name: '艺人一' }, { name: '艺人二' }], al: { name: '真实专辑', picUrl: 'https://example.com/cover.jpg' }, dt: 123000, ...extra });
const response = songs => ({ body: { code: 200, songs, privileges: songs.filter(Boolean).map(song => ({ id: song.id, st: 0 })) } });

test('uses public hot playlists without credentials; maps actual metadata and deduplicates IDs', async () => {
  const calls = [];
  const original = raw(42);
  const api = {
    top_playlist: async options => { calls.push(['catalog', options]);return { body: { code: 200, playlists: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] } }; },
    playlist_track_all: async options => { calls.push(['tracks', options]);return response([original, raw(43, 8)]); },
  };
  const result = await fetchDiscoveryCandidates(api, { page: 9 }, { random: () => .99 });
  assert.equal(result.length, 2);
  assert.deepEqual(result.find(song => song.id === '42'), { id: '42', source: 'netease', name: '歌曲42', artist: '艺人一, 艺人二', album: '真实专辑', cover: 'https://example.com/cover.jpg', duration: 123000, fee: 0, _raw: original });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0][1], { cat: '流行', order: 'hot', limit: 20, offset: 20, cookie: '' });
  assert.ok(calls.every(([, options]) => options.cookie === ''));
  assert.ok(calls.slice(1).every(([, options]) => options.limit === 80 && options.offset === 0));
  assert.ok(result.every(song => !song.genre)); // A playlist category is not a song genre.
});

test('rejects VIP/paid/unavailable or malformed entries without inventing metadata', async () => {
  const api = {
    top_playlist: async () => ({ body: { code: 200, playlists: [{ id: 1 }] } }),
    playlist_track_all: async () => ({ body: { code: 200,
      songs: [raw(1), raw(2, 1), raw(3, 4), raw(4, 0), raw(5, 0, { ar: [] }), raw(6, 0, { ar: {} }), null],
      privileges: [{ id: 4, st: -200 }],
    } }),
  };
  assert.deepEqual((await fetchDiscoveryCandidates(api)).map(song => song.id), ['1']);
});

test('uses successful public playlists when another selected playlist fails', async () => {
  const api = {
    top_playlist: async () => ({ body: { code: 200, playlists: [{ id: 1 }, { id: 2 }] } }),
    playlist_track_all: async ({ id }) => { if (id === 1) throw new Error('一个歌单网络失败');return response([raw(99)]); },
  };
  assert.equal((await fetchDiscoveryCandidates(api))[0].id, '99');
});

test('returns clear failures for provider status, empty sources and empty tracks', async () => {
  await assert.rejects(fetchDiscoveryCandidates({ top_playlist: async () => ({ body: { code: 503, message: '目录暂不可用' } }) }), /目录暂不可用/);
  await assert.rejects(fetchDiscoveryCandidates({ top_playlist: async () => ({ body: { code: 200, playlists: [] } }) }), /没有返回曲目来源/);
  await assert.rejects(fetchDiscoveryCandidates({ top_playlist: async () => ({ body: { code: 200, playlists: [{ id: 1 }] } }), playlist_track_all: async () => response([]) }), /没有可用的免费曲目/);
});

test('bounds both catalog and track request latency', async () => {
  const pending = () => new Promise(() => {});
  await assert.rejects(fetchDiscoveryCandidates({ top_playlist: pending }, {}, { timeoutMs: 10 }), /请求超时/);
  await assert.rejects(fetchDiscoveryCandidates({ top_playlist: async () => ({ body: { code: 200, playlists: [{ id: 1 }] } }), playlist_track_all: pending }, {}, { timeoutMs: 10 }), /请求超时/);
});
