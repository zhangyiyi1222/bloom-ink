import { all, get, run } from './db.mjs';
import { createArticle, getArticle } from './articles.mjs';
import { saveUpload } from './media.mjs';
import { storeVisual, activateVisual, activeVisual } from './visuals.mjs';
import { createSocialLink, listSocialLinks, setSetting, getSettings } from './settings.mjs';
import { rebuildIndex } from './search.mjs';
import { encodePng } from './png.mjs';

/* =====================================================================
   验收用数据：70+ 篇假文章 + 一篇组件测试文章 + 演示媒体。
   目标不是好看，而是把 renderer 的每一种情况都跑一遍。
   ===================================================================== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260914);
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/* ------------------------------- 语料 ------------------------------- */

const POOLS = [
  [
    '早上出门的时候天是灰的，走到路口忽然有了一点太阳，像是有人在上面慢慢掀开一层纸。',
    '我习惯把每天多出来的十分钟留给走路，不走快点，也不走慢点，只是走。',
    '小区门口那棵不知道名字的树，今年比去年多开了一次花，没有人注意，我也不打算告诉谁。',
    '楼下的早点铺换了新的师傅，豆浆还是原来的味道，碗却换成了更浅的颜色。',
    '有时候一天里最清醒的时刻，是端着一杯水站在窗边，什么都不想的那三分钟。',
    '我喜欢看别人家的窗户，亮着的、关着的、拉了一半窗帘的，每一扇都在过一种我猜不到的生活。',
    '走夜路回家，路灯把影子拉得很长，像另一个我走在前面替我探路。',
    '衣服晒在阳台上，风一吹，它们就一起认真地摆动，像是在替这个家呼吸。',
    '超市的收银台前排队，前面的人买了六瓶一样的牛奶，我猜他家里有小孩。',
    '把冰箱擦干净的那天，我才发现原来里面存了那么多过期的酱料，也存着那么多没来得及过的日子。',
    '我常常在很小的决定上花很多时间，比如今天走哪条路回家，但从不后悔选了哪一条。',
    '雨后的空气里有一种旧书的味道，让人想坐在台阶上，把没写完的信接着写完。',
  ],
  [
    '写作这件事，最难的不是写不出来，而是承认写得不好以后还要继续写。',
    '我写字的理由一直在变，从想让别人看见，到想让自己记得，最后只是想把它从身体里拿出来。',
    '真正写下去的时候，会发现脑子里想的那句话和落在纸上的那句话，往往不是一句。',
    '有些句子在白天是站不起来的，只有到很晚，周围安静下来，它们才肯自己走出来。',
    '我不太相信灵感，但我相信坐到桌前。坐到桌前，灵感至少知道该去哪里找我。',
    '一篇东西写完了，常常要放上几天再读，才知道哪一句是自己真心的，哪一句是为了好看。',
    '克制是很难的。你明明有一百个想说的词，却只留一个，那一个才站得住。',
    '写下具体的事，比写下正确的道理更接近生活。',
    '删掉的部分从来不会浪费，它们只是被埋在下面，成了这一篇的地基。',
    '有人问写作有什么好处，我说它让我不必一直重复自己。',
    '每一篇文章其实都是同一个人写的，但每写完一篇，那个人就换了一点点。',
    '把一件小事写到具体，它就自动变成了大事。',
  ],
  [
    '母亲打电话来，先问我吃了没有，再问我忙不忙，最后才说她其实没什么事。',
    '我妈的语文作业一直在我的抽屉里，纸已经有点发黄，字还是很用力。',
    '父亲不太会说话，但他会把家里所有坏了的东西修好，包括我小时候摔断的那辆自行车。',
    '家里的两只鸟，一只总在叫，一只总在听，也不知道它们究竟是谁照顾谁。',
    '过年回家的意义，好像就是重新坐回那个位置上，看父母忙碌，然后插一两句嘴。',
    '我越来越能理解长辈那些重复的话，因为它们本来就不是说给我听的，是说给时间听的。',
    '表哥的小孩已经会自己剥橘子了，我上一次见他，他还只会把橘子往后缩。',
    '老家院子里那口井早就不用了，但每到夏天，我还是会想起从井里提上来的那桶水的凉。',
    '和家人吃饭的时候，聊的都是最小的那些事，菜咸不咸，天气冷不冷，谁的腰又疼了。',
    '有一次我妈说她梦见我在外面走丢了，我说我都这么大了，她说她知道，可她还是梦见。',
    '给父亲买了一双鞋，他试了两圈，说很好，然后放回盒子里，只在下地的时候穿。',
    '我在父母身上看到一种能力：把日子过得没有一句多余的话。',
  ],
  [
    '身体是最诚实的，它总在你还没意识到的时候，先替你做了决定。',
    '跑步跑到第三公里的时候，脑子里那些吵闹的声音忽然都停了，只剩下呼吸。',
    '腰疼的那几天，我才发现原来蹲下来系鞋带是一件需要运气的事。',
    '睡眠不好的人，会在凌晨三点认识另一个自己，那个自己不太讲道理。',
    '我开始认真吃早饭，不是为了健康，是因为发现上午的自己需要一点温柔。',
    '人在累的时候容易苛刻，对自己和对别人都是。所以先睡觉，再决定。',
    '体检报告上第一个箭头出现的时候，有一种很奇怪的安静。',
    '喝够了水，走了足够的路，剩下的情绪有一半会自己散掉。',
    '我终于学会在不想说话的时候就不说话，而不是勉强说点什么填补安静。',
    '朋友说我变了，我说我只是开始按时吃饭了。',
    '一个人真正的底气，有一部分来自他的身体还肯陪他干活。',
    '把灯关掉，把手机放远，把今天结束。这件事并不容易，但值得练。',
  ],
  [
    '钱最诚实的地方在于，它会替你说出你真正在意什么。',
    '记账记了半年，才发现自己最大的开销不是买东西，是那些没想清楚就开始的事。',
    '我不再追求便宜，我开始追求不用再换一次。',
    '有人愿意为你的时间付钱，是一件很轻的确认，但它不能是唯一的确认。',
    '把一件小事做成可以重复的流程，是我这几年学到最值钱的东西。',
    '所有的自由都有一个价格，差别只在于你愿不愿意付、什么时候付。',
    '不要用未来的确定性去换眼前的一点舒服，这句话我写在桌面很多年了。',
    '赚到的第一笔钱是先还债，后来是先买工具，现在是先买时间。',
    '别人怎么看你，和你银行里有多少钱是两回事，但它们经常一起骗人。',
    '把一件事讲清楚，本身就是一种稀缺能力，很多人并不缺技术，只是缺表达。',
    '我越来越喜欢小而稳的东西，它们的复利不响亮，但一直在。',
    '在我这里，长期主义不是口号，是今天晚上还愿意做那一小时。',
  ],
  [
    '技术改变的不是问题本身，而是问题出现的方式。',
    '工具越好用，人越容易忘记自己本来要做什么。',
    '我把常用的东西一个个搬进自己的目录，像把家具搬进一个自己盖的房子。',
    '一个系统如果没人愿意维护，那它在写出来的那一天就已经开始坏了。',
    '写代码和写字很像，都是先把事情想清楚，再挑最少的话说出来。',
    '我不再迷信新的东西，但我愿意花两个小时试一下它到底解决什么问题。',
    '自动化最大的价值不是省时间，是让你每次做同一件事都做得一样。',
    '备份这件事，只有在你需要它的那一天才会显得重要，而那一天通常来得突然。',
    '所有的界面最后都在回答一个问题：这里最重要的一件事是什么。',
    '把复杂的事情拆成可以使用的小块，是我唯一还算信得过的手艺。',
    '我见过最好的产品，都很像一个安静的人，它不抢你的注意力，它只是刚好在那里。',
    '删掉一半功能之后，才看得见这个产品原本想说什么。',
  ],
  [
    '读完一本书之后最好的状态，是很想找人聊两句，又舍不得说。',
    '读书这件事对我最大的用处，是让我知道自己那些想法早就有人想过了，而且想得比我好。',
    '有些书要在三十岁读，二十岁读只会觉得它啰嗦。',
    '我在书上画线的习惯变了很多，以前是什么都画，现在是只画一两句，但会把那两句抄下来。',
    '这两年我读得少了，但重复读的多了，重复读的书反而像新书。',
    '一本书真正改变人的时候，往往不是读的时候，是很久以后某个下午你忽然想起它。',
    '写作者最珍贵的不是聪明，是诚实，因为聪明的人太多了。',
    '喜欢的作家像老朋友，不必常见，但一见就知道不用解释。',
    '我把不喜欢的书也读完，是为了知道自己不喜欢什么，这件事只能自己去做。',
    '好的文章读起来像有人在旁边轻声说话，不急，也不讨好。',
    '书架上那些没读完的书，其实一直在替我保存着某一年的我。',
    '文字这东西，救不了所有人，但它救过一些人，包括我。',
  ],
  [
    '城市最动人的部分不在景点里，在早上六点半的公交站。',
    '出差到了一个陌生的城市，我最喜欢做的是沿着河走，走到不知道是哪里。',
    '我在一座城市住了六年，才第一次走到它最北边，那天风很大，什么也没有。',
    '旅行真正带回来的不是照片，是你在别处过的那几天，那种不一样的呼吸节奏。',
    '在山里待过两天以后，回到城市会觉得声音太多，灯太亮。',
    '我坐过一次夜里的长途火车，醒了三次，每次窗外都是不一样的省份。',
    '住在同一家民宿的客人，第二天就各自散了，谁也不知道谁的名字。',
    '我喜欢把行李装得很简单，这样每到一个地方都可以直接出门。',
    '旅行中最好的东西大多没法拍：一顿饭的味道，一段路的温度，一个人说话的语气。',
    '在陌生的街上走的时候，人特别容易想到一些平时不敢想的事。',
    '我看过的最好的日落是在一个完全没有准备的地方，那天连相机都没带。',
    '回到自己的房间那天晚上，会觉得自己的床比任何酒店都好，然后第二天又开始想出去。',
  ],
  [
    '朋友越来越少，但每一个都越来越真。',
    '好的关系不需要每天联系，但需要的时候对方一定会接电话。',
    '我和老哥坐在饭桌前聊天，聊了两个小时，谁也没说服谁。',
    '有些人只适合在某一段路上同行，这不算可惜，这算正常。',
    '被人理解是一种运气，理解别人是一种能力，两样都很难。',
    '我不再努力让所有人喜欢我，我努力让自己值得被喜欢。',
    '一起吃饭的人，比吃什么重要很多。',
    '有些人的出现就是为了让你知道，你原来可以那样活着。',
    '我开始珍惜那些可以一起沉默的人，不说话也不尴尬，这是很高的标准。',
    '把心里的话说出来，常常比想象中轻松，也比想象中困难。',
    '真正的朋友会告诉你哪里不对，而不是告诉你哪里都对。',
    '人和人之间最舒服的距离，是可以随时靠近，也可以各自安静。',
  ],
  [
    '晚上十点以后的世界是我的，那些时间安静得像被谁特意留出来。',
    '我喜欢听老歌，不是因为怀旧，是因为它们的节奏不着急。',
    '有段时间我每天睡前听同一首歌，后来那首歌就变成了那段时间的名字。',
    '音乐最好的地方在于，它不需要你理解，就能让你安静下来。',
    '我在厨房里洗碗的时候会放音乐，那是这个家最像舞台的一刻。',
    '有些旋律一响起来，你会想起某个具体的下午，具体到阳光落在哪一块地板上。',
    '我把喜欢的歌分成了两种：能写东西的时候听的，和不能写东西的时候听的。',
    '深夜适合做一些不重要但很想做的事，比如听一张完整的专辑。',
    '小时候听的是歌词，后来听的是编曲，现在听的是那个人当时的心情。',
    '我想过写歌，后来发现我更适合写字，把旋律留在别人的手里。',
    '一个人的耳机里和外面的世界，往往是两个季节。',
    '安静下来的时候，会听见很多平时被盖住的声音，包括自己的。',
  ],
];

