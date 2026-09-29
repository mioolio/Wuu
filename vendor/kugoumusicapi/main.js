const { cookieToJson } = require('./util');

const yueku_fm_module = require('./module/yueku_fm.js');
const yueku_banner_module = require('./module/yueku_banner.js');
const yueku_module = require('./module/yueku.js');
const youth_vip_module = require('./module/youth_vip.js');
const youth_user_song_module = require('./module/youth_user_song.js');
const youth_union_vip_module = require('./module/youth_union_vip.js');
const youth_month_vip_record_module = require('./module/youth_month_vip_record.js');
const youth_listen_song_module = require('./module/youth_listen_song.js');
const youth_dynamic_recent_module = require('./module/youth_dynamic_recent.js');
const youth_dynamic_module = require('./module/youth_dynamic.js');
const youth_day_vip_upgrade_module = require('./module/youth_day_vip_upgrade.js');
const youth_day_vip_module = require('./module/youth_day_vip.js');
const youth_channel_sub_module = require('./module/youth_channel_sub.js');
const youth_channel_song_detail_module = require('./module/youth_channel_song_detail.js');
const youth_channel_song_module = require('./module/youth_channel_song.js');
const youth_channel_similar_module = require('./module/youth_channel_similar.js');
const youth_channel_detail_module = require('./module/youth_channel_detail.js');
const youth_channel_amway_module = require('./module/youth_channel_amway.js');
const youth_channel_all_module = require('./module/youth_channel_all.js');
const video_url_module = require('./module/video_url.js');
const video_privilege_module = require('./module/video_privilege.js');
const video_detail_module = require('./module/video_detail.js');
const user_vip_detail_module = require('./module/user_vip_detail.js');
const user_video_love_module = require('./module/user_video_love.js');
const user_video_collect_module = require('./module/user_video_collect.js');
const user_playlist_module = require('./module/user_playlist.js');
const user_listen_module = require('./module/user_listen.js');
const user_history_module = require('./module/user_history.js');
const user_follow_module = require('./module/user_follow.js');
const user_detail_module = require('./module/user_detail.js');
const user_cloud_url_module = require('./module/user_cloud_url.js');
const user_cloud_module = require('./module/user_cloud.js');
const top_song_module = require('./module/top_song.js');
const top_playlist_module = require('./module/top_playlist.js');
const top_ip_module = require('./module/top_ip.js');
const top_card_youth_module = require('./module/top_card_youth.js');
const top_card_module = require('./module/top_card.js');
const top_album_module = require('./module/top_album.js');
const theme_playlist_track_module = require('./module/theme_playlist_track.js');
const theme_playlist_module = require('./module/theme_playlist.js');
const theme_music_detail_module = require('./module/theme_music_detail.js');
const theme_music_module = require('./module/theme_music.js');
const song_url_new_module = require('./module/song_url_new.js');
const song_url_module = require('./module/song_url.js');
const song_ranking_filter_module = require('./module/song_ranking_filter.js');
const song_ranking_module = require('./module/song_ranking.js');
const song_climax_module = require('./module/song_climax.js');
const singer_list_module = require('./module/singer_list.js');
const sheet_list_module = require('./module/sheet_list.js');
const sheet_hot_module = require('./module/sheet_hot.js');
const sheet_detail_module = require('./module/sheet_detail.js');
const sheet_collection_detail_module = require('./module/sheet_collection_detail.js');
const sheet_collection_module = require('./module/sheet_collection.js');
const server_now_module = require('./module/server_now.js');
const search_suggest_module = require('./module/search_suggest.js');
const search_mixed_module = require('./module/search_mixed.js');
const search_lyric_module = require('./module/search_lyric.js');
const search_hot_module = require('./module/search_hot.js');
const search_default_module = require('./module/search_default.js');
const search_complex_module = require('./module/search_complex.js');
const search_module = require('./module/search.js');
const scene_video_list_module = require('./module/scene_video_list.js');
const scene_music_module = require('./module/scene_music.js');
const scene_module_info_module = require('./module/scene_module_info.js');
const scene_module_module = require('./module/scene_module.js');
const scene_lists_v2_module = require('./module/scene_lists_v2.js');
const scene_lists_module = require('./module/scene_lists.js');
const scene_collection_list_module = require('./module/scene_collection_list.js');
const scene_audio_list_module = require('./module/scene_audio_list.js');
const register_dev_module = require('./module/register_dev.js');
const recommend_songs_module = require('./module/recommend_songs.js');
const rank_vol_module = require('./module/rank_vol.js');
const rank_top_module = require('./module/rank_top.js');
const rank_list_module = require('./module/rank_list.js');
const rank_info_module = require('./module/rank_info.js');
const rank_audio_module = require('./module/rank_audio.js');
const privilege_lite_module = require('./module/privilege_lite.js');
const playlist_track_all_new_module = require('./module/playlist_track_all_new.js');
const playlist_track_all_module = require('./module/playlist_track_all.js');
const playlist_tracks_del_module = require('./module/playlist_tracks_del.js');
const playlist_tracks_add_module = require('./module/playlist_tracks_add.js');
const playlist_tags_module = require('./module/playlist_tags.js');
const playlist_similar_module = require('./module/playlist_similar.js');
const playlist_effect_module = require('./module/playlist_effect.js');
const playlist_detail_module = require('./module/playlist_detail.js');
const playlist_del_module = require('./module/playlist_del.js');
const playlist_add_module = require('./module/playlist_add.js');
const playhistory_upload_module = require('./module/playhistory_upload.js');
const personal_fm_module = require('./module/personal_fm.js');
const pc_diantai_module = require('./module/pc_diantai.js');
const lyric_module = require('./module/lyric.js');
const longaudio_week_recommend_module = require('./module/longaudio_week_recommend.js');
const longaudio_vip_recommend_module = require('./module/longaudio_vip_recommend.js');
const longaudio_rank_recommend_module = require('./module/longaudio_rank_recommend.js');
const longaudio_daily_recommend_module = require('./module/longaudio_daily_recommend.js');
const longaudio_album_detail_module = require('./module/longaudio_album_detail.js');
const longaudio_album_audios_module = require('./module/longaudio_album_audios.js');
const login_wx_create_module = require('./module/login_wx_create.js');
const login_wx_check_module = require('./module/login_wx_check.js');
const login_token_module = require('./module/login_token.js');
const login_qr_key_module = require('./module/login_qr_key.js');
const login_qr_create_module = require('./module/login_qr_create.js');
const login_qr_check_module = require('./module/login_qr_check.js');
const login_openplat_module = require('./module/login_openplat.js');
const login_device_module = require('./module/login_device.js');
const login_cellphone_module = require('./module/login_cellphone.js');
const login_module = require('./module/login.js');
const lastest_songs_listen_module = require('./module/lastest_songs_listen.js');
const krm_audio_module = require('./module/krm_audio.js');
const kmr_audio_mv_module = require('./module/kmr_audio_mv.js');
const ip_zone_home_module = require('./module/ip_zone_home.js');
const ip_zone_module = require('./module/ip_zone.js');
const ip_playlist_module = require('./module/ip_playlist.js');
const ip_dateil_module = require('./module/ip_dateil.js');
const ip_module = require('./module/ip.js');
const images_audio_module = require('./module/images_audio.js');
const images_module = require('./module/images.js');
const fm_songs_module = require('./module/fm_songs.js');
const fm_recommend_module = require('./module/fm_recommend.js');
const fm_image_module = require('./module/fm_image.js');
const fm_class_module = require('./module/fm_class.js');
const favorite_count_module = require('./module/favorite_count.js');
const everyday_style_recommend_module = require('./module/everyday_style_recommend.js');
const everyday_recommend_module = require('./module/everyday_recommend.js');
const everyday_history_module = require('./module/everyday_history.js');
const everyday_friend_module = require('./module/everyday_friend.js');
const comment_playlist_module = require('./module/comment_playlist.js');
const comment_music_hotword_module = require('./module/comment_music_hotword.js');
const comment_music_classify_module = require('./module/comment_music_classify.js');
const comment_music_module = require('./module/comment_music.js');
const comment_floor_module = require('./module/comment_floor.js');
const comment_count_module = require('./module/comment_count.js');
const comment_album_module = require('./module/comment_album.js');
const captcha_sent_module = require('./module/captcha_sent.js');
const brush_module = require('./module/brush.js');
const audio_related_module = require('./module/audio_related.js');
const audio_ktv_total_module = require('./module/audio_ktv_total.js');
const audio_accompany_matching_module = require('./module/audio_accompany_matching.js');
const audio_module = require('./module/audio.js');
const artist_videos_module = require('./module/artist_videos.js');
const artist_unfollow_module = require('./module/artist_unfollow.js');
const artist_lists_module = require('./module/artist_lists.js');
const artist_honour_module = require('./module/artist_honour.js');
const artist_follow_newsongs_module = require('./module/artist_follow_newsongs.js');
const artist_follow_module = require('./module/artist_follow.js');
const artist_detail_module = require('./module/artist_detail.js');
const artist_audios_module = require('./module/artist_audios.js');
const artist_albums_module = require('./module/artist_albums.js');
const album_songs_module = require('./module/album_songs.js');
const album_shop_module = require('./module/album_shop.js');
const album_detail_module = require('./module/album_detail.js');
const album_module = require('./module/album.js');
const ai_recommend_module = require('./module/ai_recommend.js');

