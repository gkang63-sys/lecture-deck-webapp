/**
 * 덱 조립과 구글 슬라이드 그리기
 *
 * english-lecture-deck 스킬의 규칙을 구글 슬라이드로 옮김:
 *  - 영·한 쌍 → 한 상자 안의 두 단 (영어 굵게 / 한국어 회색 해설)
 *  - 한 장에 쌍 4개까지, 넘치면 장을 나눈다 (글씨를 줄이지 않는다)
 *  - 섹션마다 섹션 표지 → 교재 지면 장 → 해설
 *  - 문항 장 다음에 정답 장 (학생용 사본에서는 정답 장을 뺀다)
 *  - 덱 끝에 과제 섹션: 무엇·어떻게·언제 → 요건 → 평가 기준 4항목 → 마무리
 * 화면 크기는 720×405pt(16:9). 좌표 단위는 pt.
 */

const EN = 'Inter', KO = 'Noto Sans KR', MO = 'IBM Plex Mono';
const INK = '#141414', INK2 = '#3D3D3D', INK3 = '#737373';
const ACCENT = '#FF6E40', ACCENT_SOFT = '#FFF1EB', ACCENT_LINE = '#FFDCCE', ACCENT_DEEP = '#D9490F';
const BODY_TOP = 112, BODY_BOTTOM = 366;

/** 글이 같으면 같은 이름 — 영상을 넣어 장 번호가 바뀌어도 만든 음성을 다시 쓴다 */
function hash_(t) { let h = 5381; String(t).split('').forEach(ch => { h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; }); return h.toString(36); }

function slideId_(i) { return 'sl_' + ('000' + i).slice(-3); }

function ctx_(st) {
  const inp = st.input, c = COURSES[inp.course];
  return Object.assign({}, c, {
    week: `${inp.week}-${inp.session}`,
    foot: `${c.name} · Week ${inp.week}-${inp.session}${inp.unit ? ' · ' + inp.unit : ''}`,
    total: st.deck.length,
  });
}

// ───────────────────────── 조립 ─────────────────────────