function paragraphs(count, seedOffset = 0) {
  const pools = shuffle(POOLS.slice(seedOffset % POOLS.length));
  const out = [];
  for (let i = 0; i < count; i++) {
    const pool = pools[i % pools.length];
    const sentences = shuffle(pool).slice(0, 2 + Math.floor(rand() * 2));
    out.push(sentences.join(''));
  }
  return out.join('\n\n');
}

const LOG_LINES = [
  '今天什么也没做，但睡得很好。',
  '把桌子擦干净了，心情跟着干净了一点。',
  '楼下新开了一家面馆，汤有点咸。',
  '一整天都在下雨，我也没出门。',
  '今天突然很想吃我妈做的南瓜饼。',
  '走了七千步，太阳不错。',
  '把去年的照片整理了一遍，删掉了三分之一。',
  '今天第一次觉得，慢一点也可以。',
  '煮了一锅粥，喝了三顿。',
  '想给老哥打电话，最后没打。',
  '今天的风很像小时候秋天的那种风。',
  '换了个新杯子，喝水都变多了。',
  '今天没有开电脑，一整天都没有。',
  '路过花市，看了一眼，没买。',
  '把书架最上面那层擦了一遍，全是灰。',
  '晚上听了三遍同一首歌。',
  '今天在电梯里和一个小孩对视了两秒，他笑了。',
  '头疼，早睡。',
  '把冰箱里过期的酱料全扔了。',
  '今天走了条不一样的路回家。',
  '想写点什么，最后只写了两行。',
  '买了两斤橘子，酸的那种最好吃。',
  '今天把阳台上那盆快死的花救回来了。',
  '早上五点醒了一次，看了会儿天。',
  '把旧手机里的照片导出来了，一万多张。',
  '今天什么烦心事都没有，挺难得。',
  '在楼下坐着看了半小时人。',
  '今天想明白一件小事，关于钱的。',
  '我妈让我多穿点，我说好。',
  '晚上的月亮很亮，亮得不需要路灯。',
  '今天有点累，但不算坏。',
  '把水壶修好了，用了一个小时。',
  '今天没说话的一天，其实也不错。',
  '在公园里看见一只很胖的猫。',
  '写了两百字，删了一百八。',
  '今天想吃辣，吃了，很爽。',
  '手机放在另一个房间一整天。',
  '下雪了，很小，落地就没了。',
  '今天给家里打了个电话，聊了二十分钟。',
  '衣服晒干了，有太阳的味道。',
];

