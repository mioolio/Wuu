// analyze_cached_song.js - 分析 LMDB 缓存中的歌曲完整结构
//
// 用法:
//   1. 先在汽水音乐中播放那首视频歌曲 (让它产生缓存)
//   2. 然后运行: node analyze_cached_song.js
//
// 会扫描 LMDB 中所有缓存, 找到包含关键词的歌曲, 输出完整缓存结构

import path from 'path';
// 引用 D:\Desktop\PPCe\re\frida\v4\ 下的 lmdb-src
import { open } from 'file:///f:/RMSCX/V/PPCe/re/frida/v4/lmdb-src/node-index.js';

const CACHE_DIR = 'C:\\Users\\mio.oim\\AppData\\Roaming\\SodaMusic\\LunaCacheV2';

// 搜索关键词 - 空数组表示输出所有歌曲完整结构
const SEARCH_KEYWORDS = [];

const entriesDB = open({
    path: path.join(CACHE_DIR, 'entries.db'),
    encoding: 'msgpack',
    keyEncoding: 'ordered-binary',
});

console.log('正在扫描 LMDB 缓存...\n');

let totalEntries = 0;
let matchedEntries = 0;
const allSongs = [];

for (const { key, value } of entriesDB.getRange()) {
    totalEntries++;
    const info = value.info || {};
    const mediaDetail = info.mediaDetail || {};
    const response = mediaDetail.response || {};
    const track = response.track || (response.data && response.data.track) || {};
    const video = response.video || (response.data && response.data.video) || {};

    const songName = track.name || video.title || '';
    const trackId = info.trackId || track.id || '';
    const spadeA = info.spade || '';

    // 把所有字段转成字符串用于搜索
    const searchable = JSON.stringify({ songName, trackId, spadeA, key, video_title: video.title, video_id: video.video_id || video.vid });

    // 检查是否匹配搜索关键词
    const matched = SEARCH_KEYWORDS.some(kw => searchable.toLowerCase().includes(kw.toLowerCase()));

    if (matched) {
        matchedEntries++;
        console.log('========================================');
        console.log('匹配 #' + matchedEntries);
        console.log('========================================');
        console.log('缓存 key:', JSON.stringify(key));
        console.log('歌曲名:', songName);
        console.log('trackId:', trackId);
        console.log('spade_a:', spadeA ? spadeA.substring(0, 60) + '...' : '(无)');

        // 输出完整 info 结构 (去掉过大的字段)
        const infoStr = JSON.stringify(info, (k, v) => {
            if (typeof v === 'string' && v.length > 200) return v.substring(0, 200) + '...(截断, 长度' + v.length + ')';
            return v;
        }, 2);
        console.log('\n--- info 完整结构 ---');
        console.log(infoStr);

        // 输出 response 的顶级字段
        console.log('\n--- response 顶级字段 ---');
        console.log('keys:', Object.keys(response));
        if (response.status_code) console.log('status_code:', response.status_code);
        if (response.status_info) console.log('status_info:', JSON.stringify(response.status_info));

        // 输出 track 的完整字段 (重点关注视频相关字段)
        if (Object.keys(track).length > 0) {
            console.log('\n--- track 字段 ---');
            console.log('keys:', Object.keys(track));
            console.log('track.id:', track.id);
            console.log('track.name:', track.name);
            console.log('track.duration:', track.duration);
            console.log('track.vid:', track.vid);
            console.log('track.media_type:', track.media_type);
            console.log('track.video_id:', track.video_id);
            if (track.video_meta) console.log('track.video_meta:', JSON.stringify(track.video_meta).substring(0, 500));
            if (track.album) console.log('track.album:', JSON.stringify(track.album).substring(0, 200));
            if (track.artists) console.log('track.artists:', JSON.stringify(track.artists).substring(0, 200));
            if (track.bit_rates) console.log('track.bit_rates:', JSON.stringify(track.bit_rates).substring(0, 300));
        }

        // 输出 video 的完整字段 (关键! 真正的视频类型歌曲可能在这里)
        if (Object.keys(video).length > 0) {
            console.log('\n--- video 字段 (真正的视频?) ---');
            console.log('keys:', Object.keys(video));
            console.log('video 完整:', JSON.stringify(video, null, 2).substring(0, 3000));
        }

        // 输出 track_player 结构 (UGC 创作歌曲, 包含 spade_a 和解密信息)
        const trackPlayer = response.track_player || mediaDetail.trackPlayer || {};
        if (Object.keys(trackPlayer).length > 0) {
            console.log('\n--- track_player 字段 (UGC 创作) ---');
            console.log('keys:', Object.keys(trackPlayer));
            if (trackPlayer.video_model) {
                const tpVm = typeof trackPlayer.video_model === 'string'
                    ? JSON.parse(trackPlayer.video_model)
                    : trackPlayer.video_model;
                console.log('video_model keys:', Object.keys(tpVm));
                console.log('video_model spade_a:', tpVm?.video_list?.[0]?.encrypt_info?.spade_a ? String(tpVm.video_list[0].encrypt_info.spade_a).substring(0, 60) + '...' : '(无)');
            }
        }

        // 输出 player_infos 结构 (真正视频类型, 数组结构!)
        const playerInfos = response.player_infos || [];
        if (Array.isArray(playerInfos) && playerInfos.length > 0) {
            console.log('\n--- player_infos 字段 (真正视频!) ---');
            console.log('player_infos 数组长度:', playerInfos.length);
            const pi0 = playerInfos[0];
            console.log('player_infos[0] keys:', Object.keys(pi0));
            console.log('player_infos[0].media_id:', pi0.media_id);
            console.log('player_infos[0].video_model_type:', pi0.video_model_type);
            console.log('player_infos[0].url_player_info:', pi0.url_player_info ? pi0.url_player_info.substring(0, 200) + '...(截断)' : '(无)');

            // 解析 video_model JSON 字符串, 输出 video_list 结构
            if (pi0.video_model) {
                try {
                    const vm = typeof pi0.video_model === 'string'
                        ? JSON.parse(pi0.video_model)
                        : pi0.video_model;
                    console.log('\n--- player_infos[0].video_model 解析后 ---');
                    console.log('video_model keys:', Object.keys(vm));
                    console.log('video_model.video_id:', vm.video_id);
                    console.log('video_model.media_type:', vm.media_type);
                    console.log('video_model.video_duration:', vm.video_duration);

                    const vlist = Array.isArray(vm.video_list) ? vm.video_list : [];
                    console.log('video_list 长度:', vlist.length);
                    vlist.forEach((item, idx) => {
                        console.log('\n  video_list[' + idx + ']:');
                        console.log('    keys:', Object.keys(item));
                        console.log('    main_url:', item.main_url ? item.main_url.substring(0, 150) + '...(截断, 长度' + item.main_url.length + ')' : '(无)');
                        console.log('    backup_url:', item.backup_url ? '有' : '(无)');
                        const vm2 = item.video_meta || {};
                        console.log('    video_meta keys:', Object.keys(vm2));
                        console.log('    video_meta.quality:', vm2.quality);
                        console.log('    video_meta.vtype:', vm2.vtype);
                        console.log('    video_media.size:', vm2.size);
                        console.log('    video_meta.is_vip:', vm2.is_vip);
                        console.log('    video_meta.bit_rate:', vm2.bit_rate);
                        const ei = item.encrypt_info || {};
                        console.log('    encrypt_info keys:', Object.keys(ei));
                        console.log('    encrypt_info.spade_a:', ei.spade_a ? String(ei.spade_a).substring(0, 60) + '...(截断, 长度' + ei.spade_a.length + ')' : '(无)');
                        console.log('    encrypt_info.need_vip:', ei.need_vip);
                    });
                } catch (e) {
                    console.log('video_model 解析失败:', e.message);
                }
            }
        }

        // 输出 value 的其他字段
        console.log('\n--- value 顶级字段 ---');
        console.log('keys:', Object.keys(value));
        console.log('value.size:', value.size);

        console.log('\n');
    }

    // 收集所有歌曲的基本信息用于统计
    if (songName || trackId) {
        allSongs.push({
            songName,
            trackId: String(trackId),
            spade_a: spadeA ? spadeA.substring(0, 20) + '...' : '',
            hasVideo: Object.keys(video).length > 0,
            hasTrack: Object.keys(track).length > 0,
            responseKeys: Object.keys(response),
        });
    }
}

console.log('\n========================================');
console.log('扫描完成');
console.log('  总缓存条目:', totalEntries);
console.log('  匹配条目:', matchedEntries);
console.log('  有歌曲信息的条目:', allSongs.length);
console.log('========================================\n');

// 输出所有歌曲的简要列表
console.log('--- 所有缓存歌曲列表 ---');
for (const s of allSongs) {
    const flags = [
        s.hasTrack ? 'T' : '-',
        s.hasVideo ? 'V' : '-',
    ].join('');
    console.log(`[${flags}] ${s.songName || '(无名)'} | trackId=${s.trackId} | spade=${s.spade_a || '(无)'} | respKeys=${s.responseKeys.join(',')}`);
}

entriesDB.close();