function assembleDeck_(st) {
  const inp = st.input, o = st.outline, a = o.assignment, D = [];
  const secNames = o.sections.map(s => s.name_en);
  const tags = [`Week ${inp.week}-${inp.session}`, inp.unit, inp.pages && ('pp. ' + inp.pages.replace(/^pp?\.\s*/i, ''))].filter(Boolean);

  D.push({ kind: 'title', sec: 'Title', ref: inp.pages, title_en: o.title_en, title_ko: o.title_ko,
    notes: `표지. 인사와 함께 오늘 차시(${inp.kind})를 소개한다. 30초.` });
  const vids = inp.videos || { sections: [] };
  if (vids.overview) D.push({ kind: 'video', sec: 'Overview', ref: inp.pages, video: vids.overview,
    title_en: 'Overview Video', title_ko: '개요 영상 — 오늘 배울 것을 먼저 훑어봅니다',
    notes: '개요 영상(정답 없음). 재생 후 오늘의 목표로 넘어간다.' });
  D.push({ kind: 'pairs', sec: 'Welcome', ref: inp.pages, title_en: o.intro.title_en || `Welcome to Week ${inp.week}`,
    title_ko: o.intro.title_ko || '인사와 오늘의 연결', tags: tags.concat(a.due ? [{ t: 'Due ' + a.due, warm: true }] : []),
    pairs: o.intro.pairs, focus: o.intro.focus && o.intro.focus.big ? o.intro.focus : null,
    notes: (o.intro.notes || '') + (a.due ? `\n과제 기한(${a.due})을 여기서 한 번 말한다 — 마무리에서 한 번 더.` : '') });
  D.push({ kind: 'goals', sec: "Today's Goals", ref: inp.pages, title_en: "Today's Goals & Flow", title_ko: '오늘의 목표와 흐름',
    goals: o.goals, flow: o.sections.map(s => ({ en: s.name_en, ko: s.name_ko })), notes: o.goals_notes || '목표 세 가지를 읽고, 흐름을 손으로 짚어 준다. 1분.' });

  o.sections.forEach((sec, i) => {
    const ref = sec.page_ref ? '교재 ' + sec.page_ref : '';
    D.push({ kind: 'divider', sec: sec.name_en, ref, num: i + 1, of: o.sections.length + 1, title_en: sec.name_en, title_ko: sec.name_ko,
      notes: `섹션 ${i + 1} 시작. "${sec.name_en}" — ${sec.name_ko}` });
    D.push({ kind: 'page', sec: sec.name_en, ref, title_en: `Textbook ${sec.page_ref || ''}`.trim(), title_ko: '교재 지면 — 먼저 함께 봅니다',
      starts: sec.starts_with, images: imagesFor_(inp.pageImages, sec.page_ref),
      notes: '교재 지면을 먼저 띄우고 학생들이 같은 쪽을 펴게 한다. 해설은 다음 장부터. (지면 사진을 넣으려면 이 장의 점선 상자를 지우고 [삽입 → 이미지 → 드라이브])' });
    // 듣기 섹션(Before you listen 제외)이고 대본이 있으면 '전체 듣기' 장 — 음성은 제미나이 TTS
    if (inp.script && /listen/i.test(sec.name_en) && !/before/i.test(sec.name_en)) {
      D.push({ kind: 'listen', sec: sec.name_en, ref, audioKey: 'full', title_en: 'Listen', title_ko: '전체 듣기 — 녹음을 처음부터 끝까지 듣습니다',
        notes: '▶ 버튼을 누르면 드라이브 재생 창이 열린다. 슬라이드 안에서 재생하려면 삽입 → 오디오 → 드라이브에서 같은 파일. 합성 음성(TTS) 대체 음원임을 말해 둔다.' });
    }
    st.sections[i].forEach(s => {
      const base = { sec: sec.name_en, ref, title_en: s.title_en, title_ko: s.title_ko, notes: s.notes };
      if (s.type === 'pairs') splitPairs_(s).forEach((p, k, all) => D.push(Object.assign({}, base, p, {
        kind: 'pairs', title_en: s.title_en + (all.length > 1 ? ` (${k + 1}/${all.length})` : '') })));
      else if (s.type === 'script') D.push(Object.assign({}, base, { kind: 'script', lines: s.lines, audioKey: 'clip_' + hash_(s.lines.map(l => l.en).join(' ')) }));
      else if (s.type === 'chips') D.push(Object.assign({}, base, { kind: 'chips', groups: s.groups }));
      else if (s.type === 'question') {
        D.push(Object.assign({}, base, { kind: 'question', label: s.label, from_textbook: s.from_textbook,
          q_en: s.q_en, q_ko: s.q_ko, options: s.options }));
        D.push(Object.assign({}, base, { kind: 'answer', answer: true, label: s.label, q_en: s.q_en,
          title_en: 'Answer' + (s.label ? ' · ' + s.label : ''), title_ko: '정답과 해설',
          answer_en: s.answer_en, why_ko: s.why_ko, evidence: s.evidence,
          notes: '정답 장 (학생용 사본에는 없음). ' + (s.evidence ? `근거: ${s.evidence}` : '') }));
      }
    });
    if (vids.sections[i]) D.push({ kind: 'video', sec: sec.name_en, ref, video: vids.sections[i],
      title_en: `Review Video · ${sec.name_en}`, title_ko: '섹션 복습 영상 — 정답이 나오므로 섹션 끝에 둡니다',
      notes: '섹션 복습 영상. 정답이 들어 있을 수 있어 문항을 다 푼 뒤에 튼다.' });
  });

  if (o.phrasebook.groups.length) {
    D.push({ kind: 'chips', sec: 'Phrasebook', ref: inp.pages, title_en: o.phrasebook.title_en || 'Phrasebook',
      title_ko: o.phrasebook.title_ko || '오늘의 표현 모음', groups: o.phrasebook.groups, notes: o.phrasebook.notes || '표현을 함께 따라 읽는다. 1분.' });
  }

  // 과제 섹션
  const n = o.sections.length + 1;
  D.push({ kind: 'divider', sec: 'Assignment', ref: a.due ? 'Due ' + a.due : '', num: n, of: n, title_en: 'Assignment',
    title_ko: a.title_ko || '과제 안내', notes: '과제 섹션. 무엇을, 어떻게, 언제까지 내는지 숫자로 분명하게.' });
  D.push({ kind: 'cards', sec: 'Assignment', ref: a.due ? 'Due ' + a.due : '', title_en: a.title_en || 'Assignment', title_ko: a.title_ko || '과제 한눈에',
    cards: [{ label: 'WHAT · 무엇을', p: a.what }, { label: 'HOW · 어떻게', p: a.how }, { label: 'WHEN · 언제까지', p: a.when, warm: true }],
    notes: a.notes || '' });
  if (a.requirements.length) D.push({ kind: 'ticks', sec: 'Assignment', ref: a.due ? 'Due ' + a.due : '', title_en: 'Requirements', title_ko: '요건',
    items: a.requirements, focus: { label: 'DUE · 기한', big: a.due || '[기한 입력]', ko: '기한 이후 과제물은 받지 않습니다.' },
    notes: '요건을 하나씩 읽는다. 분량·형식 숫자를 두 번 말한다.' });
  if (a.rubric.length) D.push({ kind: 'rows', sec: 'Assignment', ref: a.due ? 'Due ' + a.due : '', title_en: 'How It Is Graded', title_ko: '평가 기준',
    rows: a.rubric, notes: '평가 기준 네 가지. 학생이 자기 대본을 점검할 때 그대로 쓰게 한다.' });

  const c = o.close;
  D.push({ kind: 'close', sec: 'Wrap-up', ref: '', title_en: 'Wrap-up', title_ko: '오늘 정리',
    key: { en: c.key_en || o.title_en, ko: c.key_ko || '' },
    cards: [{ label: 'TODAY · 오늘', en: secNames.join(' · '), ko: c.today_ko || '' },
      { label: 'ASSIGNMENT · 과제', en: a.due ? 'Due ' + a.due : 'Due [deadline]', ko: a.what.ko || '' },
      { label: 'NEXT · 다음', en: c.next_en || '', ko: c.next_ko || '' }],
    notes: (c.notes || '') + `\n과제 기한(${a.due || '미정'})을 한 번 더 말한다. 확인 퀴즈 링크를 안내한다.` });
  return D;
}

/** 섹션 쪽수(p.10, pp.10–11)에 맞는 지면 사진, 두 장까지 */
function imagesFor_(images, ref) {
  const want = pageNums_(ref);
  return (images || []).filter(im => pageNums_(im.page).some(n => want.indexOf(n) > -1)).slice(0, 2);
}

