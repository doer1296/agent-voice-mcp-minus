import http from "http";
import { readFileSync, writeFileSync } from "fs";
import { getConfigPath } from "./config.js";
// webui.js — agent-voice 本地可视化控制台（v1.5.0）
// 与主 MCP 服务同生命周期，config.webui.enabled 开关控制；仅监听 127.0.0.1（默认端口 47614，
// watcher 守卫 47613 的相邻位）。多会话实例：先到先得，被占者 30 秒周期重试接管（与 watcher 同策略）。
// 防护：Host 白名单（防 DNS rebinding）+ Origin 白名单（防浏览器 CSRF）；非浏览器客户端（curl/node）不受影响。
const DEFAULT_PORT = 47614;
const MASK = "****";
const KEY_PATHS = [
    ["cloud", "apiKey"],
    ["cloud", "volcano", "apiKey"],
    ["cloud", "mimo", "apiKey"],
];
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function maskConfig(raw) {
    const out = deepClone(raw);
    for (const p of KEY_PATHS) {
        const node = p.slice(0, -1).reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), out);
        const key = p[p.length - 1];
        if (node && typeof node[key] === "string" && node[key]) {
            node[key] = MASK;
        }
    }
    return out;
}
// 保存时还原脱敏字段：编辑器里显示的 **** 不覆盖真实 Key（真实 Key 从未下发到浏览器）
function restoreMaskedKeys(incoming, oldRaw) {
    for (const p of KEY_PATHS) {
        const nodeIn = p.slice(0, -1).reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), incoming);
        const nodeOld = p.slice(0, -1).reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), oldRaw);
        const key = p[p.length - 1];
        if (nodeIn && nodeIn[key] === MASK) {
            nodeIn[key] = nodeOld && typeof nodeOld[key] === "string" ? nodeOld[key] : "";
        }
    }
}
function isLocalOrigin(origin) {
    if (!origin)
        return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}
