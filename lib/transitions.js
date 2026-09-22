// 转场（片段衔接）单一数据源。
// 名称取自 FFmpeg xfade 滤镜；时长统一由 lib/media.js 的 FADE 控制。
// 渲染时刻意保持既有约束：同一时间线要么全部硬切，要么所有衔接处使用同一转场。

export const DEFAULT_TRANSITION = 'fade';

// 有序清单（前端下拉按此顺序分组展示）。全部为 FFmpeg 4.x xfade 内建名。
const RAW = [
  ['fade', '交叉溶解'],
  ['fadeblack', '黑场过渡'],
  ['fadewhite', '白场过渡'],
  ['fadegrays', '灰度过渡'],
  ['dissolve', '随机溶解'],
  ['distance', '距离过渡'],
  ['pixelize', '像素化'],
  ['hblur', '模糊过渡'],
  ['wipeleft', '左擦除'],
  ['wiperight', '右擦除'],
  ['wipeup', '上擦除'],
  ['wipedown', '下擦除'],
  ['wipetl', '擦向左上'],
  ['wipetr', '擦向右上'],
  ['wipebl', '擦向左下'],
  ['wipebr', '擦向右下'],
  ['slideleft', '左滑入'],
  ['slideright', '右滑入'],
  ['slideup', '上滑入'],
  ['slidedown', '下滑入'],
  ['smoothleft', '左顺滑'],
  ['smoothright', '右顺滑'],
  ['smoothup', '上顺滑'],
  ['smoothdown', '下顺滑'],
  ['circlecrop', '圆裁剪'],
  ['circleopen', '圆形展开'],
  ['circleclose', '圆形收起'],
  ['vertopen', '竖向展开'],
  ['vertclose', '竖向收起'],
  ['horzopen', '横向展开'],
  ['horzclose', '横向收起'],
  ['radial', '径向展开'],
  ['rectcrop', '矩形裁剪'],
  ['diagtl', '斜向左上'],
  ['diagtr', '斜向右上'],
  ['diagbl', '斜向左下'],
  ['diagbr', '斜向右下'],
  ['hlslice', '水平切片'],
  ['hrslice', '水平切片（反向）'],
  ['vuslice', '垂直切片'],
  ['vdslice', '垂直切片（反向）'],
  ['squeezeh', '水平挤压'],
  ['squeezev', '垂直挤压'],
];

export const TRANSITIONS = RAW.map(([name]) => name);
export const TRANSITION_LABELS = Object.fromEntries(RAW);
const SET = new Set(TRANSITIONS);

export function isTransition(value) {
  return typeof value === 'string' && SET.has(value);
}

// 归一化：空值返回 ''（表示硬切）；合法名原样返回；非法名抛错（由调用方决定是否包装为 400）。
export function normalizeTransition(value) {
  if (value === undefined || value === null || value === '') return '';
  if (!isTransition(value)) throw Object.assign(new Error('转场类型无效'), {status: 400});
  return value;
}

// 暴露给前端的清单（含中文标签，保证前端下拉与服务端校验同源）。
export function publicTransitions() {
  return RAW.map(([name, label]) => ({name, label}));
}
