const path = require('node:path');
const express = require('express');
const decode = require('safe-decode-uri-component');
const { cookieToJson, randomString, getGuid, calculateMid } = require('./util/util');
const { cryptoMd5 } = require('./util/crypto');
const { createRequest } = require('./util/request');
const cache = require('./util/apicache').middleware;

const module_yueku_fm = require('./module/yueku_fm.js');
const module_yueku_banner = require('./module/yueku_banner.js');
const module_yueku = require('./module/yueku.js');
const module_youth_vip = require('./module/youth_vip.js');
const module_youth_user_song = require('./module/youth_user_song.js');
const module_youth_union_vip = require('./module/youth_union_vip.js');
const module_youth_month_vip_record = require('./module/youth_month_vip_record.js');
const module_youth_listen_song = require('./module/youth_listen_song.js');
const module_youth_dynamic_recent = require('./module/youth_dynamic_recent.js');
const module_youth_dynamic = require('./module/youth_dynamic.js');
const module_youth_day_vip_upgrade = require('./module/youth_day_vip_upgrade.js');
const module_youth_day_vip = require('./module/youth_day_vip.js');
const module_youth_channel_sub = require('./module/youth_channel_sub.js');
const module_youth_channel_song_detail = require('./module/youth_channel_song_detail.js');
const module_youth_channel_song = require('./module/youth_channel_song.js');
const module_youth_channel_similar = require('./module/youth_channel_similar.js');
const module_youth_channel_detail = require('./module/youth_channel_detail.js');
const module_youth_channel_amway = require('./module/youth_channel_amway.js');
const module_youth_channel_all = require('./module/youth_channel_all.js');
const module_video_url = require('./module/video_url.js');
const module_video_privilege = require('./module/video_privilege.js');
const module_video_detail = require('./module/video_detail.js');
const module_user_vip_detail = require('./module/user_vip_detail.js');
const module_user_video_love = require('./module/user_video_love.js');
const module_user_video_collect = require('./module/user_video_collect.js');
const module_user_playlist = require('./module/user_playlist.js');
const module_user_listen = require('./module/user_listen.js');
const module_user_history = require('./module/user_history.js');
const module_user_follow = require('./module/user_follow.js');
const module_user_detail = require('./module/user_detail.js');
const module_user_cloud_url = require('./module/user_cloud_url.js');
const module_user_cloud = require('./module/user_cloud.js');
const module_top_song = require('./module/top_song.js');
const module_top_playlist = require('./module/top_playlist.js');
const module_top_ip = require('./module/top_ip.js');
const module_top_card_youth = require('./module/top_card_youth.js');
const module_top_card = require('./module/top_card.js');
const module_top_album = require('./module/top_album.js');
const module_theme_playlist_track = require('./module/theme_playlist_track.js');
const module_theme_playlist = require('./module/theme_playlist.js');
const module_theme_music_detail = require('./module/theme_music_detail.js');
const module_theme_music = require('./module/theme_music.js');
const module_song_url_new = require('./module/song_url_new.js');
const module_song_url = require('./module/song_url.js');
const module_song_ranking_filter = require('./module/song_ranking_filter.js');
const module_song_ranking = require('./module/song_ranking.js');
const module_song_climax = require('./module/song_climax.js');
const module_singer_list = require('./module/singer_list.js');
const module_sheet_list = require('./module/sheet_list.js');
const module_sheet_hot = require('./module/sheet_hot.js');
const module_sheet_detail = require('./module/sheet_detail.js');
const module_sheet_collection_detail = require('./module/sheet_collection_detail.js');
const module_sheet_collection = require('./module/sheet_collection.js');
const module_server_now = require('./module/server_now.js');
const module_search_suggest = require('./module/search_suggest.js');
const module_search_mixed = require('./module/search_mixed.js');
const module_search_lyric = require('./module/search_lyric.js');
const module_search_hot = require('./module/search_hot.js');
const module_search_default = require('./module/search_default.js');
const module_search_complex = require('./module/search_complex.js');
const module_search = require('./module/search.js');
const module_scene_video_list = require('./module/scene_video_list.js');
const module_scene_music = require('./module/scene_music.js');
const module_scene_module_info = require('./module/scene_module_info.js');
const module_scene_module = require('./module/scene_module.js');
const module_scene_lists_v2 = require('./module/scene_lists_v2.js');
const module_scene_lists = require('./module/scene_lists.js');
const module_scene_collection_list = require('./module/scene_collection_list.js');
const module_scene_audio_list = require('./module/scene_audio_list.js');
const module_register_dev = require('./module/register_dev.js');
const module_recommend_songs = require('./module/recommend_songs.js');
const module_rank_vol = require('./module/rank_vol.js');
const module_rank_top = require('./module/rank_top.js');
const module_rank_list = require('./module/rank_list.js');
const module_rank_info = require('./module/rank_info.js');
const module_rank_audio = require('./module/rank_audio.js');
const module_privilege_lite = require('./module/privilege_lite.js');
const module_playlist_track_all_new = require('./module/playlist_track_all_new.js');
const module_playlist_track_all = require('./module/playlist_track_all.js');
const module_playlist_tracks_del = require('./module/playlist_tracks_del.js');
const module_playlist_tracks_add = require('./module/playlist_tracks_add.js');
const module_playlist_tags = require('./module/playlist_tags.js');
const module_playlist_similar = require('./module/playlist_similar.js');
const module_playlist_effect = require('./module/playlist_effect.js');
const module_playlist_detail = require('./module/playlist_detail.js');
const module_playlist_del = require('./module/playlist_del.js');
const module_playlist_add = require('./module/playlist_add.js');
const module_playhistory_upload = require('./module/playhistory_upload.js');
const module_personal_fm = require('./module/personal_fm.js');
const module_pc_diantai = require('./module/pc_diantai.js');
const module_lyric = require('./module/lyric.js');
const module_longaudio_week_recommend = require('./module/longaudio_week_recommend.js');
const module_longaudio_vip_recommend = require('./module/longaudio_vip_recommend.js');
const module_longaudio_rank_recommend = require('./module/longaudio_rank_recommend.js');
const module_longaudio_daily_recommend = require('./module/longaudio_daily_recommend.js');
const module_longaudio_album_detail = require('./module/longaudio_album_detail.js');
const module_longaudio_album_audios = require('./module/longaudio_album_audios.js');
const module_login_wx_create = require('./module/login_wx_create.js');
const module_login_wx_check = require('./module/login_wx_check.js');
const module_login_token = require('./module/login_token.js');
const module_login_qr_key = require('./module/login_qr_key.js');
const module_login_qr_create = require('./module/login_qr_create.js');
const module_login_qr_check = require('./module/login_qr_check.js');
const module_login_openplat = require('./module/login_openplat.js');
const module_login_device = require('./module/login_device.js');
const module_login_cellphone = require('./module/login_cellphone.js');
const module_login = require('./module/login.js');
const module_lastest_songs_listen = require('./module/lastest_songs_listen.js');
const module_krm_audio = require('./module/krm_audio.js');
const module_kmr_audio_mv = require('./module/kmr_audio_mv.js');
const module_ip_zone_home = require('./module/ip_zone_home.js');
const module_ip_zone = require('./module/ip_zone.js');
const module_ip_playlist = require('./module/ip_playlist.js');
const module_ip_dateil = require('./module/ip_dateil.js');
const module_ip = require('./module/ip.js');
const module_images_audio = require('./module/images_audio.js');
const module_images = require('./module/images.js');
const module_fm_songs = require('./module/fm_songs.js');
const module_fm_recommend = require('./module/fm_recommend.js');
const module_fm_image = require('./module/fm_image.js');
const module_fm_class = require('./module/fm_class.js');
const module_favorite_count = require('./module/favorite_count.js');
const module_everyday_style_recommend = require('./module/everyday_style_recommend.js');
const module_everyday_recommend = require('./module/everyday_recommend.js');
const module_everyday_history = require('./module/everyday_history.js');
const module_everyday_friend = require('./module/everyday_friend.js');
const module_comment_playlist = require('./module/comment_playlist.js');
const module_comment_music_hotword = require('./module/comment_music_hotword.js');
const module_comment_music_classify = require('./module/comment_music_classify.js');
const module_comment_music = require('./module/comment_music.js');
const module_comment_floor = require('./module/comment_floor.js');
const module_comment_count = require('./module/comment_count.js');
const module_comment_album = require('./module/comment_album.js');
const module_captcha_sent = require('./module/captcha_sent.js');
const module_brush = require('./module/brush.js');
const module_audio_related = require('./module/audio_related.js');
const module_audio_ktv_total = require('./module/audio_ktv_total.js');
const module_audio_accompany_matching = require('./module/audio_accompany_matching.js');
const module_audio = require('./module/audio.js');
const module_artist_videos = require('./module/artist_videos.js');
const module_artist_unfollow = require('./module/artist_unfollow.js');
const module_artist_lists = require('./module/artist_lists.js');
const module_artist_honour = require('./module/artist_honour.js');
const module_artist_follow_newsongs = require('./module/artist_follow_newsongs.js');
const module_artist_follow = require('./module/artist_follow.js');
const module_artist_detail = require('./module/artist_detail.js');
const module_artist_audios = require('./module/artist_audios.js');
const module_artist_albums = require('./module/artist_albums.js');
const module_album_songs = require('./module/album_songs.js');
const module_album_shop = require('./module/album_shop.js');
const module_album_detail = require('./module/album_detail.js');
const module_album = require('./module/album.js');
const module_ai_recommend = require('./module/ai_recommend.js');

