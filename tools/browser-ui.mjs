// 浏览器 UI 回归：AI 伴写悬浮按钮与弹窗（node --test 集成，零 npm 依赖）
//
// 覆盖不变量（与 2026-09 修复 af0406d/36ca53e 的验收口径一致）：
//   1) 聚焦可伴写字段 → 按钮出现并贴合字段（±2px）；滚动时持续跟随；字段滚出视口 → 按钮隐藏
//   2) 弹窗打开瞬间即锚定按钮旁 10px（下方/上方，两侧不足时限高贴住），四边不出视口
//   3) 弹窗打开时滚远 → 挂起；滚回 → 按钮与弹窗恢复且输入内容保留
//   4) 弹窗内部滚动不被跟随重置；反复开关位置稳定；ESC 收起
//   5) 剧本分镜页同样跟随；字段 DOM 被替换后守卫不误报、复焦恢复
//
// 运行：npm run ui            （自动拉起独立服务 + 无头 Chrome，互不影响正在运行的实例）
//      不随 npm test 默认执行，避免常规测试隐式依赖浏览器；找不到 Chromium 时自动 skip。
// 前置：本机有 Chromium/Chrome（CHROME_PATH 可指定）；Linux 追加 --no-sandbox 由本工具自带。
// 产物：test-output/ui-tools/（截图与 ui-report.json；该目录已被 .gitignore 忽略）
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-output', 'ui-tools');
const VIEWPORTS = [[1366, 768, 1], [800, 480, 1.5]];
const MODEL_ROW_CASES = [1, 12];
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