/* ------------------------------ 演示图片 ------------------------------ */

function demoPhoto(seed, width, height, stops) {
  const rgba = new Uint8Array(width * height * 4);
  const local = mulberry32(seed);
  const noise = (x, y, s) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const valueNoise = (x, y, s) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = noise(xi, yi, s);
    const b = noise(xi + 1, yi, s);
    const c = noise(xi, yi + 1, s);
    const d = noise(xi + 1, yi + 1, s);
    const u = smooth(xf);
    const v = smooth(yf);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const fbm = (x, y, s) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < 5; i++) {
      sum += amp * valueNoise(x * f, y * f, s + i * 17);
      amp *= 0.5;
      f *= 2.03;
    }
    return sum;
  };
  const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const stopsRgb = stops.map(rgb);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const w = fbm(u * 2.4 + fbm(u * 1.2, v * 1.2, 5) * 1.5, v * 2.4, 3);
      const t = Math.min(0.999, Math.max(0, w));
      const pos = t * (stopsRgb.length - 1);
      const i = Math.min(stopsRgb.length - 2, Math.floor(pos));
      const k = pos - i;
      const grain = (local() - 0.5) * 7;
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.max(0, Math.min(255, stopsRgb[i][0] + (stopsRgb[i + 1][0] - stopsRgb[i][0]) * k + grain));
      rgba[idx + 1] = Math.max(0, Math.min(255, stopsRgb[i][1] + (stopsRgb[i + 1][1] - stopsRgb[i][1]) * k + grain));
      rgba[idx + 2] = Math.max(0, Math.min(255, stopsRgb[i][2] + (stopsRgb[i + 1][2] - stopsRgb[i][2]) * k + grain));
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}