const staticModuleDefs = [
  { identifier: 'yueku_fm', route: '/yueku/fm', module: module_yueku_fm },
  { identifier: 'yueku_banner', route: '/yueku/banner', module: module_yueku_banner },
  { identifier: 'yueku', route: '/yueku', module: module_yueku },
  { identifier: 'youth_vip', route: '/youth/vip', module: module_youth_vip },
  { identifier: 'youth_user_song', route: '/youth/user/song', module: module_youth_user_song },
  { identifier: 'youth_union_vip', route: '/youth/union/vip', module: module_youth_union_vip },
  { identifier: 'youth_month_vip_record', route: '/youth/month/vip/record', module: module_youth_month_vip_record },
  { identifier: 'youth_listen_song', route: '/youth/listen/song', module: module_youth_listen_song },
  { identifier: 'youth_dynamic_recent', route: '/youth/dynamic/recent', module: module_youth_dynamic_recent },
  { identifier: 'youth_dynamic', route: '/youth/dynamic', module: module_youth_dynamic },
  { identifier: 'youth_day_vip_upgrade', route: '/youth/day/vip/upgrade', module: module_youth_day_vip_upgrade },
  { identifier: 'youth_day_vip', route: '/youth/day/vip', module: module_youth_day_vip },
  { identifier: 'youth_channel_sub', route: '/youth/channel/sub', module: module_youth_channel_sub },
  { identifier: 'youth_channel_song_detail', route: '/youth/channel/song/detail', module: module_youth_channel_song_detail },
  { identifier: 'youth_channel_song', route: '/youth/channel/song', module: module_youth_channel_song },
  { identifier: 'youth_channel_similar', route: '/youth/channel/similar', module: module_youth_channel_similar },
  { identifier: 'youth_channel_detail', route: '/youth/channel/detail', module: module_youth_channel_detail },
  { identifier: 'youth_channel_amway', route: '/youth/channel/amway', module: module_youth_channel_amway },
  { identifier: 'youth_channel_all', route: '/youth/channel/all', module: module_youth_channel_all },
  { identifier: 'video_url', route: '/video/url', module: module_video_url },
  { identifier: 'video_privilege', route: '/video/privilege', module: module_video_privilege },
  { identifier: 'video_detail', route: '/video/detail', module: module_video_detail },
  { identifier: 'user_vip_detail', route: '/user/vip/detail', module: module_user_vip_detail },
  { identifier: 'user_video_love', route: '/user/video/love', module: module_user_video_love },
  { identifier: 'user_video_collect', route: '/user/video/collect', module: module_user_video_collect },
  { identifier: 'user_playlist', route: '/user/playlist', module: module_user_playlist },
  { identifier: 'user_listen', route: '/user/listen', module: module_user_listen },
  { identifier: 'user_history', route: '/user/history', module: module_user_history },
  { identifier: 'user_follow', route: '/user/follow', module: module_user_follow },
  { identifier: 'user_detail', route: '/user/detail', module: module_user_detail },
  { identifier: 'user_cloud_url', route: '/user/cloud/url', module: module_user_cloud_url },
  { identifier: 'user_cloud', route: '/user/cloud', module: module_user_cloud },
  { identifier: 'top_song', route: '/top/song', module: module_top_song },
  { identifier: 'top_playlist', route: '/top/playlist', module: module_top_playlist },
  { identifier: 'top_ip', route: '/top/ip', module: module_top_ip },
  { identifier: 'top_card_youth', route: '/top/card/youth', module: module_top_card_youth },
  { identifier: 'top_card', route: '/top/card', module: module_top_card },
  { identifier: 'top_album', route: '/top/album', module: module_top_album },
  { identifier: 'theme_playlist_track', route: '/theme/playlist/track', module: module_theme_playlist_track },
  { identifier: 'theme_playlist', route: '/theme/playlist', module: module_theme_playlist },
  { identifier: 'theme_music_detail', route: '/theme/music/detail', module: module_theme_music_detail },
  { identifier: 'theme_music', route: '/theme/music', module: module_theme_music },
  { identifier: 'song_url_new', route: '/song/url/new', module: module_song_url_new },
  { identifier: 'song_url', route: '/song/url', module: module_song_url },
  { identifier: 'song_ranking_filter', route: '/song/ranking/filter', module: module_song_ranking_filter },
  { identifier: 'song_ranking', route: '/song/ranking', module: module_song_ranking },
  { identifier: 'song_climax', route: '/song/climax', module: module_song_climax },
  { identifier: 'singer_list', route: '/singer/list', module: module_singer_list },
  { identifier: 'sheet_list', route: '/sheet/list', module: module_sheet_list },
  { identifier: 'sheet_hot', route: '/sheet/hot', module: module_sheet_hot },
  { identifier: 'sheet_detail', route: '/sheet/detail', module: module_sheet_detail },
  { identifier: 'sheet_collection_detail', route: '/sheet/collection/detail', module: module_sheet_collection_detail },
  { identifier: 'sheet_collection', route: '/sheet/collection', module: module_sheet_collection },
  { identifier: 'server_now', route: '/server/now', module: module_server_now },
  { identifier: 'search_suggest', route: '/search/suggest', module: module_search_suggest },
  { identifier: 'search_mixed', route: '/search/mixed', module: module_search_mixed },
  { identifier: 'search_lyric', route: '/search/lyric', module: module_search_lyric },
  { identifier: 'search_hot', route: '/search/hot', module: module_search_hot },
  { identifier: 'search_default', route: '/search/default', module: module_search_default },
  { identifier: 'search_complex', route: '/search/complex', module: module_search_complex },
  { identifier: 'search', route: '/search', module: module_search },
  { identifier: 'scene_video_list', route: '/scene/video/list', module: module_scene_video_list },
  { identifier: 'scene_music', route: '/scene/music', module: module_scene_music },
  { identifier: 'scene_module_info', route: '/scene/module/info', module: module_scene_module_info },
  { identifier: 'scene_module', route: '/scene/module', module: module_scene_module },
  { identifier: 'scene_lists_v2', route: '/scene/lists/v2', module: module_scene_lists_v2 },
  { identifier: 'scene_lists', route: '/scene/lists', module: module_scene_lists },
  { identifier: 'scene_collection_list', route: '/scene/collection/list', module: module_scene_collection_list },
  { identifier: 'scene_audio_list', route: '/scene/audio/list', module: module_scene_audio_list },
  { identifier: 'register_dev', route: '/register/dev', module: module_register_dev },
  { identifier: 'recommend_songs', route: '/recommend/songs', module: module_recommend_songs },
  { identifier: 'rank_vol', route: '/rank/vol', module: module_rank_vol },
  { identifier: 'rank_top', route: '/rank/top', module: module_rank_top },
  { identifier: 'rank_list', route: '/rank/list', module: module_rank_list },
  { identifier: 'rank_info', route: '/rank/info', module: module_rank_info },
  { identifier: 'rank_audio', route: '/rank/audio', module: module_rank_audio },
  { identifier: 'privilege_lite', route: '/privilege/lite', module: module_privilege_lite },
  { identifier: 'playlist_track_all_new', route: '/playlist/track/all/new', module: module_playlist_track_all_new },
  { identifier: 'playlist_track_all', route: '/playlist/track/all', module: module_playlist_track_all },
  { identifier: 'playlist_tracks_del', route: '/playlist/tracks/del', module: module_playlist_tracks_del },
  { identifier: 'playlist_tracks_add', route: '/playlist/tracks/add', module: module_playlist_tracks_add },
  { identifier: 'playlist_tags', route: '/playlist/tags', module: module_playlist_tags },
  { identifier: 'playlist_similar', route: '/playlist/similar', module: module_playlist_similar },
  { identifier: 'playlist_effect', route: '/playlist/effect', module: module_playlist_effect },
  { identifier: 'playlist_detail', route: '/playlist/detail', module: module_playlist_detail },
  { identifier: 'playlist_del', route: '/playlist/del', module: module_playlist_del },
  { identifier: 'playlist_add', route: '/playlist/add', module: module_playlist_add },
  { identifier: 'playhistory_upload', route: '/playhistory/upload', module: module_playhistory_upload },
  { identifier: 'personal_fm', route: '/personal/fm', module: module_personal_fm },
  { identifier: 'pc_diantai', route: '/pc/diantai', module: module_pc_diantai },
  { identifier: 'lyric', route: '/lyric', module: module_lyric },
  { identifier: 'longaudio_week_recommend', route: '/longaudio/week/recommend', module: module_longaudio_week_recommend },
  { identifier: 'longaudio_vip_recommend', route: '/longaudio/vip/recommend', module: module_longaudio_vip_recommend },
  { identifier: 'longaudio_rank_recommend', route: '/longaudio/rank/recommend', module: module_longaudio_rank_recommend },
  { identifier: 'longaudio_daily_recommend', route: '/longaudio/daily/recommend', module: module_longaudio_daily_recommend },
  { identifier: 'longaudio_album_detail', route: '/longaudio/album/detail', module: module_longaudio_album_detail },
  { identifier: 'longaudio_album_audios', route: '/longaudio/album/audios', module: module_longaudio_album_audios },
  { identifier: 'login_wx_create', route: '/login/wx/create', module: module_login_wx_create },
  { identifier: 'login_wx_check', route: '/login/wx/check', module: module_login_wx_check },
  { identifier: 'login_token', route: '/login/token', module: module_login_token },
  { identifier: 'login_qr_key', route: '/login/qr/key', module: module_login_qr_key },
  { identifier: 'login_qr_create', route: '/login/qr/create', module: module_login_qr_create },
  { identifier: 'login_qr_check', route: '/login/qr/check', module: module_login_qr_check },
  { identifier: 'login_openplat', route: '/login/openplat', module: module_login_openplat },
  { identifier: 'login_device', route: '/login/device', module: module_login_device },
  { identifier: 'login_cellphone', route: '/login/cellphone', module: module_login_cellphone },
  { identifier: 'login', route: '/login', module: module_login },
  { identifier: 'lastest_songs_listen', route: '/lastest/songs/listen', module: module_lastest_songs_listen },
  { identifier: 'krm_audio', route: '/krm/audio', module: module_krm_audio },
  { identifier: 'kmr_audio_mv', route: '/kmr/audio/mv', module: module_kmr_audio_mv },
  { identifier: 'ip_zone_home', route: '/ip/zone/home', module: module_ip_zone_home },
  { identifier: 'ip_zone', route: '/ip/zone', module: module_ip_zone },
  { identifier: 'ip_playlist', route: '/ip/playlist', module: module_ip_playlist },
  { identifier: 'ip_dateil', route: '/ip/dateil', module: module_ip_dateil },
  { identifier: 'ip', route: '/ip', module: module_ip },
  { identifier: 'images_audio', route: '/images/audio', module: module_images_audio },
  { identifier: 'images', route: '/images', module: module_images },
  { identifier: 'fm_songs', route: '/fm/songs', module: module_fm_songs },
  { identifier: 'fm_recommend', route: '/fm/recommend', module: module_fm_recommend },
  { identifier: 'fm_image', route: '/fm/image', module: module_fm_image },
  { identifier: 'fm_class', route: '/fm/class', module: module_fm_class },
  { identifier: 'favorite_count', route: '/favorite/count', module: module_favorite_count },
  { identifier: 'everyday_style_recommend', route: '/everyday/style/recommend', module: module_everyday_style_recommend },
  { identifier: 'everyday_recommend', route: '/everyday/recommend', module: module_everyday_recommend },
  { identifier: 'everyday_history', route: '/everyday/history', module: module_everyday_history },
  { identifier: 'everyday_friend', route: '/everyday/friend', module: module_everyday_friend },
  { identifier: 'comment_playlist', route: '/comment/playlist', module: module_comment_playlist },
  { identifier: 'comment_music_hotword', route: '/comment/music/hotword', module: module_comment_music_hotword },
  { identifier: 'comment_music_classify', route: '/comment/music/classify', module: module_comment_music_classify },
  { identifier: 'comment_music', route: '/comment/music', module: module_comment_music },
  { identifier: 'comment_floor', route: '/comment/floor', module: module_comment_floor },
  { identifier: 'comment_count', route: '/comment/count', module: module_comment_count },
  { identifier: 'comment_album', route: '/comment/album', module: module_comment_album },
  { identifier: 'captcha_sent', route: '/captcha/sent', module: module_captcha_sent },
  { identifier: 'brush', route: '/brush', module: module_brush },
  { identifier: 'audio_related', route: '/audio/related', module: module_audio_related },
  { identifier: 'audio_ktv_total', route: '/audio/ktv/total', module: module_audio_ktv_total },
  { identifier: 'audio_accompany_matching', route: '/audio/accompany/matching', module: module_audio_accompany_matching },
  { identifier: 'audio', route: '/audio', module: module_audio },
  { identifier: 'artist_videos', route: '/artist/videos', module: module_artist_videos },
  { identifier: 'artist_unfollow', route: '/artist/unfollow', module: module_artist_unfollow },
  { identifier: 'artist_lists', route: '/artist/lists', module: module_artist_lists },
  { identifier: 'artist_honour', route: '/artist/honour', module: module_artist_honour },
  { identifier: 'artist_follow_newsongs', route: '/artist/follow/newsongs', module: module_artist_follow_newsongs },
  { identifier: 'artist_follow', route: '/artist/follow', module: module_artist_follow },
  { identifier: 'artist_detail', route: '/artist/detail', module: module_artist_detail },
  { identifier: 'artist_audios', route: '/artist/audios', module: module_artist_audios },
  { identifier: 'artist_albums', route: '/artist/albums', module: module_artist_albums },
  { identifier: 'album_songs', route: '/album/songs', module: module_album_songs },
  { identifier: 'album_shop', route: '/album/shop', module: module_album_shop },
  { identifier: 'album_detail', route: '/album/detail', module: module_album_detail },
  { identifier: 'album', route: '/album', module: module_album },
  { identifier: 'ai_recommend', route: '/ai/recommend', module: module_ai_recommend }
];

