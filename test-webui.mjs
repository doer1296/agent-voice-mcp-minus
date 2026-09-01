import { spawn } from "child_process";
import { writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const cfgPath = path.join(tmpdir(), "agent-voice-webui-test-config.json");
writeFileSync(cfgPath, JSON.stringify({
  engine: "cloud",
  cloud: { provider: "mimo", mimo: { apiKey: "test-key-1234567890", voice: "冰糖" } },
  webui: { enabled: true, port: 47615 },
  watcher: { enabled: false },
  startupWelcome: false,
  fallbackEngine: "windows-sapi",
  notificationSound: false,
}), "utf8");

const proc = spawn(process.execPath, ["dist/index.js"], {
  cwd: repoDir,
  env: { ...process.env, AGENT_VOICE_CONFIG: cfgPath },
  stdio: ["pipe", "pipe", "pipe"],
});
proc.stderr.on("data", (d) => process.stderr.write("[srv] " + d));

const BASE = "http://127.0.0.1:47615";
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (detail ? "  → " + detail : ""));
}

// 等端口就绪
let ready = false;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE + "/api/status"); if (r.ok) { ready = true; break; } }
  catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

try {
  check("0 服务启动且 webui 监听", ready);
  if (!ready) throw new Error("webui 未就绪");

  // [1] 状态
  const st = await (await fetch(BASE + "/api/status")).json();
  check("1 status.version=1.5.0", st.version === "1.5.0", JSON.stringify(st));
  check("2 status.provider=mimo", st.provider === "mimo");
  check("3 status.voice=冰糖", st.voice === "冰糖");
  check("4 status.keyConfigured=true", st.keyConfigured === true);

  // [2] 配置读取脱敏
  const cfg = await (await fetch(BASE + "/api/config")).json();
  check("5 GET config Key 脱敏为****", cfg.cloud?.mimo?.apiKey === "****", cfg.cloud?.mimo?.apiKey);

  // [3] 试播（走 401 → SAPI 兜底，出声即队列全链路通）
  const sp = await (await fetch(BASE + "/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "控制台测试播报", emotion: "happy", rate: 220 }) })).json();
  check("6 POST speak 入队成功", sp.ok === true, JSON.stringify(sp).slice(0, 120));

  // [4] 音色列表
  const voices = await (await fetch(BASE + "/api/voices")).json();
  check("7 GET voices 9 个 MiMo 音色", Array.isArray(voices) && voices.length === 9, "count=" + voices.length);

  // [5] 页面
  const html = await (await fetch(BASE + "/")).text();
  check("8 页面标题渲染", html.includes("agent-voice 控制台") && html.includes("配置编辑"));

  // [6] 配置保存：脱敏字段还原 + 修改生效
  const edited = JSON.parse(JSON.stringify(cfg));
  edited.rate = 250;
  const saveRes = await (await fetch(BASE + "/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) })).json();
  check("9 POST config 保存成功", saveRes.ok === true);
  const savedRaw = JSON.parse(readFileSync(cfgPath, "utf8"));
  check("10 保存后 Key 还原（非****）", savedRaw.cloud?.mimo?.apiKey === "test-key-1234567890", savedRaw.cloud?.mimo?.apiKey);
  check("11 保存后 rate=250 生效", savedRaw.rate === 250);

  // [7] 非法 JSON 拒绝写入
  const badRes = await (await fetch(BASE + "/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{ not json" })).json();
  check("12 非法 JSON 返回 400", badRes.error?.includes("语法错误"), JSON.stringify(badRes));
  const afterBad = JSON.parse(readFileSync(cfgPath, "utf8"));
  check("13 非法写入未破坏文件", afterBad.rate === 250);

  // [8] CSRF / DNS rebinding 防护
  const csrf = await fetch(BASE + "/api/status", { headers: { Origin: "https://evil.com" } });
  check("14 恶意 Origin 被 403", csrf.status === 403);
  const { request } = await import("node:http");
  const hostStatus = await new Promise((resolve) => {
    const r = request(BASE + "/api/status", { headers: { Host: "evil.com" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    r.on("error", () => resolve(0));
    r.end();
  });
  check("15 恶意 Host 被 403", hostStatus === 403, "status=" + hostStatus);
  const local = await fetch(BASE + "/api/status", { headers: { Origin: "http://127.0.0.1:47615" } });
  check("16 本机 Origin 放行", local.status === 200);
} catch (e) {
  console.error("TEST CRASH:", e);
} finally {
  proc.kill();
  rmSync(cfgPath, { force: true });
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n结果: ${results.length - fails}/${results.length} 通过`);
  setTimeout(() => process.exit(fails ? 1 : 0), 300);
}
