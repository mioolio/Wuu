// =========== 歌曲扫描 Worker ===========
// 在子线程中执行文件系统扫描, 避免阻塞 Electron 主进程
// 主线程通过 parentPort.postMessage 触发扫描, worker 返回结果
const { parentPort } = require('worker_threads');
const path = require('path');

// worker 内部独立实现扫描逻辑 (不依赖 scanner.js 的 IPC 注册, 避免副作用)
const fs = require('fs');

function scanMusicFiles() {
  const outputDir = path.join(__dirname, '..', 'output');
  const songs = [];
  if (!fs.existsSync(outputDir)) return songs;

  const audioExtRegex = /\.(aac|m4a|mp3|wav|flac|ogg)$/i;

  const folders = fs.readdirSync(outputDir);
  for (const folder of folders) {
    const folderPath = path.join(outputDir, folder);
    let stat;
    try { stat = fs.statSync(folderPath); } catch (e) { continue; }
    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(folderPath);
    const audioFile = files.find(f => audioExtRegex.test(f) && !/\.enc\./i.test(f));
    if (!audioFile) continue;

    const lrcFile = files.find(f => f.endsWith('.lrc'));
    const rawFile = files.find(f => f === 'lyrics_raw.txt');
    const coverFile = files.find(f => f === 'cover.jpg' || f === 'cover.png' || f === 'cover.webp');
    const infoFile = files.find(f => f === 'info.json');

    const ext = path.extname(audioFile);
    let songName = path.basename(audioFile, ext);
    let artist = '未知艺人';
    let album = '';
    let realDuration = 0;
    let lyricist = '';
    let composer = '';

    // 读取 info.json
    if (infoFile) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(folderPath, infoFile), 'utf-8'));
        songName = info.title || info.songName || songName;
        artist = info.artist || '未知艺人';
        album = info.album || '';
        realDuration = typeof info.duration === 'number' ? info.duration : 0;
        lyricist = info.lyricist || '';
        composer = info.composer || '';
      } catch (e) {}
    }

    songs.push({
      id: songs.length,
      songName,
      artist,
      album,
      audioPath: path.join(folderPath, audioFile),
      lrcPath: lrcFile ? path.join(folderPath, lrcFile) : null,
      rawPath: rawFile ? path.join(folderPath, rawFile) : null,
      coverPath: coverFile ? path.join(folderPath, coverFile) : null,
      realDuration,
      lyricist,
      composer,
    });
  }

  return songs;
}

// 监听主线程消息: { type: 'scan' } 触发扫描
parentPort.on('message', (msg) => {
  if (msg && msg.type === 'scan') {
    try {
      const songs = scanMusicFiles();
      parentPort.postMessage({ type: 'scan-result', ok: true, songs });
    } catch (e) {
      parentPort.postMessage({ type: 'scan-result', ok: false, error: e.message });
    }
  }
});