const guid = cryptoMd5(getGuid());
const serverDev = randomString(10).toUpperCase();

async function consturctServer(moduleDefs) {
  const app = express();
  const { CORS_ALLOW_ORIGIN } = process.env;
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    if (req.path !== '/' && !req.path.includes('.')) {
      res.set({
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN || req.headers.origin || '*',
        'Access-Control-Allow-Headers': 'Authorization,X-Requested-With,Content-Type,Cache-Control',
        'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    req.method === 'OPTIONS' ? res.status(204).end() : next();
  });

  app.use((req, _, next) => {
    req.cookies = {};
    (req.headers.cookie || '').split(/;\s+|(?<!\s)\s+$/g).forEach((pair) => {
      const crack = pair.indexOf('=');
      if (crack < 1 || crack === pair.length - 1) return;
      req.cookies[decode(pair.slice(0, crack)).trim()] = decode(pair.slice(crack + 1)).trim();
    });
    next();
  });

  app.use((req, res, next) => {
    const cookies = req.cookies || {};
    const isHttps = req.protocol === 'https';
    const cookieSuffix = isHttps ? '; PATH=/; SameSite=None; Secure' : '; PATH=/';
    const ensureCookie = (key, value) => {
      if (Object.prototype.hasOwnProperty.call(cookies, key)) return;
      cookies[key] = String(value);
      res.append('Set-Cookie', `${key}=${cookies[key]}${cookieSuffix}`);
    };
    const mid = calculateMid(process.env.KUGOU_API_GUID ?? guid);
    ensureCookie('KUGOU_API_PLATFORM', process.env.platform);
    ensureCookie('KUGOU_API_MID', mid);
    ensureCookie('KUGOU_API_GUID', process.env.KUGOU_API_GUID ?? guid);
    ensureCookie('KUGOU_API_DEV', (process.env.KUGOU_API_DEV ?? serverDev).toUpperCase());
    ensureCookie('KUGOU_API_MAC', (process.env.KUGOU_API_MAC ?? '02:00:00:00:00:00').toUpperCase());
    req.cookies = cookies;
    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/docs', express.static(path.join(__dirname, 'docs')));
  app.use(cache('2 minutes', (_, res) => res.statusCode === 200));

  const moduleDefinitions = moduleDefs || staticModuleDefs;

  for (const moduleDef of moduleDefinitions) {
    app.use(moduleDef.route, async (req, res) => {
      [req.query, req.body].forEach((item) => {
        if (typeof item.cookie === 'string') item.cookie = cookieToJson(decode(item.cookie));
      });
      const { cookie, ...params } = req.query;
      const query = Object.assign({}, { cookie: Object.assign({}, req.cookies, cookie) }, params, { body: req.body });
      const authHeader = req.headers['authorization'];
      if (authHeader) query.cookie = { ...query.cookie, ...cookieToJson(authHeader) };
      try {
        const moduleResponse = await moduleDef.module(query, (config) => {
          let ip = req.ip;
          if (ip.substring(0, 7) === '::ffff:') ip = ip.substring(7);
          config.ip = ip;
          return createRequest(config);
        });
        const cookies = moduleResponse.cookie;
        if (!query.noCookie && Array.isArray(cookies) && cookies.length > 0) {
          res.append('Set-Cookie', cookies.map(cookie => `${cookie}; PATH=/${req.protocol === 'https' ? '; SameSite=None; Secure' : ''}`));
        }
        res.header(moduleResponse.headers).status(moduleResponse.status).send(moduleResponse.body);
      } catch (e) {
        const moduleResponse = e;
        if (!moduleResponse.body) {
          res.status(404).send({ code: 404, data: null, msg: 'Not Found' });
          return;
        }
        res.header(moduleResponse.headers).status(moduleResponse.status).send(moduleResponse.body);
      }
    });
  }
  return app;
}

async function startService() {
  const port = Number(process.env.PORT || '3000');
  const host = process.env.HOST || '';
  const app = await consturctServer();
  const appExt = app;
  appExt.service = app.listen(port, host, () => {
    console.log(`server running @ http://${host || 'localhost'}:${port}`);
  });
  return appExt;
}

function setupStatic(app, p) {
  app.use(express.static(p));
}

module.exports = { startService, consturctServer, setupStatic };