// ---------- 基础设施 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const {port} = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
class CDP {
  constructor(url) { this.url = url; this.seq = 1; this.pending = new Map(); }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
      this.ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && this.pending.has(m.id)) {
          const {resolve, reject} = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? reject(new Error('CDP ' + m.error.message)) : resolve(m.result);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      this.pending.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  close() { try { this.ws.close(); } catch { /* 已断开 */ } }
}
async function startServer(dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {...process.env, PORT: '0', CYANCREATOR_DATA: dataDir},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', d => process.env.UI_DEBUG && console.error('[server]', String(d)));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务 10s 内未报告端口')), 10000);
    child.stdout.on('data', d => {
      const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('服务进程退出 code=' + code)); });
  });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/state`); if (r.ok) return {child, port}; } catch { /* 未就绪 */ }
    await sleep(250);
  }
  child.kill();
  throw new Error('服务未就绪');
}
async function startChrome(cdpPort, profileDir) {
  const candidates = [process.env.CHROME_PATH, '/usr/local/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'chromium', 'google-chrome'].filter(Boolean);
  for (const exe of candidates) {
    const child = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, 'about:blank'], {stdio: 'ignore'});
    await sleep(300);
    if (child.exitCode !== null) continue; // 立即退出（找不到可执行文件等）
    for (let i = 0; i < 60; i++) {
      try {
        const ver = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (ver.ok) return {child, wsUrl: (await ver.json()).webSocketDebuggerUrl};
      } catch { /* 未就绪 */ }
      await sleep(300);
    }
    child.kill();
  }
  return null;
}

// ---------- 页面探针 ----------
const findField = `(()=>{const f=[...document.querySelectorAll('textarea[data-doc-path]')].find(t=>t.getBoundingClientRect().width>10);window.__uitest={field:f};return f?{path:f.dataset.docPath,w:Math.round(f.getBoundingClientRect().width)}:null;})()`;
const floatGeo = `(()=>{const fl=document.querySelector('#assist-float'),f=window.__uitest.field;if(!fl||!f)return null;
  const r=f.getBoundingClientRect(),fh=fl.offsetHeight||34,fw=fl.offsetWidth||110;
  let top=r.bottom+8;if(top+fh>innerHeight-8)top=Math.max(8,r.top-fh-8);
  const left=Math.min(Math.max(r.left,10),Math.max(10,innerWidth-fw-10));
  return {hidden:fl.hidden,top:fl.getBoundingClientRect().top,left:fl.getBoundingClientRect().left,expTop:top,expLeft:left,
    fieldVisible:r.bottom>=40&&r.top<=innerHeight-8};})()`;

test('浏览器 UI 回归：AI 伴写按钮/弹窗（锚定、滚动同步、挂起恢复、多页与边界）', {timeout: 600000}, async t => {
  await mkdir(OUT, {recursive: true});
  const workDir = await mkdtemp(path.join(tmpdir(), 'cyan-ui-'));
  const dataDir = path.join(workDir, 'data');
  const report = [];
  const step = (tag, ok, detail = '') => { report.push({tag, ok, detail: String(detail)}); console.log((ok ? 'PASS' : 'FAIL') + ' ' + tag + (detail ? ' · ' + detail : '')); };

  // 独立数据目录 + 随机端口，避免干扰正在运行的工作台
  const {child: serverProc, port: BASE} = await startServer(dataDir);
  const cdpPort = await freePort();
  const chrome = await startChrome(cdpPort, path.join(workDir, 'chrome-profile'));
  if (!chrome) {
    serverProc.kill();
    t.skip('未找到可用的 Chrome/Chromium（可用 CHROME_PATH 指定）；跳过浏览器 UI 回归');
    return;
  }
  const cdp = new CDP(chrome.wsUrl);
  await cdp.connect();
  const {targetId} = await cdp.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');

  const evalJs = async expr => {
    const r = await S('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
    return r.result?.value;
  };
  const nav = async url => { await S('Page.navigate', {url}); await sleep(1400); };
  const clickSel = async sel => {
    const pt = await evalJs(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el||el.hidden)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.ok(pt, '可点击元素存在：' + sel);
    await S('Input.dispatchMouseEvent', {type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1});
    await S('Input.dispatchMouseEvent', {type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1});
  };
  const shot = async name => {
    const s = await S('Page.captureScreenshot', {format: 'png'});
    await writeFile(path.join(OUT, name), Buffer.from(s.data, 'base64'));
  };
  const setupViewport = async (w, h, sf) => { await S('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: sf, mobile: false}); };
  const gotoOutline = async () => {
    await evalJs(`(async()=>{const n=[...document.querySelectorAll('.nav button')].find(b=>b.textContent.includes('故事大纲'));if(n)n.click();await new Promise(r=>setTimeout(r,450));return 1;})()`);
    for (let i = 0; i < 30; i++) {
      const f = await evalJs(findField).catch(() => null);
      if (f) return f;
      await sleep(150);
    }
    throw new Error('大纲页未找到可伴写字段');
  };
  const scrollBy = async dy => { await evalJs(`window.scrollTo(0,Math.max(0,scrollY+(${dy})));'ok'`); await sleep(160); };
  const scrollFar = async () => { for (let i = 0; i < 15; i++) { await scrollBy(650); const out = await evalJs(`(()=>{const f=window.__uitest.field,r=f.getBoundingClientRect();return r.bottom<40||r.top>innerHeight-8;})()`); if (out) return true; } return false; };
  const scrollBack = async () => { for (let i = 0; i < 15; i++) { await scrollBy(-650); const ok = await evalJs(`(()=>{const f=window.__uitest.field,r=f.getBoundingClientRect();return r.bottom>=60&&r.top<=innerHeight-20;})()`); if (ok) return true; } return false; };
  const escapePop = async () => { await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));'ok'`); await sleep(150); };
  // 聚焦可伴写字段并垂直居中：直接 focus 会滚动到字段，但仍可能贴边；显式居中后定位断言可复现。
  const centerField = async () => {
    await evalJs('(window.__uitest.field.scrollIntoView({block:\'center\'}),window.__uitest.field.focus(),\'ok\')');
    await sleep(320);
    await evalJs(`(()=>{const f=window.__uitest.field;const docTop=f.getBoundingClientRect().top+scrollY;window.scrollTo(0,Math.max(0,docTop-Math.floor(innerHeight/2)));return 'ok';})()`);
    await sleep(260);
  };

  try {
    // ===== 准备：干净数据目录里创建项目并进入大纲页 =====
    // 写操作需要工作区令牌与同源 Origin（见 server.js 认证中间件）；令牌从公开的 GET /api/state 获取。
    const base = `http://127.0.0.1:${BASE}`;
    const st = await fetch(`${base}/api/state`).then(r => r.json());
    const authHeaders = {'content-type': 'application/json', 'x-workspace-token': st.token, origin: base};
    const created = await fetch(`${base}/api/projects`, {method: 'POST', headers: authHeaders, body: JSON.stringify({name: 'UI 回归冒烟'})});
    assert.equal(created.status, 201, '项目创建成功（201）');
    const project = await created.json();
    await nav(`http://127.0.0.1:${BASE}/`);
    await evalJs(`localStorage.setItem('projectId', ${JSON.stringify(project.id)});'ok'`);
    await nav(`http://127.0.0.1:${BASE}/`);
    await gotoOutline();
    step('setup:project-and-outline-field', true, 'projectId=' + project.id.slice(0, 8) + '…');

    for (const [W, H, SF] of VIEWPORTS) {
      await setupViewport(W, H, SF);
      await nav(`http://127.0.0.1:${BASE}/`);
      const field = await gotoOutline();
      const vp = `${W}x${H}@${SF}`;

      // --- 1) 聚焦 → 按钮出现并贴合字段；多滚动站点不变量 ---
      await centerField();
      let g = await evalJs(floatGeo);
      step(vp + ':float-shown-on-focus', g && !g.hidden, 'hidden=' + (g && g.hidden));
      step(vp + ':float-anchored', Math.abs(g.top - g.expTop) <= 2 && Math.abs(g.left - g.expLeft) <= 2, `dy=${(g.top - g.expTop).toFixed(1)} dx=${(g.left - g.expLeft).toFixed(1)}`);

      const maxScroll = await evalJs('Math.max(0,document.documentElement.scrollHeight-innerHeight)');
      const docTop = await evalJs('window.__uitest.field.getBoundingClientRect().top+scrollY');
      const base = Math.min(Math.max(0, docTop - Math.floor(H / 2)), maxScroll);
      const spots = [...new Set([Math.max(0, base - 200), base, Math.min(maxScroll, base + 200)])].sort((a, b) => a - b);
      let idx = 0;
      for (const y of spots) {
        idx++;
        await evalJs(`window.scrollTo(0,${y});'ok'`); await sleep(220);
        const inv = await evalJs(floatGeo);
        if (inv.fieldVisible) step(vp + `:follow@spot${idx}(${Math.round(y)})`, !inv.hidden && Math.abs(inv.top - inv.expTop) <= 2 && Math.abs(inv.left - inv.expLeft) <= 2, `dy=${(inv.top - inv.expTop).toFixed(1)}`);
        else step(vp + `:hidden-when-out@spot${idx}(${Math.round(y)})`, inv.hidden === true, 'fieldTop=' + inv.top.toFixed(0));
      }
      // 字段滚出视口 → 按钮隐藏
      await evalJs(`window.scrollTo(0,0);'ok'`); await sleep(200);
      await evalJs(`window.scrollTo(0,${maxScroll});'ok'`); await sleep(240);
      const outInv = await evalJs(floatGeo);
      step(vp + ':hidden-when-field-out', outInv.fieldVisible ? true : outInv.hidden === true, `fieldVisible=${outInv.fieldVisible} hidden=${outInv.hidden}`);
      await evalJs(`window.scrollTo(0,${base});'ok'`); await sleep(240);

      // --- 2) 弹窗打开即锚定按钮（多模型行数）+ 视口内 ---
      for (const rows of MODEL_ROW_CASES) {
        await evalJs(`(()=>{const checks=document.querySelector('#assist-pop-models');checks.innerHTML=Array.from({length:${rows}},(_,i)=>'<label class="assist-model-check"><input type="checkbox" value="p'+i+'" checked> 模型'+(i+1)+' · some-model-name</label>').join('');return 'ok';})()`);
        await clickSel('#assist-float-btn');
        await sleep(260);
        const m = await evalJs(`(()=>{const pop=document.querySelector('#assist-pop'),fl=document.querySelector('#assist-float'),p=pop.getBoundingClientRect(),b=fl.getBoundingClientRect();
          return {ph:pop.hidden,pt:p.top,pb:p.bottom,pl:p.left,pr:p.right,bt:b.top,bb:b.bottom,vw:innerWidth,vh:innerHeight,mh:pop.style.maxHeight};})()`);
        const gapB = m.pt - m.bb, gapA = m.bt - m.pb;
        step(vp + `:pop-open@rows${rows}`, m.ph === false, 'maxH=' + (m.mh || '-'));
        step(vp + `:pop-anchored@rows${rows}`, Math.abs(gapB - 10) <= 4 || Math.abs(gapA - 10) <= 4, `gapBelow=${gapB.toFixed(1)} gapAbove=${gapA.toFixed(1)}`);
        step(vp + `:pop-in-viewport@rows${rows}`, m.pt >= -1 && m.pb <= m.vh + 1 && m.pl >= -1 && m.pr <= m.vw + 1, `pop=[${m.pl.toFixed(0)},${m.pt.toFixed(0)},${m.pr.toFixed(0)},${m.pb.toFixed(0)}]`);

        if (rows === MODEL_ROW_CASES[MODEL_ROW_CASES.length - 1]) {
          // --- 3) 滚远挂起 / 滚回恢复（含输入保留）---
          // 弹窗限高时内部已滚动，直接点文本框中心可能落空；改用程序化聚焦后 insertText。
          await evalJs(`document.querySelector('#assist-pop-text').focus();'ok'`);
          await sleep(140);
          await S('Input.insertText', {text: 'UI回归内容ABC'});
          await sleep(140);
          const typed = await evalJs(`document.querySelector('#assist-pop-text').value.includes('UI回归内容ABC')`);
          step(vp + ':typed-in-popup', typed === true);
          await scrollFar();
          const far = await evalJs(`(()=>{const fl=document.querySelector('#assist-float'),pop=document.querySelector('#assist-pop');return {fl:fl.hidden,pop:pop.hidden};})()`);
          step(vp + ':suspended-when-far', far.fl === true, 'fl=' + far.fl + ' pop=' + far.pop);
          const back = await scrollBack();
          const rst = await evalJs(`(()=>{const fl=document.querySelector('#assist-float'),pop=document.querySelector('#assist-pop'),b=fl.getBoundingClientRect(),p=pop.getBoundingClientRect();
            return {fl:fl.hidden,pop:pop.hidden,gapB:p.top-b.bottom,gapA:b.top-p.bottom,text:document.querySelector('#assist-pop-text').value.includes('UI回归内容ABC')};})()`);
          step(vp + ':scrolled-back', back === true, 'field visible again');
          step(vp + ':float-restored', rst.fl === false);
          step(vp + ':popup-restored', rst.pop === false);
          step(vp + ':popup-restored-anchored', Math.abs(rst.gapB - 10) <= 4 || Math.abs(rst.gapA - 10) <= 4, `gapB=${rst.gapB.toFixed(1)} gapA=${rst.gapA.toFixed(1)}`);
          step(vp + ':input-preserved', rst.text === true);
          await shot(vp.includes('800') ? 'scrollback-800.png' : 'scrollback-1366.png');

          // --- 4) 内部滚动不重置 + 反复开关稳定 ---
          const before = await evalJs(`(()=>{const pop=document.querySelector('#assist-pop');pop.scrollTop=160;return pop.scrollTop;})()`);
          await sleep(400);
          const scr = await evalJs(`(()=>{const pop=document.querySelector('#assist-pop');return {after:pop.scrollTop,mh:pop.style.maxHeight};})()`);
          step(vp + ':internal-scroll-kept', Math.abs(scr.after - before) <= 4, `before=${before} after=${scr.after} maxH=${scr.mh}`);
          const pos1 = await evalJs(`(()=>{const p=document.querySelector('#assist-pop').getBoundingClientRect();return {t:p.top,h:p.height};})()`);
          await escapePop();
          await clickSel('#assist-float-btn');
          await sleep(300);
          const pos2 = await evalJs(`(()=>{const p=document.querySelector('#assist-pop').getBoundingClientRect(),b=document.querySelector('#assist-float').getBoundingClientRect();return {t:p.top,h:p.height,gapB:p.top-b.bottom,gapA:b.top-p.bottom};})()`);
          step(vp + ':reopen-stable', Math.abs(pos1.t - pos2.t) <= 2 && Math.abs(pos1.h - pos2.h) <= 2, `t1=${pos1.t.toFixed(0)} t2=${pos2.t.toFixed(0)}`);
          step(vp + ':reopen-anchored', Math.abs(pos2.gapB - 10) <= 4 || Math.abs(pos2.gapA - 10) <= 4);
          await escapePop();

          // --- 5) 无弹窗时：滚远隐藏 / 滚回恢复按钮 ---
          await centerField();
          const shownAgain = await evalJs(`!document.querySelector('#assist-float').hidden`);
          step(vp + ':float-shown-after-close', shownAgain === true);
          if (await scrollFar()) {
            const hid = await evalJs(`document.querySelector('#assist-float').hidden`);
            step(vp + ':button-hidden-when-far', hid === true);
            await scrollBack();
            const shw = await evalJs(`document.querySelector('#assist-float').hidden`);
            step(vp + ':button-restored', shw === false);
          }
        } else {
          await escapePop();
        }
      }
    }

    // --- 6) 剧本分镜页 ---
    await setupViewport(1366, 768, 1);
    await nav(`http://127.0.0.1:${BASE}/`);
    await evalJs(`(async()=>{const n=[...document.querySelectorAll('.nav button')].find(b=>b.textContent.includes('剧本分镜'));if(n)n.click();await new Promise(r=>setTimeout(r,600));return 1;})()`);
    for (let i = 0; i < 30 && !(await evalJs(findField).catch(() => null)); i++) await sleep(150);
    await centerField();
    const sg = await evalJs(floatGeo);
    step('script-page:float-shown', sg && !sg.hidden);
    const smax = await evalJs('Math.max(0,document.documentElement.scrollHeight-innerHeight)');
    const sTarget = await evalJs('Math.min(' + smax + ',Math.round(window.__uitest.field.getBoundingClientRect().top+scrollY-200))');
    await evalJs(`window.scrollTo(0,${sTarget});'ok'`); await sleep(320);
    const sf2 = await evalJs(floatGeo);
    if (sf2.fieldVisible) step('script-page:follows-scroll', Math.abs(sf2.top - sf2.expTop) <= 2 && Math.abs(sf2.left - sf2.expLeft) <= 2, `dy=${(sf2.top - sf2.expTop).toFixed(1)}`);
    else step('script-page:follows-scroll', sf2.hidden === true, 'field out → hidden');
    await clickSel('#assist-float-btn');
    await sleep(260);
    const sp = await evalJs(`(()=>{const p=document.querySelector('#assist-pop').getBoundingClientRect();return {hidden:document.querySelector('#assist-pop').hidden,t:p.top,b:p.bottom,l:p.left,r:p.right,vh:innerHeight,vw:innerWidth};})()`);
    step('script-page:pop-open-in-viewport', sp.hidden === false && sp.t >= -1 && sp.b <= sp.vh + 1 && sp.l >= -1 && sp.r <= sp.vw + 1, `pop=[${sp.l.toFixed(0)},${sp.t.toFixed(0)},${sp.r.toFixed(0)},${sp.b.toFixed(0)}]`);
    await escapePop();

    // --- 7) 字段 DOM 被替换：isConnected 守卫与复焦恢复 ---
    await nav(`http://127.0.0.1:${BASE}/`);
    await gotoOutline();
    await centerField();
    const edge = await evalJs(`(async()=>{
      const f=window.__uitest.field,fl=document.querySelector('#assist-float');
      const clone=f.cloneNode(true);f.parentNode.insertBefore(clone,f);f.remove();
      window.scrollTo(0,scrollY+120);await new Promise(r=>setTimeout(r,320));
      const hiddenAfterRemove=fl.hidden;
      clone.focus();await new Promise(r=>setTimeout(r,300));
      const shownAfterRefocus=!fl.hidden;
      window.__uitest.field=clone;
      window.scrollTo(0,Math.max(0,scrollY-100));await new Promise(r=>setTimeout(r,320));
      const r=clone.getBoundingClientRect(),fh=fl.offsetHeight||34,fw=fl.offsetWidth||110;
      let top=r.bottom+8;if(top+fh>innerHeight-8)top=Math.max(8,r.top-fh-8);
      const left=Math.min(Math.max(r.left,10),Math.max(10,innerWidth-fw-10));
      const vis=r.bottom>=40&&r.top<=innerHeight-8;
      const b=fl.getBoundingClientRect();
      return {hiddenAfterRemove,shownAfterRefocus,follows:vis?(Math.abs(b.top-top)<=2&&Math.abs(b.left-left)<=2):fl.hidden===true};
    })()`);
    step('edge:field-replaced-hides', edge.hiddenAfterRemove === true);
    step('edge:refocus-new-field-shows', edge.shownAfterRefocus === true);
    step('edge:follows-new-field', edge.follows === true);
    await evalJs(`(()=>{const f=window.__uitest.field;if(f)f.blur();window.scrollTo(0,0);return 'ok';})()`);

    // ===== 汇总 =====
    const total = report.length, pass = report.filter(r => r.ok).length;
    await writeFile(path.join(OUT, 'ui-report.json'), JSON.stringify({base: 'http://127.0.0.1:' + BASE, total, pass, steps: report}, null, 1));
    console.log(`\n浏览器 UI 回归：${pass}/${total} ${pass === total ? 'ALL-PASS' : 'HAS-FAIL'}（耗时 ${since()}；报告：test-output/ui-tools/ui-report.json）`);
    assert.equal(pass, total, '全部 UI 断言通过');
  } finally {
    // 先结束浏览器再断开 socket：Browser.close 会自行关闭连接，此时再 await 响应会永久挂起。
    try { chrome.child.kill('SIGKILL'); } catch { /* 已退出 */ }
    cdp.close();
    try { serverProc.kill('SIGKILL'); } catch { /* 已退出 */ }
    await sleep(500);
    await rm(workDir, {recursive: true, force: true}).catch(() => {});
  }
});
