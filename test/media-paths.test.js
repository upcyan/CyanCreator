import test from 'node:test';
import assert from 'node:assert/strict';
import {ffmpegPath, ffprobePath, run} from '../lib/media.js';

// G3 回归：所有媒体二进制调用必须经由统一解析器，遵循环境变量覆盖。
// 若某处绕过解析器直接 import ffmpeg-static，环境变量注入（部署时的离线二进制替换）会静默失效。
test('媒体二进制解析：环境变量优先，缺失时回退静态二进制', () => {
  const savedF = process.env.FFMPEG_PATH, savedP = process.env.FFPROBE_PATH;
  try {
    delete process.env.FFMPEG_PATH; delete process.env.FFPROBE_PATH;
    const fallbackF = ffmpegPath(), fallbackP = ffprobePath();
    assert.equal(typeof fallbackF, 'string');
    assert.ok(fallbackF.length > 0, 'ffmpeg 回退路径非空');
    assert.ok(fallbackP.length > 0, 'ffprobe 回退路径非空');
    process.env.FFMPEG_PATH = '/custom/ffmpeg-under-test';
    process.env.FFPROBE_PATH = '/custom/ffprobe-under-test';
    assert.equal(ffmpegPath(), '/custom/ffmpeg-under-test', 'FFMPEG_PATH 必须优先于静态二进制');
    assert.equal(ffprobePath(), '/custom/ffprobe-under-test', 'FFPROBE_PATH 必须优先于静态二进制');
  } finally {
    if (savedF === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = savedF;
    if (savedP === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = savedP;
  }
});

test('媒体二进制覆盖生效：指向不存在的路径时以 ENOENT 失败，而非静默回退', async () => {
  const saved = process.env.FFMPEG_PATH;
  try {
    process.env.FFMPEG_PATH = '/nonexistent/ffmpeg-g3-probe';
    assert.equal(ffmpegPath(), '/nonexistent/ffmpeg-g3-probe');
    await assert.rejects(() => run(ffmpegPath(), ['-version']), (e) => e && (e.code === 'ENOENT' || /ENOENT/.test(e.message)));
  } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved;
  }
});

// G3 静态检查：lib/ 下不得再有绕过解析器的直接调用/导入
test('lib 下不再直接引用 ffmpeg-static 二进制（统一走解析器）', async () => {
  const {readFile, readdir} = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.resolve('lib');
  const offenders = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.js'))) {
    const src = await readFile(path.join(dir, f), 'utf8');
    // 允许 import（解析器需要拿回退值），但不允许在 run() 调用点直接用变量
    // 允许解析器定义本身引用环境变量（media.js 的 ffmpegPath/ffprobePath）；其余调用点必须走解析器
    const srcNoDef = src.replace(/export const (ffmpegPath|ffprobePath) = \(\) =>[^;]+;/g, '');
    const calls = srcNoDef.match(/run\(\s*(process\.env\.(FFMPEG|FFPROBE)_PATH\s*\|\|\s*)?(ffmpeg|ffprobe)\.?[a-z]*\s*[,)]/g) || [];
    const inline = srcNoDef.match(/process\.env\.(FFMPEG|FFPROBE)_PATH\s*\|\|/g) || [];
    if (calls.length || inline.length) offenders.push(`${f}: calls=${calls.length} inlineEnv=${inline.length}`);
  }
  assert.deepEqual(offenders, [], '存在绕过 ffmpegPath()/ffprobePath() 的调用点：' + offenders.join('; '));
});
