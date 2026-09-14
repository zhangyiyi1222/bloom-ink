import { renderMarkdown, markdownToPlainText, countWords } from '../src/server/markdown.mjs';

/* 渲染器冒烟测试：把每种正文元素单独渲染一遍，肉眼扫一眼 HTML 是否合理。 */
const samples = {
  图片: '![说明](/uploads/a.png "图下方说明")',
  宽图: '![宽图](/uploads/a.png){.wide}',
  满宽: '![满宽](/uploads/a.png){.full}',
  双图: '![a](/uploads/a.png)\n![b](/uploads/b.png)',
  视频: '![短片](/uploads/clip.mp4 "海边的十秒")',
  音频: '![录音](/uploads/voice.mp3)',
  嵌入: 'https://www.bilibili.com/video/BV1xx411c7mD',
  代码: '```js\nconst hello = "world";\nconsole.log(hello);\n```',
  表格: '| 一 | 二 |\n| --- | --- |\n| 内容 | 内容 |',
  引用: '> 一句话引用',
  脚注: '一句带脚注的话[^1]\n\n[^1]: 脚注内容',
  公式: '行内 $a^2+b^2=c^2$\n\n$$\n\\int_0^1 x^2 dx\n$$',
  标题: '# 一级\n\n## 二级\n\n### 三级',
  分割线: '---',
  链接: '一个[外链](https://yihui.org/cn/)和一个[内链](/bloom/)',
};

let failed = 0;
for (const [name, source] of Object.entries(samples)) {
  const html = renderMarkdown(source);
  const openTags = (html.match(/<(?!\/)[a-z][^>]*>/g) || []).length;
  const noAttrsOnClose = !/<\/(div|p|figure|table)[^>]*\s[a-z-]+=/.test(html);
  const balanced =
    (html.match(/<figure/g) || []).length === (html.match(/<\/figure>/g) || []).length &&
    (html.match(/<iframe/g) || []).length === (html.match(/<\/iframe>/g) || []).length &&
    (html.match(/<div/g) || []).length === (html.match(/<\/div>/g) || []).length &&
    (html.match(/<p>/g) || []).length === (html.match(/<\/p>/g) || []).length &&
    (html.match(/<table/g) || []).length === (html.match(/<\/table>/g) || []).length;
  const noFigureInP = !/<p>\s*<figure/.test(html);
  const ok = balanced && noFigureInP && noAttrsOnClose;
  if (!ok) failed += 1;
  console.log('');
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}  (${openTags} 个标签)`);
  console.log(html.trim().replace(/\n/g, '\n       ').slice(0, 480));
}

const plain = markdownToPlainText('# 标题\n\n一段**文字**，带 [链接](https://x.com) 与 `代码`。');
console.log('');
console.log(`纯文本提取：${plain}`);
console.log(`字数统计：${countWords('# 标题\n\n一段文字，带 English words 与 123。')}`);

if (failed) {
  console.error(`\n有 ${failed} 个样例结构不对。`);
  process.exit(1);
}
console.log('\n所有样例结构正常。');