function demoWav(seconds = 6) {
  const sampleRate = 22050;
  const total = sampleRate * seconds;
  const data = Buffer.alloc(44 + total * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + total * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(total * 2, 40);
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const note = notes[Math.floor(t * 1.5) % notes.length];
    const env = Math.min(1, (t * 1.5) % 1 * 4) * Math.max(0, 1 - ((t * 1.5) % 1));
    const sample = Math.sin(2 * Math.PI * note * t) * 0.25 * env;
    data.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return data;
}

/* ---------------------------- 组件测试文章 ---------------------------- */

function componentTestArticle(media) {
  const image = (index) => media.images[index];
  return `这一篇用来一次性验完正文 renderer 的所有能力。下面每一个组件都是真的，不是示意图。

## 二级标题

正文里的普通段落是这样的：中文阅读要舒服，行高、段距、字距都按长期阅读来调，而不是按宣传页来调。

### 三级标题

再往下还有四级标题，用来分小节。标题不应该每一个都做成巨大的设计，它们只是路标。

#### 四级标题

段落里可以有**粗体**、*斜体*、~~删除线~~、行内代码 \`const hello = "world"\`。

正文中的链接可以是[站内的](/bloom/)，也可以是[外部的](https://yihui.org/cn/)，外链会有一个很轻的标记。

> 引用应该像文章里自然出现的一句话，而不是一张卡片。
>
> 它只有一条很细的左边线，和一点点缩进。

有序列表：

1. 第一步：把想法写下来，不管好坏。
2. 第二步：放两天再读，删掉一半。
3. 第三步：只留最诚实的那一部分。

无序列表：

- 不要给日期做 Badge
- 不要给文章做信息卡
- 不要一排分享按钮
- 不要相关推荐墙

## 图片

正文宽的图片（与文字同宽，默认居中）：

![演示图片 ${image(0)?.alt || '一'}](/${image(0)?.url || ''} "这是 caption，写在图片的 title 里就会显示在图下方；不写就不留位置。")

一张带 caption 的竖图：

![演示图片 ${image(1)?.alt || '二'}](/${image(1)?.url || ''} "竖图在正文里也不应该超过容器宽度。")

宽图（比正文略宽，约 960px）：

![宽图演示](/${image(2)?.url || ''}){.wide}

满内容宽（更宽，但不会造成横向滚动）：

![满宽演示](/${image(3)?.url || ''}){.full}

## 多图

连续两张图会自动并排：

![双图 A](/${image(0)?.url || ''})
![双图 B](/${image(1)?.url || ''})

连续三张图会组成一行三张：

![三图 A](/${image(0)?.url || ''})
![三图 B](/${image(3)?.url || ''})
![三图 C](/${image(2)?.url || ''})

## 视频

B 站视频直接贴地址就会变成自适应比例的嵌入：

https://www.bilibili.com/video/BV1xx411c7mD

YouTube 同样：

https://www.youtube.com/watch?v=dQw4w9WgXcQ

本地视频文件放进媒体库以后，也是用同样的 Markdown 语法插入（\`.mp4 / .webm / .mov\` 会自动渲染成播放器）。

## 音频

音频播放器（这一条是真的音频，可以点开听）：

![一段自己录的音](/${media.audio?.url || ''} "六秒钟的合成音，用来验证音频组件。")

## 代码

JavaScript：

\`\`\`js
export function bloom(seed) {
  const petals = seed.split('').map((ch) => ch.codePointAt(0));
  return petals.reduce((sum, code) => sum + code, 0) % 1024;
}

// 复制按钮在鼠标移上去的时候才出现
console.log(bloom('一个人像一朵花'));
\`\`\`

Python：

\`\`\`python
from dataclasses import dataclass

@dataclass
class Log:
    date: str
    text: str

def one_liners(logs):
    return [log for log in logs if len(log.text) < 20]
\`\`\`

Shell：

\`\`\`bash
npm install
npm run build
npm start
\`\`\`

## 表格

| 世界 | 含义 | 内容 |
| --- | --- | --- |
| BLOOM | 与世界的交集 | 缘起 / 本我 / 绽放 |
| INK | 与世界暂时无交集 | 日志 |
| 转场 | 绽放 ↔ 入墨 | 墨点扩散 / 重新生长 |

很长的表格在窄屏上应该只在容器内部横向滚动，不能把整个页面撑宽：

| 项目 | 说明 | 说明 | 说明 | 说明 | 说明 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 一 | 内容 | 内容 | 内容 | 内容 | 内容 | 内容 |
| 二 | 内容 | 内容 | 内容 | 内容 | 内容 | 内容 |

## 数学

行内公式 $E = mc^2$ 应该和文字基线对齐。

块级公式：

$$
\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## 脚注

这一句带一个脚注[^1]，另一句带第二个[^2]。

[^1]: 脚注是 Markdown 标准语法，应该在正文末尾安静地排出来。

[^2]: 第二条脚注，用来验证多条脚注的编号和回跳。

---

## 结尾

分割线上面是全部组件。正文到这里就结束了，下面应该只有上一篇 / 下一篇，不应该有相关推荐、热门、猜你喜欢、Newsletter 或者任何推广卡片。
`;
}

/* ------------------------------ 文章清单 ------------------------------ */

const ORIGIN_TITLES = [
  '为什么我要一个人做这些事',
  '我为什么开始写日志',
  '关于"有用"这件事的一点怀疑',
  '为什么我不再解释自己',
  '我为什么把网站做成两个世界',
  '一个人像一朵花：这几年我想明白的事',
  '为什么我把功能删到只剩文章',
  '关于长期主义我其实想说的是',
  '我为什么不再追热点',
  '为什么我选择慢一点',
  '关于记录的动机',
  '为什么留白比填满更难',
];

const SELF_TITLES = [
  '我不擅长的事情',
  '我是个容易心软的人',
  '我的身体知道答案',
  '我承认我怕的东西',
  '我到底想要什么',
  '一个普通人的自我说明书',
  '我身上那些还没长好的地方',
  '我为什么会在深夜变得诚实',
  '我的三十岁',
  '我不再假装自己很忙',
  '我承认我需要休息',
  '我的耐心是怎么被消耗掉的',
];

const BLOOM_TITLES = [
  '把想法变成可以用的东西',
  '给需要的人做一件小事',
  '带着家人去看一次海',
  '和一群陌生人完成一件事',
  '在饭桌上讲清楚一件事',
  '把钱花在真正重要的地方',
  '在城里找一条可以走很久的路',
  '把家里收拾成想要的样子',
  '和孩子一起重新学一遍世界',
  '一次把话说开的经历',
  '在山里住了两天',
  '给母亲做一次完整的体检',
  '把一个想法坚持了三年',
  '和父亲一起修好那辆旧自行车',
  '重新开始跑步',
  '把工作里最麻烦的那件事做完了',
];

const LONG_TITLES = [
  '从一个人写日志这件小事说起，谈谈我们究竟为什么需要保留一个只属于自己的地方，以及这件事在十年以后可能变成什么',
  '当所有的平台都在鼓励你表达，一个人为什么反而更需要一个安静的地方把话慢慢说完',
];

const SHORT_TITLES = ['雨', '灯', '一年', '在', '回家', '空', '慢', '墨'];

const LOG_EXTRA = [
  '空心吉他',
  '妈，我会开车了',
  '气要聚起来才有精神',
  '我今天想到了什么',
  '把阳台上那盆花救回来了',
  '写字写到一半睡着了',
  '第一次用新锅煮饭',
  '早上的光很好',
];

/* ------------------------------- 生成 ------------------------------- */

function monthsBack(count) {
  const list = [];
  const now = new Date('2026-09-14T09:00:00+08:00');
  for (let i = 0; i < count; i++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    list.push(date);
  }
  return list;
}

function isoAt(date, day, hour, minute) {
  const d = new Date(date);
  d.setDate(Math.min(day, 28));
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export async function seedDemo({ reset = false, logger = console.log } = {}) {
  if (reset) {
    run('DELETE FROM article_revisions');
    run('DELETE FROM search_index');
    run('DELETE FROM articles');
    logger('已清空文章数据');
  }

  /* 社交链接 */
  if (listSocialLinks().length === 0) {
    createSocialLink({ platform: 'xiaohongshu', label: '小红书', handle: '@zhangzhongwei', url: 'https://www.xiaohongshu.com/user/profile/zhangzhongwei', visible: 1, sort: 1 });
    createSocialLink({ platform: 'douyin', label: '抖音', handle: '@zhangzhongwei', url: 'https://www.douyin.com/user/zhangzhongwei', visible: 1, sort: 2 });
    createSocialLink({ platform: 'github', label: 'GitHub', handle: '@zhangzhongwei', url: 'https://github.com/zhangzhongwei', visible: 1, sort: 3 });
    createSocialLink({ platform: 'email', label: 'Email', handle: 'hi@zhangzhongwei.top', url: 'mailto:hi@zhangzhongwei.top', visible: 1, sort: 4 });
    logger('已创建 4 个社交链接（后台可改）');
  }

  /* 视觉素材 */
  const settings = getSettings();
  for (const world of ['bloom', 'ink']) {
    if (activeVisual(world)) continue;
    const { generateProceduralImage } = await import('./visuals.mjs');
    const { buffer, width, height } = generateProceduralImage(world, settings[`${world}.prompt`] || world, 1536, 1024);
    const row = await storeVisual({
      world,
      prompt: settings[`${world}.prompt`] || '',
      buffer,
      provider: 'local',
      meta: { width, height, seeded: true },
    });
    activateVisual(row.id);
    setSetting(`${world}.image`, `/visuals/${row.path}`);
    logger(`已生成 ${world} 基础视觉`);
  }

  /* 演示媒体 */
  const mediaCount = get('SELECT COUNT(*) AS n FROM media WHERE deleted_at IS NULL').n;
  let media = { images: [], audio: null };
  if (mediaCount === 0) {
    const specs = [
      { seed: 11, w: 1600, h: 1067, stops: ['#f7fbf4', '#bcdcb0', '#8fc9c0', '#a9cfe8'] },
      { seed: 22, w: 1000, h: 1400, stops: ['#fffdfb', '#f6d9e2', '#e5a8bd', '#c9879f'] },
      { seed: 33, w: 1600, h: 900, stops: ['#fffef8', '#f7e9a8', '#f0b877', '#dfa15f'] },
      { seed: 44, w: 1200, h: 1200, stops: ['#fdfbff', '#d6cdf0', '#a99ad8', '#8b7bc4'] },
    ];
    for (const spec of specs) {
      const buffer = demoPhoto(spec.seed, spec.w, spec.h, spec.stops);
      const row = await saveUpload({
        buffer,
        originalName: `demo-${spec.seed}.png`,
        mime: 'image/png',
        alt: '演示图片',
      });
      media.images.push(row);
    }
    media.audio = await saveUpload({
      buffer: demoWav(6),
      originalName: 'demo-audio.wav',
      mime: 'audio/wav',
      alt: '一段自己录的音',
    });
    logger(`已生成 ${media.images.length} 张演示图片与 1 段演示音频`);
  } else {
    media.images = all("SELECT * FROM media WHERE kind = 'image' AND deleted_at IS NULL ORDER BY id LIMIT 6");
    media.audio = get("SELECT * FROM media WHERE kind = 'audio' AND deleted_at IS NULL ORDER BY id LIMIT 1");
  }

  const existing = get('SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL').n;
  if (existing > 0 && !reset) {
    logger(`已有 ${existing} 篇文章，跳过生成（想重来请用 npm run seed:fresh）。`);
    return { created: 0, existing };
  }

  const months = monthsBack(34);
  let created = 0;

  const add = (input) => {
    const article = createArticle(input);
    created += 1;
    return article;
  };

  /* 组件测试文章：放在绽放里，日期最新 */
  add({
    title: '组件测试：所有正文元素都在这一篇里',
    slug: 'component-test',
    section: 'bloom',
    status: 'published',
    published_at: isoAt(months[0], 14, 21, 10),
    tags: '测试,renderer',
    seo_description: '一次把所有正文组件看完：标题、列表、引用、图片、宽图、多图、视频、音频、代码、表格、脚注、公式、分割线。',
    content: componentTestArticle(media),
  });

  /* 每个栏目按月份撒文章 */
  const plan = [
    { section: 'origin', titles: ORIGIN_TITLES, months: 18, density: 0.7 },
    { section: 'self', titles: SELF_TITLES, months: 18, density: 0.7 },
    { section: 'bloom', titles: BLOOM_TITLES, months: 22, density: 0.75 },
  ];

  for (const item of plan) {
    let titleIndex = 0;
    for (let m = 0; m < item.months; m++) {
      const month = months[m % months.length];
      const count = rand() < item.density ? 1 : rand() < 0.45 ? 2 : 0;
      for (let i = 0; i < count; i++) {
        const title = item.titles[titleIndex % item.titles.length];
        titleIndex += 1;
        const day = 2 + Math.floor(rand() * 26);
        const isLong = rand() < 0.12;
        const isShort = rand() < 0.1;
        const finalTitle = isLong
          ? pick(LONG_TITLES)
          : isShort
            ? pick(SHORT_TITLES)
            : rand() < 0.18
              ? `${title}（${['一', '二', '三', '补记', '续'][Math.floor(rand() * 5)]}）`
              : title;
        const size = rand();
        const content =
          size < 0.28
            ? paragraphs(1, m + i)
            : size < 0.7
              ? paragraphs(4, m + i + 3)
              : size < 0.9
                ? paragraphs(9, m + i + 7)
                : paragraphs(16, m + i + 11);
        add({
          title: finalTitle,
          slug: undefined,
          section: item.section,
          status: 'published',
          published_at: isoAt(month, day, 8 + Math.floor(rand() * 12), Math.floor(rand() * 60)),
          tags: pick(['日常', '思考', '记录', '长期', '写作', '生活']),
          content,
        });
      }
    }
  }

  /* 日志：一句话、超短、同一天多篇、跨月跨年 */
  const logCount = 42;
  for (let i = 0; i < logCount; i++) {
    const month = months[Math.floor(rand() * months.length)];
    const day = 1 + Math.floor(rand() * 28);
    const long = rand() < 0.2;
    const title = rand() < 0.55 ? pick(LOG_LINES).replace(/。$/, '') : pick(LOG_EXTRA);
    const content = long
      ? `${pick(LOG_LINES)}\n\n${paragraphs(2, i)}\n\n${pick(LOG_LINES)}`
      : `${pick(LOG_LINES)}\n\n${pick(LOG_LINES)}`;
    add({
      title,
      section: 'log',
      status: 'published',
      published_at: isoAt(month, day, 6 + Math.floor(rand() * 17), Math.floor(rand() * 60)),
      content,
    });
    // 同一天再来一篇
    if (rand() < 0.3) {
      add({
        title: pick([...LOG_EXTRA, ...LOG_LINES.map((line) => line.replace(/。$/, ''))]),
        section: 'log',
        status: 'published',
        published_at: isoAt(month, day, 7 + Math.floor(rand() * 16), Math.floor(rand() * 60)),
        content: `${pick(LOG_LINES)}\n\n${pick(LOG_LINES)}`,
      });
    }
  }

  /* 一篇 5000 字长文 */
  add({
    title: '一篇很长的文章：把过去三年的记录重新读一遍',
    slug: 'three-years',
    section: 'self',
    status: 'published',
    published_at: isoAt(months[2], 9, 22, 30),
    content: `${paragraphs(2, 1)}\n\n## 第一年\n\n${paragraphs(12, 2)}\n\n## 第二年\n\n${paragraphs(12, 5)}\n\n## 第三年\n\n${paragraphs(12, 8)}\n\n> ${pick(LOG_LINES)}\n\n## 最近\n\n${paragraphs(6, 3)}`,
  });

  /* 草稿与定时发布各一篇，方便验证状态 */
  add({
    title: '还没写完的一篇（草稿）',
    section: 'bloom',
    status: 'draft',
    published_at: new Date().toISOString(),
    content: '这一篇还在草稿状态，前台不应该看到它。\n\n- 待补充\n- 待确认\n',
  });
  add({
    title: '定时发布：下个月的第一天',
    section: 'origin',
    status: 'scheduled',
    published_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 20).toISOString(),
    content: '这一篇设置了未来的发布时间，到时间之前前台不应该显示。\n',
  });

  const indexed = rebuildIndex();
  logger(`已生成 ${created} 篇文章，搜索索引重建 ${indexed} 条`);

  const first = get('SELECT id, title FROM articles ORDER BY id LIMIT 1');
  const testArticle = get("SELECT id FROM articles WHERE slug = 'component-test'");
  return {
    created,
    indexed,
    componentTestId: testArticle ? testArticle.id : null,
    firstId: first ? first.id : null,
  };
}
import { mediaUrl } from './media.mjs';

/* 演示文章的图片 / 音频路径：媒体记录里存的是相对路径，
   这里包一层，把 url 统一成 /uploads/… 再交给模板使用。 */
const __renderComponentTest = componentTestArticle;
componentTestArticle = function withMediaUrls(media) {
  const toRelative = (row) =>
    row ? { ...row, url: mediaUrl(row).replace(/^\/+/, '') } : null;
  return __renderComponentTest({
    images: (media.images || []).map(toRelative),
    audio: toRelative(media.audio),
  });
};