function isLocalHost(host) {
    return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host || "");
}
function readBody(req, limit = 512 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error("body too large"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
}
export function startWebUI({ port, handle }) {
    if (!handle || typeof handle.speak !== "function") {
        return null;
    }
    const listenPort = port || DEFAULT_PORT;
    const startedAt = Date.now();
    const configPath = getConfigPath();
    async function onRequest(req, res) {
        let url;
        try {
            url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
        }
        catch {
            sendJson(res, 400, { error: "bad url" });
            return;
        }
        if (!isLocalHost(req.headers.host) || !isLocalOrigin(req.headers.origin)) {
            res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("forbidden");
            return;
        }
        const path = url.pathname;
        try {
            if (req.method === "GET" && path === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(DASHBOARD_HTML);
                return;
            }
            if (req.method === "GET" && path === "/api/status") {
                const status = typeof handle.status === "function" ? handle.status() : {};
                sendJson(res, 200, { ...status, uptimeSec: Math.floor((Date.now() - startedAt) / 1000), port: listenPort });
                return;
            }
            if (req.method === "GET" && path === "/api/config") {
                let raw = {};
                try {
                    raw = JSON.parse(readFileSync(configPath, "utf8"));
                }
                catch {
                    sendJson(res, 500, { error: "config.json 读取或解析失败" });
                    return;
                }
                sendJson(res, 200, maskConfig(raw));
                return;
            }
            if (req.method === "POST" && path === "/api/config") {
                const rawBody = await readBody(req);
                let incoming;
                try {
                    incoming = JSON.parse(rawBody);
                }
                catch {
                    sendJson(res, 400, { error: "JSON 语法错误，未写入" });
                    return;
                }
                if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
                    sendJson(res, 400, { error: "配置必须是 JSON 对象" });
                    return;
                }
                let oldRaw = {};
                try {
                    oldRaw = JSON.parse(readFileSync(configPath, "utf8"));
                }
                catch { /* 旧文件损坏也允许覆盖保存 */ }
                restoreMaskedKeys(incoming, oldRaw);
                writeFileSync(configPath, JSON.stringify(incoming, null, 2) + "\n", "utf8");
                sendJson(res, 200, { ok: true });
                return;
            }
            if (req.method === "POST" && path === "/api/speak") {
                const body = JSON.parse(await readBody(req));
                if (!body || typeof body.text !== "string" || !body.text.trim()) {
                    sendJson(res, 400, { error: "text 不能为空" });
                    return;
                }
                const result = await handle.speak({
                    text: body.text,
                    voice: typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : undefined,
                    rate: typeof body.rate === "number" ? body.rate : undefined,
                    volume: typeof body.volume === "number" ? body.volume : undefined,
                    scene: typeof body.scene === "string" ? body.scene : undefined,
                    emotion: typeof body.emotion === "string" ? body.emotion : undefined,
                    emotionIntensity: typeof body.emotionIntensity === "number" ? body.emotionIntensity : undefined,
                });
                sendJson(res, 200, result ?? { ok: true });
                return;
            }
            if (req.method === "POST" && path === "/api/stop") {
                if (typeof handle.stop === "function")
                    handle.stop();
                sendJson(res, 200, { ok: true });
                return;
            }
            if (req.method === "GET" && path === "/api/voices") {
                const voices = typeof handle.voices === "function" ? await handle.voices() : [];
                sendJson(res, 200, Array.isArray(voices) ? voices : []);
                return;
            }
            sendJson(res, 404, { error: "not found" });
        }
        catch (e) {
            sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
    }
    function tryListen() {
        const srv = http.createServer(onRequest);
        srv.on("error", (e) => {
            try {
                srv.close();
            }
            catch { /* 已关闭 */ }
            if (e.code === "EADDRINUSE") {
                // 另一实例正在服务：周期重试，持有者退出后 30 秒内接管
                setTimeout(tryListen, 30000).unref();
            }
            else {
                console.error(`[webui] http server error: ${e.message}`);
            }
        });
        srv.listen(listenPort, "127.0.0.1", () => {
            console.error(`[webui] agent-voice 可视化控制台: http://127.0.0.1:${listenPort}`);
        });
    }
    tryListen();
    return { port: listenPort };
}
const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-voice 控制台</title>
<style>
:root{--bg:#f5f7fa;--card:#fff;--ink:#24292f;--sub:#6b7280;--line:#e5e7eb;--accent:#2563eb;--ok:#059669;--err:#dc2626}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:var(--bg);color:var(--ink);padding:24px}
.wrap{max-width:960px;margin:0 auto}
header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px}
h1{font-size:20px;font-weight:600}
.badge{font-size:12px;color:var(--sub);background:var(--card);border:1px solid var(--line);padding:3px 10px;border-radius:999px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card .lbl{font-size:12px;color:var(--sub);margin-bottom:4px}
.card .val{font-size:15px;font-weight:600;word-break:break-all}
.card .val.ok{color:var(--ok)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:20px}
section h2{font-size:15px;font-weight:600;margin-bottom:12px}
textarea,input[type=text],select{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:14px;font-family:inherit;background:#fff;color:var(--ink)}
textarea{resize:vertical}
textarea.code{font-family:Consolas,"Courier New",monospace;font-size:13px;min-height:340px;line-height:1.5;white-space:pre;tab-size:2}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
.row>div{flex:1;min-width:150px}
label{font-size:12px;color:var(--sub);display:block;margin-bottom:4px}
button{border:none;border-radius:8px;padding:9px 18px;font-size:14px;cursor:pointer;font-family:inherit}
button.primary{background:var(--accent);color:#fff}
button.primary:hover{background:#1d4ed8}
button.ghost{background:#fff;border:1px solid var(--line);color:var(--ink)}
button.ghost:hover{border-color:var(--accent);color:var(--accent)}
button:disabled{opacity:.5;cursor:not-allowed}
.voices{display:flex;flex-wrap:wrap;gap:8px}
.voices button{background:#fff;border:1px solid var(--line);padding:7px 14px;font-size:13px}
.voices button:hover{border-color:var(--accent);color:var(--accent)}
.hint{font-size:12px;color:var(--sub);margin-top:8px;line-height:1.7}
.actions{display:flex;gap:10px;margin-top:12px}
.slider-row{display:flex;align-items:center;gap:10px}
.slider-row input[type=range]{flex:1}
.sv{min-width:44px;text-align:right;font-size:13px;color:var(--sub)}
.toast{position:fixed;top:16px;right:16px;padding:10px 16px;border-radius:8px;color:#fff;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:9}
.toast.show{opacity:1}
.toast.ok{background:var(--ok)}
.toast.err{background:var(--err)}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>agent-voice 控制台</h1>
<span class="badge" id="badge-ver">v?</span>
<span class="badge" id="badge-uptime">—</span>
</header>
<div class="cards" id="cards"></div>

<section>
<h2>试播</h2>
<textarea id="sp-text" rows="2">你好，这是来自 agent-voice 控制台的试播。</textarea>
<div class="row">
<div><label>场景</label>
<select id="sp-scene">
<option value="">（不指定）</option>
<option value="task_start">task_start · 任务开始</option>
<option value="task_complete">task_complete · 任务完成</option>
<option value="task_error">task_error · 出错</option>
<option value="need_interaction">need_interaction · 需要确认</option>
<option value="milestone">milestone · 里程碑</option>
</select></div>
<div><label>情绪</label>
<select id="sp-emotion">
<option value="">（不指定）</option>
<option value="neutral">neutral · 平静</option>
<option value="happy">happy · 开心</option>
<option value="sad">sad · 低落</option>
<option value="angry">angry · 生气</option>
<option value="calm">calm · 从容</option>
<option value="excited">excited · 兴奋</option>
</select></div>
<div><label>音色（留空用配置默认）</label><input type="text" id="sp-voice" placeholder="如：冰糖"></div>
</div>
<div class="row">
<div><label>语速 <span class="sv" id="sp-rate-v">200</span></label><div class="slider-row"><input type="range" id="sp-rate" min="50" max="300" step="10" value="200"></div></div>
<div><label>音量 <span class="sv" id="sp-vol-v">1.00</span></label><div class="slider-row"><input type="range" id="sp-vol" min="0" max="1" step="0.05" value="1"></div></div>
<div><label>情绪强度 <span class="sv" id="sp-int-v">0.7</span></label><div class="slider-row"><input type="range" id="sp-int" min="0" max="1" step="0.1" value="0.7"></div></div>
</div>
<div class="actions">
<button class="primary" id="btn-speak">播报</button>
<button class="ghost" id="btn-stop">停止</button>
</div>
<p class="hint">与 Agent 调用 speak 工具走同一条播报队列与提示音逻辑。MiMo 引擎下，情绪/语速/音量/强度会被量化为自然语言「导演指令」；火山引擎下走声学参数映射。</p>
</section>

<section>
<h2>音色试听</h2>
<div class="voices" id="voices"><span class="hint">加载中…</span></div>
<p class="hint">列表来自当前引擎（getVoices），点击即用该音色播报一句示例。</p>
</section>

<section>
<h2>配置编辑（config.json）</h2>
<textarea class="code" id="cfg" spellcheck="false"></textarea>
<div class="actions">
<button class="primary" id="btn-save">保存</button>
<button class="ghost" id="btn-reload">重新加载</button>
</div>
<p class="hint">API Key 已脱敏为 <b>****</b>，保存时脱敏字段不会被改动（真实 Key 不经过浏览器）。保存后下一条播报即生效（配置热重载），引擎级变更自动重建引擎；JSON 语法错误会被拒绝写入。改坏也不怕：解析失败时服务沿用上一份有效配置。</p>
</section>
</div>
<div class="toast" id="toast"></div>
<script>
function $(id){return document.getElementById(id)}
function toast(msg,ok){var t=$('toast');t.textContent=msg;t.className='toast show '+(ok?'ok':'err');setTimeout(function(){t.className='toast'},2200)}
function getJSON(url){return fetch(url).then(function(r){return r.json()})}
function postJSON(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json()})}

function fmtUptime(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h>0?h+'小时'+m+'分':m+'分'+(s%60)+'秒'}
function queueText(st){
  if(st.speaking)return '播放中';
  var n=st.queueLength||0;
  return n>0?'排队 '+n+' 条':'空闲';
}
function renderStatus(st){
  var cards=[
    {lbl:'引擎',val:st.engine||'—'},
    {lbl:'供应商',val:st.provider||'—'},
    {lbl:'当前音色',val:st.voice||'—'},
    {lbl:'播报队列',val:queueText(st)},
    {lbl:'API Key',val:st.keyConfigured?'已配置':'未配置（走本地兜底）',ok:st.keyConfigured},
    {lbl:'运行时长',val:fmtUptime(st.uptimeSec||0)}
  ];
  $('cards').innerHTML=cards.map(function(c){
    return '<div class="card"><div class="lbl">'+c.lbl+'</div><div class="val'+(c.ok?' ok':'')+'">'+c.val+'</div></div>'
  }).join('');
  $('badge-ver').textContent='v'+(st.version||'?');
  $('badge-uptime').textContent='端口 '+(st.port||'—');
}
function refreshStatus(){getJSON('/api/status').then(renderStatus).catch(function(){})}

function renderVoices(list){
  var box=$('voices');
  if(!list||!list.length){box.innerHTML='<span class="hint">当前引擎未提供音色列表</span>';return}
  box.innerHTML='';
  list.forEach(function(v){
    var b=document.createElement('button');
    var name=v.voice||v.name||String(v);
    var meta=[v.note,v.gender==='female'?'女':v.gender==='male'?'男':'',v.lang].filter(Boolean).join(' · ');
    b.textContent=name+(meta?'（'+meta+'）':'');
    b.onclick=function(){
      postJSON('/api/speak',{text:'你好，我是音色'+name+'。',voice:name}).then(function(r){
        toast(r.error?('失败：'+r.error):'已入队：'+name,true)
      }).catch(function(){toast('请求失败',false)})
    };
    box.appendChild(b);
  });
}
function loadVoices(){getJSON('/api/voices').then(renderVoices).catch(function(){$('voices').innerHTML='<span class="hint">加载失败</span>'})}

function loadConfig(){getJSON('/api/config').then(function(c){$('cfg').value=JSON.stringify(c,null,2)}).catch(function(e){toast('配置读取失败：'+(e.message||e),false)})}
$('btn-save').onclick=function(){
  var parsed;
  try{parsed=JSON.parse($('cfg').value)}catch(e){toast('JSON 语法错误，未保存：'+e.message,false);return}
  postJSON('/api/config',parsed).then(function(r){
    if(r.ok){toast('已保存，下一条播报生效',true);refreshStatus()}
    else{toast('保存失败：'+(r.error||'未知错误'),false)}
  }).catch(function(){toast('请求失败',false)})
};
$('btn-reload').onclick=function(){loadConfig();toast('已重新加载',true)};

$('sp-rate').oninput=function(){$('sp-rate-v').textContent=this.value};
$('sp-vol').oninput=function(){$('sp-vol-v').textContent=(+this.value).toFixed(2)};
$('sp-int').oninput=function(){$('sp-int-v').textContent=this.value};
$('btn-speak').onclick=function(){
  var body={text:$('sp-text').value};
  if($('sp-scene').value)body.scene=$('sp-scene').value;
  if($('sp-emotion').value){body.emotion=$('sp-emotion').value;body.emotionIntensity=+$('sp-int').value}
  if($('sp-voice').value.trim())body.voice=$('sp-voice').value.trim();
  body.rate=+$('sp-rate').value;
  body.volume=+$('sp-vol').value;
  postJSON('/api/speak',body).then(function(r){
    if(r.error){toast('失败：'+r.error,false)}
    else{toast('已入队'+(r.voice?(' · '+r.voice):'')+(r.instruction?'':''),true);refreshStatus()}
  }).catch(function(){toast('请求失败',false)})
};
$('btn-stop').onclick=function(){postJSON('/api/stop',{}).then(function(){toast('已停止',true);refreshStatus()}).catch(function(){toast('请求失败',false)})};

refreshStatus();loadVoices();loadConfig();
setInterval(refreshStatus,5000);
</script>
</body>
</html>
`;
//# sourceMappingURL=webui.js.map