/** 교재 지면 장에 사진을 넣는다 (Slides API는 공개 주소가 필요해서 이 부분만 SlidesApp으로) */
function placePageImages_(presId, deck) {
  const jobs = deck.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'page' && x.s.images && x.s.images.length);
  if (!jobs.length) return 0;
  const pres = SlidesApp.openById(presId);
  let n = 0;
  jobs.forEach(({ s, i }) => {
    const slide = pres.getSlideById(slideId_(i));
    if (!slide) return;
    const k = s.images.length, gap = 12, boxW = (640 - gap * (k - 1)) / k, boxH = BODY_BOTTOM - BODY_TOP - 4;
    s.images.forEach((im, j) => {
      try {
        const img = slide.insertImage(DriveApp.getFileById(im.id).getBlob());
        const r = Math.min(boxW / img.getWidth(), boxH / img.getHeight());
        const w = img.getWidth() * r, h = img.getHeight() * r;
        img.setWidth(w).setHeight(h).setLeft(40 + j * (boxW + gap) + (boxW - w) / 2).setTop(BODY_TOP + 2 + (boxH - h) / 2);
        img.getBorder().getLineFill().setSolidFill('#E0E4EA');
        img.getBorder().setWeight(0.75);
        n++;
      } catch (e) { /* 사진 하나가 안 들어가도 덱은 계속 */ }
    });
  });
  pres.saveAndClose();
  return n;
}

/** 영·한 쌍이 한 장에 넘치면 나눈다: 쌍 4개(강조 문장이 있으면 3개)와 높이 둘 다 본다 */
function splitPairs_(s) {
  const W = s.focus ? 420 : 640;
  let room = BODY_BOTTOM - BODY_TOP - (s.key ? keyH_(s.key, W) + 12 : 0);
  const pages = [];
  let cur = [], used = 0;
  const max = s.key ? 3 : 4;
  s.pairs.forEach(p => {
    const h = pairH_(p, W);
    if (cur.length && (cur.length >= max || used + h > room)) {
      pages.push(cur); cur = []; used = 0; room = BODY_BOTTOM - BODY_TOP;
    }
    cur.push(p); used += h;
  });
  if (cur.length || !pages.length) pages.push(cur);
  return pages.map((ps, k) => ({ pairs: ps, key: k === 0 ? s.key : null, focus: k === 0 ? s.focus : null }));
}

/** 글줄 수를 대충 셈 (영문 0.55em, 대문자 0.68em, 한글 1em) */
function estH_(text, size, width, lh) {
  let w = 0;
  String(text || '').replace(/\*\*/g, '').split('').forEach(ch => {
    w += /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.68 : 0.55;
  });
  return Math.max(1, Math.ceil(w * size / (width - 16))) * size * (lh || 1.3);
}
function pairH_(p, W) { return estH_(p.en, 15, W, 1.25) + 3 + estH_(p.ko, 11, W, 1.5) + 12; }
function keyH_(p, W) { return estH_(p.en, 18, W - 12, 1.25) + 4 + estH_(p.ko, 11.5, W - 12, 1.5) + 8; }

// ───────────────────────── 그리기 도구 ─────────────────────────

function hex_(h) {
  h = h.replace('#', '');
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
}
function pt_(n) { return { magnitude: n, unit: 'PT' }; }

/** 슬라이드 하나에 쓸 그리기 도구 */
function painter_(reqs, i) {
  const pid = slideId_(i);
  let k = 0;
  const nid = () => `${pid}_e${('0' + k++).slice(-2)}`;
  reqs.push({ createSlide: { objectId: pid, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
  const P = {
    pid,
    bg(color) {
      reqs.push({ updatePageProperties: { objectId: pid,
        pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: hex_(color) } } } },
        fields: 'pageBackgroundFill.solidFill.color' } });
    },
    /** 도형. o: {fill, line, lw, dash, middle} */
    shape(type, x, y, w, h, o) {
      o = o || {};
      const id = nid();
      reqs.push({ createShape: { objectId: id, shapeType: type, elementProperties: {
        pageObjectId: pid, size: { width: pt_(w), height: pt_(h) },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } } } });
      const props = {}, f = [];
      if (o.fill) { props.shapeBackgroundFill = { solidFill: { color: { rgbColor: hex_(o.fill) } } }; f.push('shapeBackgroundFill.solidFill.color'); }
      else if (type !== 'TEXT_BOX') { props.shapeBackgroundFill = { propertyState: 'NOT_RENDERED' }; f.push('shapeBackgroundFill.propertyState'); }
      if (o.line) {
        props.outline = { outlineFill: { solidFill: { color: { rgbColor: hex_(o.line) } } }, weight: pt_(o.lw || 0.75), dashStyle: o.dash || 'SOLID' };
        f.push('outline.outlineFill.solidFill.color', 'outline.weight', 'outline.dashStyle');
      } else if (type !== 'TEXT_BOX') { props.outline = { propertyState: 'NOT_RENDERED' }; f.push('outline.propertyState'); }
      if (o.middle) { props.contentAlignment = 'MIDDLE'; f.push('contentAlignment'); }
      if (o.link) { props.link = { url: o.link }; f.push('link'); }
      if (f.length) reqs.push({ updateShapeProperties: { objectId: id, shapeProperties: props, fields: f.join(',') } });
      return id;
    },
    /** 글상자. paras: [{t: 글 또는 [[글, 모양], ...], st: 모양, pa: 문단 모양, em: **강조** 모양}] */
    text(x, y, w, h, paras, o) {
      o = o || {};
      const id = P.shape(o.type || 'TEXT_BOX', x, y, w, h, o);
      fillText_(reqs, id, paras);
      if (o.alt) reqs.push({ updatePageElementAltText: { objectId: id, title: o.alt } });
      return id;
    },
    rect(x, y, w, h, color) { return P.shape('RECTANGLE', x, y, w, h, { fill: color }); },
    /** 영상: 드라이브·유튜브 영상을 슬라이드 안에 넣는다 (발표 중 바로 재생) */
    video(v, x, y, w, h) {
      // 영상은 따로 모아 마지막에 하나씩 넣는다 (슬라이드가 못 받는 형식이면 그 자리에 링크 버튼)
      const id = nid();
      (reqs.videos = reqs.videos || []).push({ pid, x, y, w, h, link: v.link || (v.source === 'YOUTUBE' ? 'https://youtu.be/' + v.id : 'https://drive.google.com/file/d/' + v.id + '/view'),
        req: { createVideo: { objectId: id, source: v.source, id: v.id, elementProperties: {
          pageObjectId: pid, size: { width: pt_(w), height: pt_(h) },
          transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } } } } });
      return id;
    },
  };
  return P;
}

