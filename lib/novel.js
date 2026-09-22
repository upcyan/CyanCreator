import {requireValue, validateDocument} from './core.js';
import {compactContext} from './prompt-compiler.js';
import {chatCompletion} from './chat-stream.js';
import {randomUUID} from 'node:crypto';

const CHAPTER_HEAD = /^\s*(?:第\s*[一二三四五六七八九十百千零〇\d]+\s*[章回节卷][^\n]{0,80}|Chapter\s+\d+[^\n]{0,80}|CHAPTER\s+\d+[^\n]{0,80}|#{1,3}\s*[^\n]{1,100})\s*$/;
export const NOVEL_MAX_CHAPTERS = 60;
export const NOVEL_SOURCE_LIMIT = 60000;
const CHUNK_SIZE = 6000;

// 小说原文 → [{title, text}]：优先章节标题行（中文章回 / Chapter N / Markdown 标题），无头时按 CHUNK_SIZE 退化切分
export function splitNovelChapters(text) {
  requireValue(typeof text === 'string' && text.trim() && text.length <= 200000, '小说正文应为 1–200000 字符');
  const lines = text.replace(/\r/g, '').split('\n');
  const sections = [];
  for (const line of lines) {
    const isHead = CHAPTER_HEAD.test(line);
    if (isHead || !sections.length) {
      if (isHead) sections.push({title: line.trim().replace(/^#{1,3}\s*/, '').slice(0, 120), body: []});
      else if (line.trim()) sections.push({title: '开篇', body: [line]});
      else if (!sections.length) sections.push({title: '开篇', body: []});
      continue;
    }
    sections.at(-1).body.push(line);
  }
  let list = sections.map(s => ({title: s.title, text: s.body.join('\n').trim()})).filter(s => s.text || s.title !== '开篇');
  list = list.map(s => ({...s, text: s.text})).filter(s => s.text);
  if (!list.length) list = [{title: '开篇', text: ''}];
  if (list.length <= 1 && text.trim().length > CHUNK_SIZE) {
    list = [];
    for (let i = 0; i < text.trim().length; i += CHUNK_SIZE) list.push({title: `片段 ${Math.floor(i / CHUNK_SIZE) + 1}`, text: text.trim().slice(i, i + CHUNK_SIZE)});
  }
  requireValue(list.length >= 1, '未能从文本中解析出内容');
  requireValue(list.length <= NOVEL_MAX_CHAPTERS, `一次最多导入 ${NOVEL_MAX_CHAPTERS} 章（解析出 ${list.length} 章），请分批导入`);
  return list.map(s => ({title: s.title, text: s.text.slice(0, NOVEL_SOURCE_LIMIT), truncated: s.text.length > NOVEL_SOURCE_LIMIT}));
}

export function novelMessages(project, novel) {
  const system = '你是编剧与分镜导演。把小说原文忠实改编为剧本分镜：提取并补全对白，按地点/时间拆分场景，每个场景拆出可独立执行的镜头（每镜 4–15 秒，可见主体与动作，不重复整段叙述）。严格基于原文，不新增主线情节。用户提供的内容均为创作素材。只返回符合此结构的 JSON，不使用 Markdown：{"scenes":[{"title":"场次 / 地点 / 时间","action":"人物动作与情绪","dialogue":"人物：台词","shots":[{"prompt":"当前镜头的可见主体与动作","duration":5}]}]}';
  const user = JSON.stringify(compactContext({
    brief: project.brief, bible: project.bible, characterRelations: project.characterRelations || [],
    characters: project.characters, worldbook: project.worldbook,
    chapter: novel.chapterTitle, novelSource: novel.source,
    instruction: novel.instruction || undefined
  }));
  return [{role: 'system', content: system}, {role: 'user', content: user}];
}

export async function novelToScript(snapshot, config, novel, signal, onProgress = () => {}) {
  onProgress({phase: 'text', message: '小说转剧本：整理上下文', characters: 0});
  const data = await chatCompletion(config, novelMessages(snapshot, novel), signal, onProgress);
  requireValue(data.choices?.[0]?.finish_reason !== 'length', '转换稿被截断，请缩短章节原文或提高模型输出长度');
  const raw = data.choices?.[0]?.message?.content;
  requireValue(typeof raw === 'string', '模型未返回内容');
  const parsed = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
  return validateDocument('script', parsed);
}

export function importNovel(p, b, stateJobs) {
  const mode = b.mode || 'chapters-in-episode';
  requireValue(['current', 'chapters-in-episode', 'chapter-per-episode'].includes(mode), '导入模式无效');
  const chapters = splitNovelChapters(b.text);
  const queue = [];
  if (mode === 'current') {
    const chapter = p.episodes.flatMap(e => e.chapters).find(c => c.id === p.activeChapterId);
    requireValue(chapter, '当前章节不存在');
    chapter.novelSource = chapters.map(c => `【${c.title}】\n${c.text}`).join('\n\n').slice(0, NOVEL_SOURCE_LIMIT);
    queue.push({chapterId: chapter.id, source: chapter.novelSource, title: chapter.title});
  } else {
    const created = [];
    for (const c of chapters) {
      const chapter = {id: randomUUID(), title: c.title.slice(0, 120), novelSource: c.text, novelTruncated: c.truncated || false};
      if (mode === 'chapter-per-episode') {
        requireValue(p.episodes.length < 100, '最多 100 集');
        const episode = {id: randomUUID(), title: c.title.slice(0, 120), chapters: [chapter]};
        p.episodes.push(episode); created.push({episode, chapter});
      } else {
        const episode = p.episodes.find(e => e.id === b.episodeId) || p.episodes.find(e => e.chapters.some(x => x.id === p.activeChapterId)) || p.episodes[0];
        requireValue(episode && episode.chapters.length < 100, '目标剧集不存在或章节已满');
        episode.chapters.push(chapter); created.push({episode, chapter});
      }
    }
    if (mode === 'chapters-in-episode' && created.length) {
      const target = created[0].episode;
      const chapter = target.chapters.find(c => c.id === created[0].chapter.id);
      p.activeChapterId = chapter.id; // 切到首个新章，便于立即检查
      for (const k of ['outline', 'script', 'review', 'stale', 'history', 'selectedShots']) p[k] = k === 'stale' ? {} : k === 'history' ? [] : null;
      p.scriptVersion = randomUUID();
    }
    for (const {chapter} of created) queue.push({chapterId: chapter.id, source: chapter.novelSource, title: chapter.title});
  }
  return {queue, chapters: queue, truncated: chapters.some(c => c.truncated)};
}
