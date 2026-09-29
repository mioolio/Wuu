const { baseUrl, fixed, endpoints } = require('./qishui-auth')
const { downloadTrackMedia } = require('./track-download')
const { getSessionIdFromSodaMusicCookies } = require('./sodamusic-cookie')
const { TrackDecryptor } = require('./track-decryptor')

module.exports = {
  baseUrl,
  fixed,
  endpoints,
  downloadTrackMedia,
  getSessionIdFromSodaMusicCookies,
  TrackDecryptor,
}