/** 문단을 [글, 모양] 조각으로. **강조**는 굵게(p.em 모양)로 바꾸고 별표는 지운다 */
function runs_(p) {
  const split = (text, base) => String(text || '').replace(/\r?\n/g, ' ').split(/\*\*(.+?)\*\*/)
    .map((t, i) => [t.replace(/\*\*/g, ''), i % 2 ? Object.assign({}, base, p.em || { b: true }) : base]);
  const list = Array.isArray(p.t) ? p.t.reduce((a, r) => a.concat(split(r[0], r[1] || {})), []) : split(p.t, {});
  return list.filter(r => r[0]);
}

function fillText_(reqs, id, paras) {
  paras = (paras || []).filter(p => p && runs_(p).some(r => r[0].trim()));
  if (!paras.length) return;
  let text = '';
  const styles = [], pstyles = [];
  paras.forEach((p, n) => {
    if (n) text += '\n';
    const start = text.length;
    runs_(p).forEach(r => {
      const a = text.length;
      text += r[0];
      styles.push([a, text.length, Object.assign({}, p.st, r[1])]);
    });
    pstyles.push([start, text.length, p.pa || {}]);
  });
  reqs.push({ insertText: { objectId: id, text, insertionIndex: 0 } });
  styles.forEach(([a, b, st]) => {
    if (b <= a) return;
    const style = {}, f = [];
    if (st.f) { style.fontFamily = st.f; f.push('fontFamily'); }
    if (st.s) { style.fontSize = pt_(st.s); f.push('fontSize'); }
    if (st.b != null) { style.bold = !!st.b; f.push('bold'); }
    if (st.i != null) { style.italic = !!st.i; f.push('italic'); }
    if (st.c) { style.foregroundColor = { opaqueColor: { rgbColor: hex_(st.c) } }; f.push('foregroundColor'); }
    if (f.length) reqs.push({ updateTextStyle: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: a, endIndex: b }, style, fields: f.join(',') } });
  });
  pstyles.forEach(([a, b, pa]) => {
    const style = {}, f = [];
    if (pa.al) { style.alignment = pa.al; f.push('alignment'); }
    if (pa.sa != null) { style.spaceAbove = pt_(pa.sa); f.push('spaceAbove'); }
    style.spaceBelow = pt_(pa.sb || 0); f.push('spaceBelow');
    style.lineSpacing = pa.ls || 110; f.push('lineSpacing');
    reqs.push({ updateParagraphStyle: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: a, endIndex: Math.max(b, a + 1) }, style, fields: f.join(',') } });
  });
}

// 자주 쓰는 글 모양
const S = {
  eyebrow: c => ({ f: MO, s: 8, c: INK3 }),
  title: { f: EN, s: 22, b: true, c: INK },
  sub: { f: KO, s: 11, c: INK3 },
  en: { f: EN, s: 15, b: true, c: INK },
  ko: { f: KO, s: 11, c: INK3 },
  mono: (c, s) => ({ f: MO, s: s || 8, c }),
};

/** 모든 일반 장의 틀: 눈썹줄 · 지면 참조 · 제목 · 한국어 부제 · 과목색 선 · 푸터 */
function chrome_(P, c, s, i, dark) {
  const fg = dark ? '#FFFFFF' : INK, muted = dark ? '#A8A8A8' : INK3;
  P.text(40, 18, 440, 18, [{ t: `WEEK ${c.week}  ▸  ${String(s.sec || '').toUpperCase()}`, st: { f: MO, s: 8, c: muted } }]);
  if (s.ref) P.text(480, 18, 200, 18, [{ t: s.ref, st: { f: MO, s: 8, c: muted }, pa: { al: 'END' } }]);
  if (s.title_en) P.text(40, 36, 640, 34, [{ t: s.title_en, st: Object.assign({}, S.title, { c: fg }) }]);
  if (s.title_ko) P.text(40, 68, 640, 22, [{ t: s.title_ko, st: Object.assign({}, S.sub, { c: muted }) }]);
  P.rect(47, 96, 32, 2.5, c.brand);
  foot_(P, c, i, muted);
}
function foot_(P, c, i, color) {
  P.text(40, 380, 470, 16, [{ t: c.foot, st: { f: MO, s: 7, c: color } }]);
  P.text(520, 380, 160, 16, [{ t: `${i + 1} / ${c.total}`, st: { f: MO, s: 7, c: color }, pa: { al: 'END' } }], { alt: 'pageno' });
}

