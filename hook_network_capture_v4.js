// hook_network_capture.js - Frida 网络请求捕获脚本 (V4)
// 兼容 CJS (require) 和 ESM (import) 环境
// 汽水音乐主进程使用 ESM, require 不可用, 需要通过 process.binding 等方式访问内置模块

let requestCount = 0;
const MAX_RESPONSE_LOG = 8192;

function log(msg) { send({ type: "log", message: msg }); }

// ===== 兼容 ESM/CJS 的模块加载 =====
// 不能直接用 require(), 因为 ESM 环境下会 ReferenceError 导致整个脚本崩溃
function tryLoadModule(name) {
    // 方式1: process.mainModule.require (CJS 入口进程)
    try {
        if (process.mainModule && process.mainModule.require) {
            return process.mainModule.require(name);
        }
    } catch (e) { }
    // 方式2: __non_webpack_require__
    try {
        if (typeof globalThis.__non_webpack_require__ === "function") {
            return globalThis.__non_webpack_require__(name);
        }
    } catch (e) { }
    // 方式3: 直接 require (CJS 环境)
    try {
        if (typeof require === "function") return require(name);
    } catch (e) { }
    return null;
}

let http = null, https = null;
try {
    http = tryLoadModule("http");
    https = tryLoadModule("https");
} catch (e) {
    log("[INIT] 模块加载异常: " + e.message);
}

log("[INIT] http=" + !!http + ", https=" + !!https + ", fetch=" + (typeof globalThis.fetch === "function"));

// ===== 1. Hook https.request =====
if (https && https.request) {
    try {
        const origHttpsRequest = https.request;
        https.request = function (...args) {
            const reqId = ++requestCount;
            let options;
            if (typeof args[0] === "string" || args[0] instanceof URL) {
                const url = new URL(args[0]);
                options = args[1] && typeof args[1] === "object" ? args[1] : {};
                options.protocol = options.protocol || url.protocol;
                options.hostname = options.hostname || url.hostname;
                options.port = options.port || url.port;
                options.path = options.path || (url.pathname + url.search);
                options.method = options.method || "GET";
            } else { options = args[0] || {}; }
            const method = options.method || "GET";
            const hostname = options.hostname || options.host || "localhost";
            const fullPath = options.path || "/";
            const isInteresting = /qishui|douyin|bytedance|music\.|luna|track|video/i.test(hostname + fullPath);
            const req = origHttpsRequest.apply(this, args);
            if (isInteresting) {
                log("[REQ #" + reqId + "] " + method + " https://" + hostname + fullPath);
                const headers = options.headers || {};
                const ct = headers["Content-Type"] || headers["content-type"] || "";
                if (ct) log("[REQ #" + reqId + "] Content-Type: " + ct);
                const reqChunks = [];
                const ow = req.write.bind(req);
                req.write = function (d, enc, cb) { if (d) reqChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d), enc || "utf8")); return ow(d, enc, cb); };
                const oe = req.end.bind(req);
                req.end = function (d, enc, cb) { if (d) reqChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d), enc || "utf8")); return oe(d, enc, cb); };
                req.on("response", (res) => {
                    const rc = [];
                    res.on("data", (c) => rc.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                    res.on("end", () => {
                        const rb = Buffer.concat(rc).toString("utf8");
                        log("[RESP #" + reqId + "] " + res.statusCode + " " + method + " " + fullPath);
                        const qb = Buffer.concat(reqChunks).toString("utf8");
                        if (qb) log("[REQ-BODY #" + reqId + "] " + qb.substring(0, 2048));
                        if (rb) {
                            let f = rb;
                            try { f = JSON.stringify(JSON.parse(rb), null, 2); } catch (e) { }
                            log("[RESP-BODY #" + reqId + "] " + f.substring(0, MAX_RESPONSE_LOG));
                        }
                    });
                });
                req.on("error", (err) => { log("[ERR #" + reqId + "] " + err.message); });
            }
            return req;
        };
        log("[INIT] https.request hook 已安装");
    } catch (e) { log("[INIT] https hook 失败: " + e.message); }
} else {
    log("[INIT] https 模块未找到, 将尝试其他方式");
}

