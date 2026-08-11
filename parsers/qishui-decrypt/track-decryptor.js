const { Mp4Box } = require('./mp4-box')
const {
  aesCtrDecrypt,
  decryptSpadeA,
  hexToBuffer,
  parseSenc,
  parseStsc,
  parseStsz,
  replaceEncaWithMp4a,
  sanitizeFilenamePart,
  scanForFlacMetadata,
} = require('./decrypt-utils')

class TrackDecryptor {
  resolveKey(spadeA) {
    if (!spadeA) {
      throw new Error('spade_a is required for decryption.')
    }

    const isHex = /^[0-9a-fA-F]+$/.test(spadeA)
    const keyHex = isHex ? spadeA : decryptSpadeA(spadeA)

    if (!keyHex) {
      throw new Error('Failed to resolve decryption key from spade_a.')
    }

    // 诊断: key 解析结果 (isHex 表示 spade_a 已经是明文 hex, 否则经过了 decryptSpadeA 解密)
    console.log('[QISHUI][decrypt-diag] resolveKey spadeA_isHex=' + isHex + ' keyHex=' + keyHex + ' keyLen=' + (keyHex.length / 2))

    return hexToBuffer(keyHex)
  }

  // 根据样本总数 + stsc(chunk 内样本分布) + stco(chunk 文件偏移)
  // 重建每个样本在文件中的精确偏移, 跳过每个 chunk 开头的 encd 盒头
  // 加密 m4a 的 chunk 实际数据并不紧跟在 mdat body 起始处,
  // 而是在 stco 指定的文件偏移处, 偏移前可能有 encd 盒头(加密元信息)
  buildSampleOffsets(sampleSizes, stscEntries, chunkOffsets) {
    const offsets = new Array(sampleSizes.length)
    let sampleIdx = 0
    for (let c = 0; c < chunkOffsets.length; c++) {
      const chunkFileOffset = chunkOffsets[c]
      // 找到当前 chunk 对应的 samplesPerChunk (stsc 表按 firstChunk 递增)
      let samplesPerChunk = 0
      for (let s = stscEntries.length - 1; s >= 0; s--) {
        if (c + 1 >= stscEntries[s].firstChunk) {
          samplesPerChunk = stscEntries[s].samplesPerChunk
          break
        }
      }
      let off = chunkFileOffset
      for (let i = 0; i < samplesPerChunk && sampleIdx < sampleSizes.length; i++) {
        offsets[sampleIdx] = off
        off += sampleSizes[sampleIdx]
        sampleIdx++
      }
    }
    return offsets
  }

  decryptSampleList({ fileBuffer, key, sampleSizes, ivs, mdatOffset, stscEntries, chunkOffsets }) {
    const decryptedSamples = []
    // 用 stco + stsc 重建每个 sample 的精确偏移, 跳过 chunk 开头的 encd 盒头
    const sampleOffsets = chunkOffsets && chunkOffsets.length
      ? this.buildSampleOffsets(sampleSizes, stscEntries, chunkOffsets)
      : null

    for (let index = 0; index < sampleSizes.length; index += 1) {
      const size = sampleSizes[index]
      const iv = ivs[index]

      if (!iv) {
        throw new Error(`Missing IV for sample ${index}.`)
      }

      // 优先用 stco 重建的偏移; 无 stco 时回退到旧的顺序偏移逻辑
      const sampleOffset = sampleOffsets ? sampleOffsets[index] : (mdatOffset + 8 + decryptedSamples.reduce((acc, s) => acc + s.length, 0))
      const encrypted = fileBuffer.subarray(sampleOffset, sampleOffset + size)
      decryptedSamples.push(aesCtrDecrypt(key, iv, encrypted))
    }

    return decryptedSamples
  }

  buildFlacFile(flacMetadata, decryptedSamples) {
    const flacSignature = Buffer.from('fLaC')
    const metadataBody = flacMetadata.length > 4
      ? flacMetadata.subarray(4)
      : flacMetadata

    return Buffer.concat([flacSignature, metadataBody, ...decryptedSamples])
  }

