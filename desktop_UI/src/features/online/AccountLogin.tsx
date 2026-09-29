import { useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge } from '../../api';
import { notify } from '../../ui';
import { Cover, platforms, type Platform } from './common';

interface Props { platform: Platform; onSuccess: () => Promise<void>; onClose: () => void; canClose: boolean }
const methods: Record<Platform, [string, string][]> = {
  qishui: [['qr', '扫码登录'], ['oneclick', '本机登录'], ['file', '文件登录'], ['manual', 'Session 登录']],
  kugou: [['qr', '扫码登录'], ['phone', '手机号登录']],
  netease: [['qr', '扫码登录'], ['cookie', 'Cookie 登录']],
};
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.onerror = () => reject(reader.error || new Error('读取文件失败')); reader.readAsDataURL(file); });
}
export default function AccountLogin({ platform, onSuccess, onClose, canClose }: Props) {
  const [method, setMethod] = useState('qr');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrHint, setQrHint] = useState('');
  const [qrVersion, setQrVersion] = useState(0);
  const [cookie, setCookie] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [session, setSession] = useState('');
  const [aid, setAid] = useState('386088');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [phoneAccounts, setPhoneAccounts] = useState<Record<string, any>[]>([]);
  const [peek, setPeek] = useState<Record<string, any> | null>(null);
  const success = useRef(onSuccess); success.current = onSuccess;
  const api = () => getBridge(`${platform}API`);
  const finishQishui = async (platformAid: string, sessionid: string) => {
    const result = await api().getProfile(platformAid, sessionid);
    if (!result.ok) throw new Error(result.message || '无法读取用户信息');
    await success.current();
  };
  useEffect(() => {
    if (platform !== 'qishui') return;
    let active = true;
    void api().peekProfile().then((result: any) => { if (active && result.ok) setPeek(result); }).catch(() => {});
    return () => { active = false; };
  }, [platform]);
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  useEffect(() => {
    if (method !== 'qr') return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout> | null = null;
    setQr(''); setQrLoading(true); setQrHint('正在生成二维码…');
    const poll = async (key: string) => {
      if (cancelled) return;
      try {
        const result = platform === 'qishui' ? await api().checkQrcode(key) : await api().qrCheck(key);
        if (cancelled) return;
        if (result.ok) {
          const status = platform === 'netease' ? result.code : result.status;
          const loggedIn = platform === 'netease' ? status === 803 : platform === 'kugou' ? status === 4 : status === 'confirmed' || status === 'success' || status === 4;
          const expired = platform === 'netease' ? status === 800 : platform === 'kugou' ? status === 0 : status === 'expired';
          if (loggedIn) {
            setQrHint('登录成功，正在加载歌单…');
            if (platform === 'qishui') { if (!result.sessionid) throw new Error('登录回调缺少 sessionid'); await finishQishui(result.aid || '386088', result.sessionid); }
            else await success.current();
            return;
          }
          if (expired) { setQrHint('二维码已过期，请刷新'); return; }
          if (status === 802 || status === 2 || status === 'scanned') setQrHint('已扫描，请在手机上确认登录');
        }
      } catch (error) { if (!cancelled) setQrHint(`暂时无法检查扫码状态：${errorMessage(error)}`); }
      if (!cancelled) timer = setTimeout(() => void poll(key), platform === 'qishui' ? 2500 : 2000);
    };
    void (async () => {
      try {
        if (platform === 'qishui') {
          const result = await api().getQrcode();
          if (cancelled) return;
          if (!result.ok || !result.token) throw new Error(result.message || '未获取到二维码');
          const picture = result.qrcode || result.base64 || result.url;
          if (!picture) throw new Error('二维码数据为空');
          setQr(picture); setQrHint('请使用抖音 / 汽水音乐 App 扫码'); void poll(result.token);
        } else {
          const key = await api().qrKey();
          if (cancelled) return;
          if (!key.ok || !key.key) throw new Error(key.message || '无法获取二维码');
          const result = await api().qrCreate(key.key);
          if (cancelled) return;
          if (!result.ok || !result.base64) throw new Error(result.message || '无法生成二维码');
          setQr(result.base64); setQrHint(`请使用${platforms[platform].name} App 扫码`); void poll(key.key);
        }
      } catch (error) { if (!cancelled) setQrHint(errorMessage(error)); }
      finally { if (!cancelled) setQrLoading(false); }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [method, platform, qrVersion]);
  async function login(userId?: string | number) {
    if (busy) return;
    setBusy(true);
    try {
      if (method === 'oneclick') {
        const result = await api().oneclickLogin();
        if (!result.supported || !result.sessionid) throw new Error(result.reason || '未找到本机汽水音乐登录信息');
        await finishQishui('386088', result.sessionid);
      } else if (method === 'file') {
        if (!file) throw new Error('请选择汽水音乐 Cookies 文件');
        const result = await api().fileLogin(file.name, await readBase64(file));
        if (!result.supported || !result.sessionid) throw new Error(result.message || '文件中未找到登录信息');
        await finishQishui('386088', result.sessionid);
      } else if (method === 'manual') {
        if (!session.trim()) throw new Error('请输入 sessionid');
        await finishQishui(aid, session.trim());
        setSession('');
      } else if (method === 'cookie') {
        if (!cookie.includes('MUSIC_U')) throw new Error('Cookie 必须包含 MUSIC_U 字段');
        const result = await api().cookieLogin(cookie.trim());
        if (!result.ok) throw new Error(result.message || 'Cookie 无效');
        setCookie(''); await success.current();
      } else if (method === 'phone') {
        if (!mobile.trim() || !code.trim()) throw new Error('请填写手机号和验证码');
        const result = await api().loginCellphone(mobile.trim(), code.trim(), userId);
        if (result.ok) { setCode(''); setPhoneAccounts([]); await success.current(); }
        else if (result.multiAccount && result.data?.data?.info_list) setPhoneAccounts(result.data.data.info_list);
        else throw new Error(result.message || '登录失败');
      }
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setBusy(false); }
  }
  async function sendCode() {
    if (busy || countdown) return;
    if (!mobile.trim()) { notify('请输入手机号', 'error'); return; }
    setBusy(true);
    try { const result = await api().captchaSent(mobile.trim()); if (!result.ok) throw new Error(result.message); setCountdown(60); notify('验证码已发送', 'success'); }
    catch (error) { notify(errorMessage(error), 'error'); } finally { setBusy(false); }
  }
  return <section className="card online-login">
    <div className="toolbar"><h3>登录{platforms[platform].name}</h3>{canClose && <button className="button" disabled={busy} onClick={onClose}>返回账号</button>}</div>
    <div className="toolbar">{methods[platform].map(([value, label]) => <button key={value} className={`button ${method === value ? 'primary' : ''}`} disabled={busy} onClick={() => setMethod(value)}>{label}</button>)}</div>
    {method === 'qr' && <div className="online-qr">{qr && <img src={qr} alt={`${platforms[platform].name}登录二维码`} width={200} height={200} />}<p role="status">{qrHint}</p><button className="button" disabled={qrLoading} onClick={() => setQrVersion(value => value + 1)}>刷新二维码</button></div>}
    {method === 'oneclick' && <><p className="muted">读取这台电脑上汽水音乐客户端已登录的账号。</p>{peek && <div className="row"><Cover src={peek.avatar} /><strong>{peek.nickname}</strong>{peek.isVip && <span className="badge">VIP</span>}</div>}<button className="button primary" disabled={busy} onClick={() => void login()}>{busy ? '读取中…' : '使用本机账号登录'}</button></>}
    {method === 'file' && <><p className="muted">选择汽水音乐客户端的 Cookies 数据库文件。</p><input className="field" type="file" aria-label="Cookies 文件" onChange={event => setFile(event.target.files?.[0] || null)} /><button className="button primary" disabled={busy || !file} onClick={() => void login()}>{busy ? '登录中…' : '从文件登录'}</button></>}
    {method === 'manual' && <><label className="row">平台<select className="field" value={aid} onChange={event => setAid(event.target.value)}><option value="386088">PC / iOS</option><option value="234123">Android</option></select></label><input className="field" type="password" aria-label="sessionid" value={session} onChange={event => setSession(event.target.value)} placeholder="sessionid" autoComplete="off" /><button className="button primary" disabled={busy || !session.trim()} onClick={() => void login()}>{busy ? '登录中…' : '登录'}</button></>}
    {method === 'cookie' && <><p className="muted">粘贴网易云音乐网站登录后的 Cookie，需要包含 MUSIC_U。</p><textarea className="field" aria-label="网易云 Cookie" rows={4} value={cookie} onChange={event => setCookie(event.target.value)} autoComplete="off" /><button className="button primary" disabled={busy || !cookie.trim()} onClick={() => void login()}>{busy ? '登录中…' : '登录'}</button></>}
    {method === 'phone' && <><div className="toolbar"><input className="field" type="tel" aria-label="手机号" value={mobile} onChange={event => setMobile(event.target.value)} placeholder="手机号" /><button className="button" disabled={busy || countdown > 0} onClick={() => void sendCode()}>{countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}</button></div><input className="field" aria-label="验证码" value={code} onChange={event => setCode(event.target.value)} placeholder="短信验证码" autoComplete="one-time-code" /><button className="button primary" disabled={busy || !mobile || !code} onClick={() => void login()}>{busy ? '登录中…' : '登录'}</button>{phoneAccounts.length > 0 && <><p>请选择要登录的账号</p>{phoneAccounts.map(account => <button className="card row" key={account.userid} disabled={busy} onClick={() => void login(account.userid)}><Cover src={account.pic} /><span>{account.nickname || account.username || account.userid}</span></button>)}</>}</>}
  </section>;
}