// ===== 2. Hook http.request =====
if (http && http.request) {
    try {
        const origHttpRequest = http.request;
        http.request = function (...args) {
            const reqId = ++requestCount;
            let options;
            if (typeof args[0] === "string" || args[0] instanceof URL) {
                const url = new URL(args[0]);
                options = args[1] && typeof args[1] === "object" ? args[1] : {};
                options.hostname = options.hostname || url.hostname;
                options.path = options.path || (url.pathname + url.search);
                options.method = options.method || "GET";
            } else { options = args[0] || {}; }
            const method = options.method || "GET";
            const hostname = options.hostname || options.host || "localhost";
            const fullPath = options.path || "/";
            const isInteresting = /qishui|douyin|bytedance|music\.|luna|track|video/i.test(hostname + fullPath);
            const req = origHttpRequest.apply(this, args);
            if (isInteresting) {
                log("[REQ-HTTP #" + reqId + "] " + method + " http://" + hostname + fullPath);
                req.on("response", (res) => {
                    const rc = [];
                    res.on("data", (c) => rc.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                    res.on("end", () => {
                        const rb = Buffer.concat(rc).toString("utf8");
                        log("[RESP-HTTP #" + reqId + "] " + res.statusCode + " " + fullPath);
                        if (rb) {
                            let f = rb;
                            try { f = JSON.stringify(JSON.parse(rb), null, 2); } catch (e) { }
                            log("[RESP-BODY #" + reqId + "] " + f.substring(0, MAX_RESPONSE_LOG));
                        }
                    });
                });
            }
            return req;
        };
        log("[INIT] http.request hook 已安装");
    } catch (e) { log("[INIT] http hook 失败: " + e.message); }
}

// ===== 3. Hook fetch =====
try {
    if (typeof globalThis.fetch === "function") {
        const origFetch = globalThis.fetch;
        globalThis.fetch = async function (input, init) {
            const reqId = ++requestCount;
            const url = typeof input === "string" ? input : (input?.url || String(input));
            const method = (init?.method) || (input?.method) || "GET";
            const isInteresting = /qishui|douyin|bytedance|music\.|luna|track|video/i.test(url);
            if (isInteresting) {
                log("[FETCH #" + reqId + "] " + method + " " + url.substring(0, 200));
                if (init?.body) {
                    const bs = typeof init.body === "string" ? init.body : (() => { try { return JSON.stringify(init.body); } catch { return String(init.body); } })();
                    log("[FETCH-BODY #" + reqId + "] " + bs.substring(0, 2048));
                }
                const resp = await origFetch.apply(this, arguments);
                log("[FETCH-RESP #" + reqId + "] " + resp.status + " " + url.substring(0, 100));
                try {
                    const cloned = resp.clone();
                    const text = await cloned.text();
                    let f = text;
                    try { f = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { }
                    log("[FETCH-RESP-BODY #" + reqId + "] " + f.substring(0, MAX_RESPONSE_LOG));
                } catch (e) { log("[FETCH #" + reqId + "] 读body失败: " + e.message); }
                return resp;
            }
            return origFetch.apply(this, arguments);
        };
        log("[INIT] fetch hook 已安装");
    } else { log("[INIT] globalThis.fetch 不存在"); }
} catch (e) { log("[INIT] fetch hook 失败: " + e.message); }

// ===== 4. 原生 SSL hook (备用方案: 当 JS 模块加载失败时) =====
if (!http && !https) {
    log("[INIT] JS 模块加载失败, 尝试原生 SSL hook...");
    try {
        const modules = ["SodaMusic.exe", "node.exe", "libssl-1_1.dll", "libssl-3.dll", "libcrypto-1_1.dll", "libcrypto-3.dll"];
        let sslWriteAddr = null, sslReadAddr = null, sslModule = null;
        for (const modName of modules) {
            const mod = Process.findModuleByName(modName);
            if (!mod) continue;
            try {
                const sw = Module.findExportByName(modName, "SSL_write");
                const sr = Module.findExportByName(modName, "SSL_read");
                if (sw && sr) {
                    sslWriteAddr = sw; sslReadAddr = sr; sslModule = modName;
                    break;
                }
            } catch (e) { }
        }
        if (sslWriteAddr && sslReadAddr) {
            log("[SSL] 找到 SSL 函数 in " + sslModule + ": write@" + sslWriteAddr + ", read@" + sslReadAddr);
            Interceptor.attach(sslWriteAddr, {
                onEnter(args) {
                    const buf = args[1]; const len = parseInt(args[2].toString());
                    if (len > 4 && len < 65536) {
                        try {
                            const data = buf.readUtf8String(Math.min(len, 8192));
                            if (data && /qishui|douyin|bytedance|luna|track|video|HTTP/i.test(data)) {
                                log("[SSL-WRITE] " + data.substring(0, MAX_RESPONSE_LOG));
                            }
                        } catch (e) { }
                    }
                }
            });
            Interceptor.attach(sslReadAddr, {
                onEnter(args) { this.buf = args[1]; },
                onLeave(retval) {
                    const len = parseInt(retval.toString());
                    if (len > 4 && len < 65536) {
                        try {
                            const data = this.buf.readUtf8String(Math.min(len, 8192));
                            if (data && /qishui|douyin|bytedance|luna|track|video|HTTP|\{/.test(data)) {
                                log("[SSL-READ] " + data.substring(0, MAX_RESPONSE_LOG));
                            }
                        } catch (e) { }
                    }
                }
            });
            log("[SSL] SSL hook 已安装");
        } else {
            log("[SSL] 未找到 SSL_read/SSL_write 导出, 列出相关模块:");
            const allMods = Process.enumerateModules();
            for (const m of allMods) {
                if (/ssl|crypto|tls|node|soda/i.test(m.name)) {
                    log("[SSL] 模块: " + m.name + " base=" + m.base + " size=" + m.size);
                }
            }
        }
    } catch (e) { log("[SSL] hook 失败: " + e.message); }
}

// ===== 5. decodeSpade hook (必须独立, 不依赖任何 JS 模块) =====
const deviceMod = Process.findModuleByName("device.node");
const mainMod = Process.findModuleByName("main.dll");
const pairs = [];
let inDecodeSpade = false, currentInput = null, currentOutput = null, callCount = 0;

function bufToAscii(ptr, len) {
    let s = ""; const n = Math.min(len, 2048);
    for (let i = 0; i < n; i++) s += String.fromCharCode(ptr.add(i).readU8());
    return s;
}

if (deviceMod && mainMod) {
    try {
        const decodeSpadeAddr = deviceMod.base.add(0x32a0);
        const helper1a80Addr = deviceMod.base.add(0x1a80);
        const napiCreateStringIAT = deviceMod.base.add(0x44298);
        let napiCreateStringAddr = null;
        try { napiCreateStringAddr = napiCreateStringIAT.readPointer(); } catch (e) { }
        log("[SPADE] 初始化: device.node@" + deviceMod.base + " main.dll@" + mainMod.base);

        Interceptor.attach(helper1a80Addr, {
            onEnter(args) { if (!inDecodeSpade) return; this.rdx = args[1]; this.active = true; },
            onLeave(retval) {
                if (!this.active) return;
                try {
                    const strObj = this.rdx;
                    const capacity = strObj.add(0x18).readU64();
                    const length = strObj.add(0x10).readU64();
                    let dataPtr = capacity.compare(0xf) <= 0 ? strObj : strObj.readPointer();
                    const len = parseInt(length.toString());
                    if (len > 0) currentInput = { len, ascii: bufToAscii(dataPtr, len) };
                } catch (e) { }
            }
        });

        if (napiCreateStringAddr) {
            Interceptor.attach(napiCreateStringAddr, {
                onEnter(args) { if (!inDecodeSpade) return; this.strPtr = args[1]; this.len = parseInt(args[2].toString()); this.active = true; },
                onLeave(retval) {
                    if (!this.active) return;
                    try { if (this.len > 0 && !this.strPtr.isNull()) currentOutput = { len: this.len, ascii: bufToAscii(this.strPtr, this.len) }; } catch (e) { }
                }
            });
        }

        Interceptor.attach(decodeSpadeAddr, {
            onEnter(args) { callCount++; inDecodeSpade = true; currentInput = null; currentOutput = null; },
            onLeave(retval) {
                inDecodeSpade = false;
                if (currentInput && currentOutput) {
                    pairs.push({ id: callCount, spade_a: currentInput.ascii, key: currentOutput.ascii, ts: Date.now() });
                    send({ type: "spade_captured", spade_a: currentInput.ascii, key: currentOutput.ascii });
                    log("[SPADE] #" + callCount + ": spade_a=" + currentInput.ascii.substring(0, 40) + "... key=" + currentOutput.ascii);
                }
            }
        });
        log("[SPADE] decodeSpade hook 已安装");
    } catch (e) { log("[SPADE] hook 失败: " + e.message); }
} else {
    log("[SPADE] device.node 或 main.dll 未加载 (device=" + !!deviceMod + ", main=" + !!mainMod + ")");
}

log("========================================");
log("V4 Hook 就绪 (http=" + !!http + " https=" + !!https + " fetch=" + (typeof globalThis.fetch === "function") + ")");
log("请在汽水音乐中播放歌曲");
log("========================================");

rpc.exports = {
    list() { return pairs; },
    status() { return { totalSpades: pairs.length, totalRequests: requestCount }; },
    last() { return pairs.length > 0 ? pairs[pairs.length - 1] : null; },
};