  buildM4aFile(fileBuffer, decryptedSamples, mdat, stsd, sampleOffsets) {
    const output = Buffer.from(fileBuffer)

    if (sampleOffsets) {
      // 用 stco 重建的偏移写回原位置, 保持 stco 指向正确
      // (处理 mdat 内有 encd 盒头的情况: stco 指向 encd 之后的数据,
      //  若从 mdat+8 顺序写入会导致数据前移, 与 stco 指向不符 → 解码失败)
      for (let i = 0; i < decryptedSamples.length; i += 1) {
        decryptedSamples[i].copy(output, sampleOffsets[i])
      }
    } else {
      // 无 stco 时回退到顺序写入
      let writePointer = mdat.offset + 8
      for (const sample of decryptedSamples) {
        sample.copy(output, writePointer)
        writePointer += sample.length
      }
    }

    replaceEncaWithMp4a(output, stsd.offset, stsd.offset + stsd.size)
    return output
  }

  createFileName({ title, artist, extension }) {
    const safeTitle = sanitizeFilenamePart(title, 'track')
    const safeArtist = sanitizeFilenamePart(artist, 'unknown')
    return `${safeTitle} - ${safeArtist}${extension}`
  }

  decrypt({ encryptedBuffer, spadeA, media = {} }) {
    if (!Buffer.isBuffer(encryptedBuffer) || encryptedBuffer.length === 0) {
      throw new Error('encryptedBuffer must be a non-empty Buffer.')
    }

    const key = this.resolveKey(spadeA)

    const moov = Mp4Box.findBox(encryptedBuffer, 'moov')
    if (moov.isEmpty()) {
      throw new Error("Decrypt failed: 'moov' atom not found.")
    }

    const trak = Mp4Box.findBox(encryptedBuffer, 'trak', moov.offset + 8, moov.offset + moov.size)
    const mdia = Mp4Box.findBox(encryptedBuffer, 'mdia', trak.offset + 8, trak.offset + trak.size)
    const minf = Mp4Box.findBox(encryptedBuffer, 'minf', mdia.offset + 8, mdia.offset + mdia.size)
    const stbl = Mp4Box.findBox(encryptedBuffer, 'stbl', minf.offset + 8, minf.offset + minf.size)
    const stsd = Mp4Box.findBox(encryptedBuffer, 'stsd', stbl.offset + 8, stbl.offset + stbl.size)
    const stsz = Mp4Box.findBox(encryptedBuffer, 'stsz', stbl.offset + 8, stbl.offset + stbl.size)
    const stsc = Mp4Box.findBox(encryptedBuffer, 'stsc', stbl.offset + 8, stbl.offset + stbl.size)
    const stco = Mp4Box.findBox(encryptedBuffer, 'stco', stbl.offset + 8, stbl.offset + stbl.size)

    let senc = Mp4Box.findBox(encryptedBuffer, 'senc', moov.offset + 8, moov.offset + moov.size)
    if (senc.isEmpty()) {
      senc = Mp4Box.findBox(encryptedBuffer, 'senc', stbl.offset + 8, stbl.offset + stbl.size)
    }

    if (senc.isEmpty()) {
      throw new Error("Decrypt failed: 'senc' atom not found.")
    }

    const mdat = Mp4Box.findBox(encryptedBuffer, 'mdat')
    if (mdat.isEmpty()) {
      throw new Error("Decrypt failed: 'mdat' atom not found.")
    }

    const flacMetadata = scanForFlacMetadata(stsd.data)
    const isFlac = flacMetadata.length > 0

    const sampleSizes = parseStsz(stsz.data)
    const stscEntries = parseStsc(stsc.data)
    const chunkCount = stco.data.readUInt32BE(4)
    // 解析所有 chunk 的文件偏移 (stco: count + N x uint32)
    const chunkOffsets = []
    for (let i = 0; i < chunkCount; i++) {
      chunkOffsets.push(stco.data.readUInt32BE(8 + i * 4))
    }
    const ivs = parseSenc(senc.data)

    if (sampleSizes.length !== ivs.length) {
      throw new Error(`Decrypt failed: sample count ${sampleSizes.length} does not match iv count ${ivs.length}.`)
    }

    // 诊断: sample 表与 IV 对齐情况
    console.log('[QISHUI][decrypt-diag] sampleCount=' + sampleSizes.length + ' ivCount=' + ivs.length + ' isFlac=' + isFlac + ' chunkCount=' + chunkCount)
    console.log('[QISHUI][decrypt-diag] first3SampleSizes=' + JSON.stringify(sampleSizes.slice(0, 3)))
    console.log('[QISHUI][decrypt-diag] first3IVs=' + JSON.stringify(ivs.slice(0, 3).map(iv => iv.toString('hex'))))
    console.log('[QISHUI][decrypt-diag] mdat.offset=' + mdat.offset + ' mdat.size=' + mdat.size)
    // 加密状态下 mdat 前 128 字节 (解密前)
    const encMdatHead128 = encryptedBuffer.subarray(mdat.offset + 8, mdat.offset + 8 + 128)
    console.log('[QISHUI][decrypt-diag] encryptedMdatHead128=' + encMdatHead128.toString('hex'))
    // stsd 里是否包含 enca (未替换前)
    const stsdHasEnca = stsd.data.toString('latin1').includes('enca')
    console.log('[QISHUI][decrypt-diag] stsdHasEnca=' + stsdHasEnca + ' stsdSize=' + stsd.size)
    // 诊断: stsc 表 (每个 chunk 包含多少 sample)
    console.log('[QISHUI][decrypt-diag] stscEntries=' + JSON.stringify(stscEntries))
    console.log('[QISHUI][decrypt-diag] chunkOffsets=' + JSON.stringify(chunkOffsets))
    for (let i = 0; i < Math.min(chunkOffsets.length, 5); i++) {
      const coff = chunkOffsets[i]
      const chunkHead = encryptedBuffer.subarray(coff, coff + 32)
      console.log('[QISHUI][decrypt-diag] chunk[' + i + '] offset=' + coff + ' head=' + chunkHead.toString('hex'))
    }

    const decryptedSamples = this.decryptSampleList({
      fileBuffer: encryptedBuffer,
      key,
      sampleSizes,
      ivs,
      mdatOffset: mdat.offset,
      stscEntries,
      chunkOffsets,
    })

    // 诊断: 解密后第一个样本的前 32 字节 (判断是否为有效 AAC 帧)
    if (decryptedSamples.length > 0) {
      const firstSample = decryptedSamples[0]
      console.log('[QISHUI][decrypt-diag] decryptedSample0 size=' + firstSample.length + ' head=' + firstSample.subarray(0, Math.min(32, firstSample.length)).toString('hex'))
    }

    // 重新计算 sampleOffsets 传给 buildM4aFile, 用 stco 偏移原位置写回
    // (mdat 内有 encd 盒头时, stco 指向 encd 之后; 必须用 stco 偏移写回而非 mdat+8)
    const sampleOffsetsForWrite = chunkOffsets && chunkOffsets.length
      ? this.buildSampleOffsets(sampleSizes, stscEntries, chunkOffsets)
      : null

    const outputBuffer = isFlac
      ? this.buildFlacFile(flacMetadata, decryptedSamples)
      : this.buildM4aFile(encryptedBuffer, decryptedSamples, mdat, stsd, sampleOffsetsForWrite)

    const extension = isFlac ? '.flac' : '.m4a'

    // 诊断: enca 是否被成功替换为 mp4a
    if (!isFlac) {
      const outputStsdHasEnca = outputBuffer.toString('latin1', stsd.offset, stsd.offset + stsd.size).includes('enca')
      console.log('[QISHUI][decrypt-diag] afterReplace outputStsdHasEnca=' + outputStsdHasEnca)
      // 解密后 mdat 头 (最终写入文件的数据)
      const decMdatHead = outputBuffer.subarray(mdat.offset + 8, mdat.offset + 8 + 32)
      console.log('[QISHUI][decrypt-diag] decryptedMdatHead=' + decMdatHead.toString('hex'))
    }

    return {
      buffer: outputBuffer,
      extension,
      fileName: this.createFileName({
        title: media.title,
        artist: media.artist,
        extension,
      }),
      meta: {
        isFlac,
        sampleCount: sampleSizes.length,
        chunkCount,
      },
    }
  }
}

module.exports = {
  TrackDecryptor,
}