/** 오른쪽 포커스 패널 (낱말 하나·규칙 하나·숫자 하나) */
function focus_(P, c, f, warm) {
  const fill = warm ? ACCENT_SOFT : c.soft, line = warm ? ACCENT_LINE : c.line, deep = warm ? ACCENT_DEEP : c.deep;
  P.shape('ROUND_RECTANGLE', 484, 114, 196, 236, { fill, line });
  const big = String(f.big || '');
  P.text(494, 124, 176, 220, [
    { t: String(f.label || 'FOCUS').toUpperCase(), st: { f: MO, s: 8, c: deep } },
    { t: big, st: { f: EN, s: big.length > 14 ? 18 : big.length > 8 ? 24 : 32, b: true, c: deep }, pa: { sa: 8, ls: 100 } },
    { t: f.ko || '', st: { f: KO, s: 10.5, c: INK2 }, pa: { sa: 10, ls: 130 } },
  ]);
}

function pairParas_(pairs, c) {
  const out = [];
  pairs.forEach((p, n) => {
    out.push({ t: p.en, st: S.en, em: { b: true, c: c.deep }, pa: { sa: n ? 13 : 0, ls: 110 } });
    out.push({ t: p.ko, st: S.ko, em: { b: true, c: INK2 }, pa: { sa: 3, ls: 130 } });
  });
  return out;
}

function tags_(P, c, tags, y) {
  let x = 44;
  tags.forEach(tg => {
    const t = typeof tg === 'string' ? tg : tg.t, warm = typeof tg === 'object' && tg.warm;
    const w = Math.min(260, 22 + String(t).length * 6.2);
    P.text(x, y, w, 22, [{ t, st: { f: EN, s: 9.5, b: true, c: warm ? ACCENT_DEEP : c.deep }, pa: { al: 'CENTER' } }],
      { type: 'ROUND_RECTANGLE', fill: warm ? ACCENT_SOFT : '#FFFFFF', line: warm ? ACCENT_LINE : c.line, middle: true });
    x += w + 8;
  });
  return y + 22;
}

// ───────────────────────── 장 종류별 ─────────────────────────

function renderSlide_(c, s, i, reqs) {
  const P = painter_(reqs, i);
  const fn = { title: rTitle_, pairs: rPairs_, goals: rGoals_, divider: rDivider_, page: rPage_, script: rScript_,
    question: rQuestion_, answer: rAnswer_, chips: rChips_, cards: rCards_, ticks: rTicks_, rows: rRows_, close: rClose_,
    video: rVideo_, listen: rListen_ }[s.kind];
  (fn || rPairs_)(P, c, s, i);
}

function rTitle_(P, c, s, i) {
  P.bg(c.soft);
  P.shape('ELLIPSE', 450, -150, 420, 420, { fill: c.line });
  P.shape('ELLIPSE', 600, 250, 190, 190, { fill: '#FFFFFF' });
  P.text(40, 64, 560, 18, [{ t: `${c.en.toUpperCase()}  ·  FALL 2026`, st: { f: MO, s: 9, c: c.deep } }]);
  P.text(40, 82, 560, 18, [{ t: `${c.name} · 2026학년도 2학기`, st: { f: KO, s: 10, c: INK3 } }]);
  P.text(40, 116, 560, 100, [{ t: s.title_en, st: { f: EN, s: 38, b: true, c: INK }, pa: { ls: 95 } }]);
  P.text(40, 214, 560, 44, [{ t: s.title_ko, st: { f: KO, s: 14, c: INK2 }, pa: { ls: 125 } }]);
  const badge = c.foot.replace(c.name + ' · ', '');
  P.text(44, 270, Math.min(400, 30 + badge.length * 6.2), 24, [{ t: badge, st: { f: MO, s: 9, c: c.deep }, pa: { al: 'CENTER' } }],
    { type: 'ROUND_RECTANGLE', fill: '#FFFFFF', line: c.line, middle: true });
  P.text(40, 306, 560, 40, [{ t: s.ref ? '교재 ' + s.ref : '', st: { f: KO, s: 10, c: INK3 } }]);
}

function rPairs_(P, c, s, i) {
  chrome_(P, c, s, i);
  const W = s.focus ? 420 : 640;
  let y = BODY_TOP;
  if (s.tags && s.tags.length) y = tags_(P, c, s.tags, y) + 14;
  if (s.key) {
    const h = keyH_(s.key, W);
    P.rect(46, y + 4, 3, h - 10, c.brand);
    P.text(54, y, W - 14, h, [
      { t: s.key.en, st: { f: EN, s: 18, b: true, c: INK }, em: { b: true, c: c.deep }, pa: { ls: 110 } },
      { t: s.key.ko, st: { f: KO, s: 11.5, c: INK3 }, pa: { sa: 4, ls: 130 } }]);
    y += h + 12;
  }
  if (s.pairs && s.pairs.length) P.text(40, y, W, BODY_BOTTOM - y, pairParas_(s.pairs, c));
  if (s.focus) focus_(P, c, s.focus);
}