const obj = {
  yueku_fm: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return yueku_fm_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  yueku_banner: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return yueku_banner_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  yueku: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return yueku_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_vip: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_vip_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_user_song: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_user_song_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_union_vip: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_union_vip_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_month_vip_record: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_month_vip_record_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_listen_song: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_listen_song_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_dynamic_recent: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_dynamic_recent_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_dynamic: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_dynamic_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_day_vip_upgrade: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_day_vip_upgrade_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_day_vip: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_day_vip_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_sub: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_sub_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_song_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_song_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_song: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_song_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_similar: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_similar_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_amway: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_amway_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  youth_channel_all: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return youth_channel_all_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  video_url: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return video_url_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  video_privilege: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return video_privilege_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  video_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return video_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_vip_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_vip_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_video_love: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_video_love_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_video_collect: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_video_collect_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_playlist: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_playlist_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_listen: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_listen_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_history: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_history_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_follow: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_follow_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_cloud_url: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_cloud_url_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  user_cloud: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return user_cloud_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  top_song: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return top_song_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  top_playlist: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return top_playlist_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  top_ip: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return top_ip_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  top_card_youth: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return top_card_youth_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  top_card: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return top_card_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  top_album: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return top_album_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  theme_playlist_track: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return theme_playlist_track_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  theme_playlist: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return theme_playlist_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  theme_music_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return theme_music_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  theme_music: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return theme_music_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  song_url_new: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return song_url_new_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  song_url: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return song_url_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  song_ranking_filter: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return song_ranking_filter_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  song_ranking: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return song_ranking_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  song_climax: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return song_climax_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  singer_list: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return singer_list_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  sheet_list: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return sheet_list_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  sheet_hot: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return sheet_hot_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  sheet_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return sheet_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  sheet_collection_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return sheet_collection_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  sheet_collection: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return sheet_collection_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  server_now: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return server_now_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search_suggest: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_suggest_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search_mixed: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_mixed_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search_lyric: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_lyric_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search_hot: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_hot_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search_default: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_default_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search_complex: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_complex_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  search: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return search_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_video_list: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_video_list_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_music: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_music_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_module_info: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_module_info_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_module: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_module_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_lists_v2: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_lists_v2_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_lists: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_lists_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_collection_list: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_collection_list_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  scene_audio_list: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return scene_audio_list_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  register_dev: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return register_dev_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  recommend_songs: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return recommend_songs_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  rank_vol: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return rank_vol_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  rank_top: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return rank_top_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  rank_list: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return rank_list_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  rank_info: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return rank_info_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  rank_audio: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return rank_audio_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  privilege_lite: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return privilege_lite_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_track_all_new: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_track_all_new_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_track_all: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_track_all_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_tracks_del: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_tracks_del_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_tracks_add: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_tracks_add_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_tags: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_tags_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_similar: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_similar_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_effect: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_effect_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_del: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_del_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playlist_add: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playlist_add_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  playhistory_upload: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return playhistory_upload_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  personal_fm: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return personal_fm_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  pc_diantai: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return pc_diantai_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  lyric: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return lyric_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  longaudio_week_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return longaudio_week_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  longaudio_vip_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return longaudio_vip_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  longaudio_rank_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return longaudio_rank_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  longaudio_daily_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return longaudio_daily_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  longaudio_album_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return longaudio_album_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  longaudio_album_audios: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return longaudio_album_audios_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_wx_create: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_wx_create_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_wx_check: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_wx_check_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_token: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_token_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_qr_key: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_qr_key_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_qr_create: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_qr_create_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_qr_check: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_qr_check_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_openplat: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_openplat_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_device: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_device_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login_cellphone: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_cellphone_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  login: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return login_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  lastest_songs_listen: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return lastest_songs_listen_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  krm_audio: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return krm_audio_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  kmr_audio_mv: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return kmr_audio_mv_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  ip_zone_home: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return ip_zone_home_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  ip_zone: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return ip_zone_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  ip_playlist: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return ip_playlist_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  ip_dateil: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return ip_dateil_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  ip: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return ip_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  images_audio: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return images_audio_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  images: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return images_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  fm_songs: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return fm_songs_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  fm_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return fm_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  fm_image: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return fm_image_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  fm_class: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return fm_class_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  favorite_count: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return favorite_count_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  everyday_style_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return everyday_style_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  everyday_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return everyday_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  everyday_history: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return everyday_history_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  everyday_friend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return everyday_friend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_playlist: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_playlist_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_music_hotword: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_music_hotword_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_music_classify: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_music_classify_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_music: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_music_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_floor: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_floor_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_count: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_count_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  comment_album: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return comment_album_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  captcha_sent: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return captcha_sent_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  brush: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return brush_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  audio_related: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return audio_related_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  audio_ktv_total: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return audio_ktv_total_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  audio_accompany_matching: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return audio_accompany_matching_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  audio: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return audio_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_videos: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_videos_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_unfollow: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_unfollow_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_lists: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_lists_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_honour: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_honour_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_follow_newsongs: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_follow_newsongs_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_follow: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_follow_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_audios: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_audios_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  artist_albums: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return artist_albums_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  album_songs: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return album_songs_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  album_shop: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return album_shop_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  album_detail: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return album_detail_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  album: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return album_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  },
  ai_recommend: (data = {}) => {
    if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
    return ai_recommend_module({ ...data, cookie: data.cookie ? data.cookie : {} }, (...args) => {
      const { createRequest } = require('./util/request');
      return createRequest(...args);
    });
  }
};

module.exports = { ...require('./server'), ...require('./util/request'), ...obj };
