// =========== 网易云 weapi 加密工具 ===========
// 网易云音乐 Web API 使用 weapi 加密: AES-CBC + RSA
// 移植自 NeteaseCloudMusicApi 等开源项目

const crypto = require('crypto');

// 固定密钥与 IV (网易云公开的)
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud', 'utf-8');
const iv = Buffer.from('0102030405060708', 'utf-8');
const publicKey = '010001';
const modulus = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';

// 随机生成长度为 16 的字符串
function createSecretKey(size = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < size; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

// AES-CBC 加密
function aesEncrypt(plaintext, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]).toString('base64');
}

// RSA 加密 (反向拼接, 网易云特殊处理)
function rsaEncrypt(text, pubKey, mod) {
  const textReverse = text.split('').reverse().join('');
  const n = BigInt('0x' + mod);
  const e = BigInt('0x' + pubKey);
  let base = BigInt('0x' + Buffer.from(textReverse, 'utf-8').toString('hex'));
  let result = base ** e % n;
  return result.toString(16).padStart(256, '0');
}

// weapi 加密: 两层 AES + RSA
function weapi(object) {
  const text = JSON.stringify(object);
  const secretKey = createSecretKey(16);
  return {
    params: aesEncrypt(aesEncrypt(text, presetKey), Buffer.from(secretKey, 'utf-8')),
    encSecKey: rsaEncrypt(secretKey, publicKey, modulus),
  };
}

// eapi 加密 (另一种加密方式, 用于部分接口)
const eapiKey = Buffer.from('e82ckenh8dichen8', 'utf-8');
function eapi(url, object) {
  const text = typeof object === 'string' ? object : JSON.stringify(object);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = crypto.createHash('md5').update(message, 'utf-8').digest('hex');
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', eapiKey, '');
  return Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]).toString('hex');
}

module.exports = { weapi, eapi, createSecretKey };