function rGoals_(P, c, s, i) {
  chrome_(P, c, s, i);
  const col = (x, w, head, items, num) => {
    const paras = [{ t: head, st: { f: MO, s: 8, c: c.brand } }];
    items.forEach((g, n) => {
      paras.push({ t: [[num ? `0${n + 1}   ` : '▸  ', { f: MO, s: 9, c: c.brand }], [g.en, { f: EN, s: num ? 13 : 12.5, b: true, c: INK }]], pa: { sa: n ? 12 : 10 } });
      if (g.ko) paras.push({ t: g.ko, st: { f: KO, s: 10, c: INK3 }, pa: { sa: 2, ls: 125 } });
    });
    P.text(x, BODY_TOP, w, BODY_BOTTOM - BODY_TOP, paras);
  };
  col(40, 330, 'GOALS · 학습 목표', s.goals, true);
  P.rect(384, BODY_TOP + 4, 0.75, 240, c.line);
  col(396, 284, 'FLOW · 수업 흐름', s.flow, false);
}

function rDivider_(P, c, s, i) {
  P.bg(c.deep);
  P.text(36, 96, 200, 190, [{ t: String(s.num), st: { f: EN, s: 130, b: true, c: c.light }, pa: { ls: 90 } }]);
  P.text(240, 124, 440, 18, [{ t: `SECTION ${s.num} OF ${s.of}`, st: { f: MO, s: 9, c: c.light } }]);
  P.text(240, 142, 440, 60, [{ t: s.title_en, st: { f: EN, s: 32, b: true, c: '#FFFFFF' }, pa: { ls: 100 } }]);
  P.text(240, 204, 440, 40, [{ t: s.title_ko, st: { f: KO, s: 13, c: c.soft }, pa: { ls: 125 } }]);
  if (s.ref) P.text(240, 250, 440, 18, [{ t: s.ref, st: { f: MO, s: 9, c: c.light } }]);
  foot_(P, c, i, c.light);
}

function rVideo_(P, c, s, i) {
  chrome_(P, c, s, i);
  const w = 452, h = 254;
  P.video(s.video, (720 - w) / 2, BODY_TOP + 2, w, h);
}

function rListen_(P, c, s, i) {
  chrome_(P, c, s, i);
  const a = c.audio && c.audio[s.audioKey];
  P.text(40, BODY_TOP, 420, 120, [
    { t: 'LISTEN · 듣기', st: { f: MO, s: 8.5, c: c.brand } },
    { t: 'Listen to the whole recording first. Don\u2019t stop \u2014 just get the big picture.', st: { f: EN, s: 18, b: true, c: INK }, pa: { sa: 8, ls: 110 } },
    { t: '먼저 녹음을 끝까지 들어 보세요. 멈추지 말고 큰 그림만 잡습니다.', st: { f: KO, s: 11.5, c: INK3 }, pa: { sa: 6, ls: 130 } }]);
  if (a) audioButton_(P, c, a, 44, BODY_TOP + 140, 300, 48, '\u25B6  전체 듣기' + (a.secs ? '  ' + mmss_(a.secs) : ''));
  else P.text(44, BODY_TOP + 140, 420, 48, [{ t: '음성 파일이 아직 없습니다 — 교재 음원을 드라이브에 올려 이 자리에 연결하세요.', st: { f: KO, s: 10.5, c: INK3 } }],
    { type: 'ROUND_RECTANGLE', fill: '#FAFAFA', line: '#D6D6D6', dash: 'DASH', middle: true });
  P.text(40, 330, 640, 32, [{ t: (a && a.own ? '선생님이 연결한 음원입니다' : '합성 음성(제미나이 TTS) 대체 음원입니다') + ' · 슬라이드 안에서 바로 재생하려면 편집기에서 삽입 → 오디오 → 드라이브의 같은 파일', st: { f: KO, s: 8.5, c: INK3 } }]);
  focus_(P, c, { label: 'TRACK', big: a ? (a.secs ? mmss_(a.secs) : '\u25B6') : '—', ko: a ? a.name : '' });
}

/** ▶ 버튼: 누르면 드라이브 재생 창 */
function audioButton_(P, c, a, x, y, w, h, label) {
  P.text(x, y, w, h, [{ t: label, st: { f: EN, s: h > 36 ? 15 : 10.5, b: true, c: '#FFFFFF' }, pa: { al: 'CENTER' } }],
    { type: 'ROUND_RECTANGLE', fill: c.brand, middle: true, link: a.url });
}

/** 듣기 장이 있는 섹션 — 이 섹션의 지면·교재 문항 장에도 전체 음원을 단다 (클로드본처럼 문제 풀며 다시 듣기) */
function listenSecs_(deck) {
  const o = {};
  deck.forEach(s => { if (s.kind === 'listen') o[s.sec] = true; });
  return o;
}

/** 제목 줄 오른쪽 작은 ▶ 전체 듣기 */
function fullAudioChip_(P, c, s) {
  const a = c.audio && c.audio.full;
  if (!a || !(c.listenSecs || {})[s.sec]) return;
  audioButton_(P, c, a, 572, 40, 108, 24, '▶  전체 듣기');
}

function rPage_(P, c, s, i) {
  chrome_(P, c, s, i);
  fullAudioChip_(P, c, s);
  if (s.images && s.images.length) return; // 지면 사진은 placePageImages_가 넣는다
  P.text(40, BODY_TOP + 2, 640, BODY_BOTTOM - BODY_TOP - 4, [
    { t: `${s.ref || '교재'} 지면 자리`, st: { f: KO, s: 14, b: true, c: INK2 }, pa: { al: 'CENTER' } },
    { t: '이 점선 상자를 지우고 [삽입 → 이미지 → 드라이브]로 교재 사진을 넣으세요.', st: { f: KO, s: 10.5, c: INK3 }, pa: { al: 'CENTER', sa: 8 } },
    { t: s.starts ? `Starts with: “${s.starts}”` : '', st: { f: EN, s: 10.5, i: true, c: INK3 }, pa: { al: 'CENTER', sa: 14 } },
  ], { type: 'ROUND_RECTANGLE', fill: '#FAFAFA', line: '#BDBDBD', dash: 'DASH', middle: true });
}

function rScript_(P, c, s, i) {
  chrome_(P, c, s, i);
  const paras = [{ t: 'SCRIPT · 대본 발췌 (원문 그대로)', st: { f: MO, s: 8, c: c.brand } }];
  s.lines.forEach((l, n) => {
    paras.push({ t: [[l.spk ? l.spk.toUpperCase() + '   ' : '', { f: MO, s: 9, b: true, c: c.deep }], [l.en, { f: EN, s: 14, c: INK }]], pa: { sa: n ? 10 : 8, ls: 115 } });
    if (l.ko) paras.push({ t: l.ko, st: { f: KO, s: 10.5, c: INK3 }, pa: { sa: 2, ls: 125 } });
  });
  P.rect(46, BODY_TOP + 20, 2, 210, c.line);
  P.text(52, BODY_TOP, 628, BODY_BOTTOM - BODY_TOP, paras);
  const a = c.audio && c.audio[s.audioKey];
  if (a) audioButton_(P, c, a, 560, 344, 120, 24, '\u25B6 LISTEN  ' + mmss_(a.secs));
}

function rQuestion_(P, c, s, i) {
  chrome_(P, c, s, i);
  if (s.from_textbook) fullAudioChip_(P, c, s);
  const label = `${s.label || 'QUESTION'}  ·  ${s.from_textbook ? '교재 문항' : '생각해 보기'}`;
  P.text(40, BODY_TOP, 640, 18, [{ t: label.toUpperCase(), st: { f: MO, s: 8.5, c: c.brand } }]);
  const qh = estH_(s.q_en, 20, 640, 1.2) + 6 + estH_(s.q_ko, 12, 640, 1.4) + 6;
  P.text(40, BODY_TOP + 18, 640, qh, [
    { t: s.q_en, st: { f: EN, s: 20, b: true, c: INK }, em: { b: true, c: c.deep }, pa: { ls: 110 } },
    { t: s.q_ko, st: { f: KO, s: 12, c: INK3 }, pa: { sa: 6, ls: 125 } }]);
  let y = BODY_TOP + 18 + qh + 12;
  if (s.options && s.options.length) {
    const two = s.options.every(o => o.length <= 38) && s.options.length > 2;
    const w = two ? 312 : 636;
    s.options.forEach((o, n) => {
      const x = two ? 44 + (n % 2) * 324 : 44, yy = y + (two ? Math.floor(n / 2) : n) * 44;
      P.text(x, yy, w, 36, [{ t: [[String.fromCharCode(65 + n) + '    ', { f: MO, s: 10, b: true, c: c.brand }], [o, { f: EN, s: 13, c: INK2 }]] }],
        { type: 'ROUND_RECTANGLE', fill: '#FFFFFF', line: '#D6D6D6', middle: true });
    });
  } else {
    P.text(44, y, 636, Math.max(60, BODY_BOTTOM - y - 6), [{ t: 'Your answer · 여러분의 답', st: { f: MO, s: 9, c: INK3 } }],
      { type: 'ROUND_RECTANGLE', fill: '#FAFAFA', line: '#D6D6D6', dash: 'DASH' });
  }
}

function rAnswer_(P, c, s, i) {
  chrome_(P, c, s, i);
  const need = String(s.answer_en).indexOf(NEED) > -1;
  const fill = need ? ACCENT_SOFT : c.soft, line = need ? ACCENT_LINE : c.line, deep = need ? ACCENT_DEEP : c.deep;
  P.text(40, BODY_TOP, 640, 18, [{ t: s.q_en, st: { f: EN, s: 11, i: true, c: INK3 } }]);
  const h = Math.min(200, 44 + estH_(s.answer_en, 20, 620, 1.2) + estH_(s.why_ko, 12, 620, 1.4) + 10);
  P.text(40, BODY_TOP + 26, 640, h, [
    { t: need ? 'ANSWER · 원문 필요 — 교사용 지도서 정답을 넣어 주세요' : 'ANSWER · 정답과 해설', st: { f: MO, s: 8, c: deep } },
    { t: s.answer_en, st: { f: EN, s: 20, b: true, c: deep }, pa: { sa: 6, ls: 110 } },
    { t: s.why_ko, st: { f: KO, s: 12, c: INK2 }, pa: { sa: 8, ls: 130 } }],
    { type: 'ROUND_RECTANGLE', fill, line });
  if (s.evidence) P.text(40, BODY_TOP + 34 + h, 640, 40, [{ t: [['근거(원문)  ', { f: KO, s: 9, b: true, c: INK3 }], [`“${s.evidence}”`, { f: EN, s: 10, i: true, c: INK3 }]] }]);
}

function rChips_(P, c, s, i) {
  chrome_(P, c, s, i);
  const n = s.groups.length, gap = 18, w = (640 - gap * (n - 1)) / n;
  s.groups.forEach((g, k) => {
    const x = 40 + k * (w + gap);
    P.text(x, BODY_TOP, w, 18, [{ t: String(g.label || '').toUpperCase(), st: { f: MO, s: 8, c: c.deep } }]);
    g.items.forEach((it, m) => {
      const h = it.length > 30 ? 48 : 34;
      P.text(x + 4, BODY_TOP + 24 + m * 56, w - 8, h, [{ t: it, st: { f: EN, s: 12.5, b: true, c: c.deep }, pa: { ls: 110 } }],
        { type: 'ROUND_RECTANGLE', fill: c.soft, line: c.line, middle: true });
    });
  });
}

function rCards_(P, c, s, i) {
  chrome_(P, c, s, i);
  const w = 202;
  s.cards.forEach((cd, k) => {
    const warm = cd.warm;
    P.text(40 + k * (w + 17), BODY_TOP + 4, w, 230, [
      { t: cd.label, st: { f: MO, s: 8, c: warm ? ACCENT_DEEP : INK3 } },
      { t: cd.p.en, st: { f: EN, s: 13.5, b: true, c: INK }, pa: { sa: 10, ls: 115 } },
      { t: cd.p.ko, st: { f: KO, s: 10.5, c: INK3 }, pa: { sa: 6, ls: 130 } }],
      { type: 'ROUND_RECTANGLE', fill: warm ? ACCENT_SOFT : '#FFFFFF', line: warm ? ACCENT_LINE : c.line });
  });
}

function rTicks_(P, c, s, i) {
  chrome_(P, c, s, i);
  const paras = [];
  s.items.forEach((p, n) => {
    paras.push({ t: [['■   ', { f: EN, s: 9, c: c.brand }], [p.en, { f: EN, s: 14, b: true, c: INK }]], pa: { sa: n ? 14 : 0, ls: 115 } });
    paras.push({ t: p.ko, st: { f: KO, s: 10.5, c: INK3 }, pa: { sa: 3, ls: 130 } });
  });
  P.text(40, BODY_TOP, 420, BODY_BOTTOM - BODY_TOP, paras);
  focus_(P, c, s.focus, true);
}

function rRows_(P, c, s, i) {
  chrome_(P, c, s, i);
  const h = 62;
  s.rows.forEach((r, k) => {
    const y = BODY_TOP + k * h;
    P.rect(40, y, 640, 0.75, '#D6D6D6');
    P.text(40, y + 4, 220, h - 6, [
      { t: r.t_en, st: { f: EN, s: 14, b: true, c: INK } },
      { t: r.t_ko, st: { f: KO, s: 9.5, c: INK3 }, pa: { sa: 2 } }]);
    P.text(266, y + 4, 414, h - 6, [
      { t: r.en, st: { f: EN, s: 11.5, c: INK }, pa: { ls: 115 } },
      { t: r.ko, st: { f: KO, s: 9.5, c: INK3 }, pa: { sa: 2, ls: 125 } }]);
  });
  P.rect(40, BODY_TOP + s.rows.length * h, 640, 0.75, '#D6D6D6');
}

function rClose_(P, c, s, i) {
  P.bg(INK);
  P.shape('ELLIPSE', 470, -190, 420, 420, { fill: '#1E2A25' });
  P.text(40, 30, 640, 18, [{ t: 'WRAP-UP  ·  오늘 정리', st: { f: MO, s: 9, c: c.light } }]);
  const kh = Math.min(110, estH_(s.key.en, 22, 620, 1.2) + estH_(s.key.ko, 12, 620, 1.4) + 10);
  P.rect(46, 60, 3, kh - 8, c.light);
  P.text(54, 54, 626, kh, [
    { t: s.key.en, st: { f: EN, s: 22, b: true, c: '#FFFFFF' }, em: { b: true, c: c.light }, pa: { ls: 110 } },
    { t: s.key.ko, st: { f: KO, s: 12, c: '#B5B5B5' }, pa: { sa: 6, ls: 125 } }]);
  const w = 202, y = Math.max(170, 54 + kh + 18);
  s.cards.forEach((cd, k) => {
    P.text(40 + k * (w + 17), y, w, 340 - y, [
      { t: cd.label, st: { f: MO, s: 8, c: k === 1 ? '#FF9B7A' : c.light } },
      { t: cd.en, st: { f: EN, s: 12.5, b: true, c: '#FFFFFF' }, pa: { sa: 8, ls: 115 } },
      { t: cd.ko, st: { f: KO, s: 10, c: '#B5B5B5' }, pa: { sa: 5, ls: 125 } }],
      { type: 'ROUND_RECTANGLE', fill: '#222222', line: '#3A3A3A' });
  });
  P.text(40, 348, 640, 18, [{ t: [['QUIZ · 확인 퀴즈   ', { f: MO, s: 8.5, c: c.light }], ['{{QUIZ}}', { f: MO, s: 8.5, c: '#FFFFFF' }]] }]);
  foot_(P, c, i, '#8A8A8A');
}
