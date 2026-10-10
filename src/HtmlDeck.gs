/**
 * HTML 덱 — 선생님이 Claude(english-lecture-deck)로 만들던 것과 같은 모양의 인터랙티브 덱
 *
 * 구글 슬라이드와 같은 내용(st.deck)을 쓰되, 슬라이드로는 못 하던 것을 살린다.
 *  - 오디오: 대본 장·듣기 장에 플레이어가 바로 들어간다 (음원은 파일 안에 넣는다 → 인터넷 없이도 재생)
 *  - 영상: 표지 다음 개요 영상, 섹션 끝 복습 영상이 슬라이드 안에서 재생된다
 *  - 연습: 보기 고르기·빈칸 쓰기를 슬라이드 안에서 → 로 채점, S 키 학생 모드 (기존 덱 스크립트 그대로)
 *  - 문항과 정답은 한 장에 (정답은 → 를 눌러야 열린다) → 구글 슬라이드보다 장수가 줄어든다
 * 디자인·스크립트는 DeckTemplate.html (6주차 덱에서 가져옴).
 * 결과: 교수용(…_덱.html), 학생용(…_덱_학생용.html, 학생 모드로 열림). JNUclass에 그대로 올린다.
 */

const EMBED_LIMIT = 30 * 1024 * 1024; // 파일 안에 넣는 음원·영상 합계 상한 (넘으면 드라이브 링크로)

function step6b_html(folderId) {
  const st = loadState_(folderId);
  const folder = DriveApp.getFolderById(folderId);
  const media = { used: 0, store: {}, notes: [] };
  const body = htmlSlides_(st, media);
  const tpl = HtmlService.createHtmlOutputFromFile('DeckTemplate').getContent();
  const title = `${COURSES[st.input.course].name} · Week ${st.input.week}-${st.input.session} · ${st.outline.title_en}`;
  const build = student => tpl
    .replace('%%TITLE%%', escH_(title))
    .replace('%%SLIDES%%', () => body.html)
    .replace('%%STORE%%', () => JSON.stringify(media.store).replace(/</g, '\\u003c'))
    .replace('%%STUDENT%%', student ? 'true' : 'false');

  [st.htmlId, st.htmlStudentId].filter(Boolean).forEach(trash_);
  const base = st.folderName;
  const t = folder.createFile(Utilities.newBlob(build(false), 'text/html', `${base}_덱.html`));
  const s = folder.createFile(Utilities.newBlob(build(true), 'text/html', `${base}_덱_학생용.html`));
  st.htmlId = t.getId(); st.htmlStudentId = s.getId();
  st.htmlUrl = t.getUrl(); st.htmlStudentUrl = s.getUrl();
  const app = ScriptApp.getService().getUrl();
  st.htmlView = `${app}?deck=${t.getId()}`;
  st.htmlStudentView = `${app}?deck=${s.getId()}`;
  saveState_(st);
  return { slides: body.count, mb: Math.round(t.getSize() / 1048576 * 10) / 10, audio: Object.keys(media.store).length,
    notes: media.notes, view: st.htmlView };
}

/** 웹앱 주소?deck=<파일 ID> → 그 HTML 덱을 브라우저에서 바로 연다 (미리보기) */
function deckPage_(id) {
  const html = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
  return HtmlService.createHtmlOutput(html).setTitle('강의 덱').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ───────────────────────── 장 만들기 ─────────────────────────

function escH_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** 글 + **강조** → HTML */
function emH_(s) { return escH_(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }

function htmlSlides_(st, media) {
  const inp = st.input, c = ctx_(st);
  const audio = audioMap_(st.folderId, st.audioJobs || []);
  const D = st.deck, out = [];
  const foot = notes => `<div class="foot"><span>${escH_(c.foot)}</span><span class="n"></span></div><div class="notes-src">${escH_(notes || '')}</div>`;
  const eyebrow = s => `<div class="eyebrow"><span>Week ${c.week} ▸ ${escH_(s.sec)}</span><span class="page-ref">${escH_(s.ref || '')}</span></div>`;
  const head = (s, ko) => eyebrow(s) + `<h1 class="h-title${ko ? ' ko' : ''}">${emH_(s.title_en)}</h1>` +
    (s.title_ko ? `<div class="h-sub">${emH_(s.title_ko)}</div>` : '') + '<div class="rule"></div>';
  const pair = (p, cls) => p ? `<div class="pair ${cls || ''}"><div class="en">${emH_(p.en)}</div><div class="ko">${emH_(p.ko)}</div></div>` : '';
  const aud = (key, label) => {
    const a = audio[key];
    if (!a || !embedAudio_(a, key, media)) return '';
    return `<div class="aud"><audio controls preload="metadata" data-aud="${key}"></audio><span class="aud-l">${escH_(label)}${a.secs ? ' · ' + mmss_(a.secs) : ''}${a.own ? '' : ' · <em>TTS 대체 음원</em>'}</span></div>`;
  };

  for (let i = 0; i < D.length; i++) {
    const s = D[i];
    let h = '';
    if (s.kind === 'title') {
      h = `<section class="slide s-title"><div class="orb" style="width:520px;height:520px;right:-130px;top:-160px"></div><div class="orb" style="width:300px;height:300px;right:120px;bottom:-110px"></div><div class="inner">` +
        `<div class="kicker">${escH_(c.en)} · Fall 2026</div><div class="kicker-ko">${escH_(c.name)} · 2026학년도 2학기</div>` +
        `<h1>${emH_(s.title_en)}</h1><div class="h1-ko">${emH_(s.title_ko)}</div>` +
        `<div class="badge">${escH_(c.foot.replace(c.name + ' · ', ''))}</div>` +
        `<div class="meta">교재 ${escH_(inp.pages)} · <i>${escH_(inp.book)}</i> · ${escH_(st.outline.sections.map(x => x.name_en).join(' → '))}</div></div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'divider') {
      h = `<section class="slide s-divider"><div class="inner"><div class="big">${s.num}</div><div><div class="of">Section ${s.num} of ${s.of}</div>` +
        `<h2>${emH_(s.title_en)}</h2><div class="d-ko">${emH_(s.title_ko)}</div><div class="d-row"><div class="d-ref">${escH_(s.ref || '')}</div></div></div></div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'goals') {
      const col = (t, list) => `<div><div class="col-h">${t}</div>` + list.map((g, k) =>
        `<div class="goal"><div class="num">${k + 1}</div><div class="txt"><div class="g-en">${emH_(g.en)}</div><div class="g-ko">${emH_(g.ko)}</div></div></div>`).join('') + '</div>';
      h = `<section class="slide"><div class="orb-soft"></div>${eyebrow(s)}<h1 class="h-title ko">오늘의 목표와 흐름 · Goals &amp; Flow</h1><div class="rule"></div>` +
        `<div class="body"><div class="cols">${col('Goals · 학습 목표', s.goals)}${col('Flow · 수업 흐름', s.flow)}</div></div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'page') {
      const imgs = (s.images || []).map(im => imageData_(im.id, media)).filter(Boolean);
      const frame = imgs.length
        ? `<div class="page-frame${imgs.length > 1 ? ' split' : ''}">${imgs.map(u => `<img src="${u}" alt="">`).join('')}</div>`
        : `<div class="placeholder"><div class="big">${escH_(s.ref || '교재')}</div><div class="small">교재 지면 사진을 [교재 지면]에 jpg로 올리면 여기에 들어갑니다</div></div>`;
      h = `<section class="slide">${eyebrow(s)}<h1 class="h-title ko">교재 보기 · ${escH_(s.ref || '')} ${escH_(s.sec)}</h1><div class="rule"></div>` +
        `<div class="body tall">${frame}${s.starts ? `<div class="page-cap">${escH_(s.starts)} …</div>` : ''}</div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'listen') {
      h = `<section class="slide">${head(s)}<div class="body mid">` +
        pair({ en: 'Listen to the whole recording first. Don’t stop — just get the **big picture**.', ko: '먼저 녹음을 끝까지 들어 보세요. 멈추지 말고 **큰 그림**만 잡습니다.' }, 'key') +
        (aud('full', inp.title) || '<div class="ph-ttsnote">음성 파일이 없습니다 — 교재 음원을 연결하면 여기에 플레이어가 들어갑니다.</div>') +
        `</div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'script') {
      h = `<section class="slide">${head(s)}<div class="body tall">${aud(s.audioKey, '이 대목 듣기')}` +
        `<div class="script">${s.lines.map(l => `<span class="spk">${escH_(l.spk)}</span>${emH_(l.en)}<br>`).join('')}</div>` +
        `<div class="script-ko">${s.lines.map(l => escH_(l.ko)).filter(Boolean).join(' · ')}</div></div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'question') {
      const a = D[i + 1] && D[i + 1].kind === 'answer' ? D[i + 1] : null;
      if (a) i++; // 정답 장은 같은 장에 → 로 열리게
      h = `<section class="slide">${head(s)}<div class="body tall">${questionHtml_(s, a)}</div>${foot([s.notes, a && a.notes].filter(Boolean).join(' / '))}</section>`;
    } else if (s.kind === 'answer') {
      h = `<section class="slide">${head(s)}<div class="body tall">${answerBox_(s, false)}</div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'chips') {
      h = `<section class="slide">${head(s)}<div class="body">` + s.groups.map((g, k) =>
        `<div class="col-h">${escH_(g.label)}</div><div class="chips">${g.items.map(x => `<span class="chip${k ? ' plain' : ''}">${escH_(x)}</span>`).join('')}</div>`).join('') +
        `</div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'cards' || s.kind === 'close') {
      const cards = s.cards.map(cd => {
        const p = cd.p || { en: cd.en, ko: cd.ko };
        return `<div class="card${cd.warm ? ' warm' : ''}"><div class="c-label">${escH_(cd.label)}</div><div class="c-en">${emH_(p.en)}</div><div class="c-ko">${emH_(p.ko)}</div></div>`;
      }).join('');
      if (s.kind === 'close') {
        const quiz = st.formShort || st.formUrl;
        h = `<section class="slide s-close"><div class="orb-soft"></div>${eyebrow(s)}<h1 class="h-title">${emH_(s.key.en)}</h1><div class="h-sub">${emH_(s.key.ko)}</div><div class="rule"></div>` +
          `<div class="body mid"><div class="cards c3">${cards}</div>${quiz ? `<div class="pair" style="margin-top:18px"><div class="en">Quiz · <b>${escH_(quiz)}</b></div><div class="ko">확인 퀴즈 — 위 주소로 들어가 풀어 보세요.</div></div>` : ''}</div>${foot(s.notes)}</section>`;
      } else {
        h = `<section class="slide">${head(s)}<div class="body mid"><div class="cards c3">${cards}</div></div>${foot(s.notes)}</section>`;
      }
    } else if (s.kind === 'ticks') {
      h = `<section class="slide">${head(s)}<div class="body"><div class="split2"><div><ul class="ticks">` +
        s.items.map(p => `<li><div class="en">${emH_(p.en)}</div><div class="ko">${emH_(p.ko)}</div></li>`).join('') + `</ul></div>` +
        `<div class="focus warm"><div class="f-label">${escH_(s.focus.label)}</div><div class="f-big" style="font-size:26px">${escH_(s.focus.big)}</div><div class="f-ko">${escH_(s.focus.ko)}</div></div></div></div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'rows') {
      h = `<section class="slide">${head(s)}<div class="body"><div class="rows">` + s.rows.map(r =>
        `<div class="row"><div class="r-t">${escH_(r.t_en)}<span class="ko">${escH_(r.t_ko)}</span></div><div><div class="r-en">${emH_(r.en)}</div><div class="r-ko">${emH_(r.ko)}</div></div></div>`).join('') +
        `</div></div>${foot(s.notes)}</section>`;
    } else if (s.kind === 'video') {
      h = `<section class="slide vslide">${eyebrow(s)}<h1 class="h-title">${emH_(s.title_en)}</h1><div class="body"><div class="vwrap">${videoHtml_(s.video, media)}</div></div>${foot(s.notes)}</section>`;
    } else { // pairs
      const pairs = (s.pairs || []).map(p => pair(p)).join('');
      const tags = (s.tags || []).map(t => typeof t === 'string' ? `<span class="tag">${escH_(t)}</span>` : `<span class="tag a">${escH_(t.t)}</span>`).join('');
      const main = (tags ? `<div class="tags">${tags}</div>` : '') + `<div class="pairs-n">${pair(s.key, 'key')}${pairs}</div>`;
      const body = s.focus
        ? `<div class="split2"><div>${main}</div><div class="focus"><div class="f-label">${escH_(s.focus.label)}</div><div class="f-big" style="${bigSize_(s.focus.big)}">${escH_(s.focus.big)}</div><div class="f-ko">${escH_(s.focus.ko)}</div></div></div>`
        : main;
      h = `<section class="slide"><div class="orb-soft"></div>${head(s)}<div class="body mid">${body}</div>${foot(s.notes)}</section>`;
    }
    out.push(h);
  }
  return { html: out.join('\n'), count: out.length };
}

/** 문항 한 장: 보기가 있으면 고르기(→ 채점), 빈칸(___)이면 쓰기, 아니면 질문 + 정답 열기 */
function questionHtml_(q, a) {
  const ans = a ? String(a.answer_en || '') : '';
  const graded = a && ans && ans.indexOf(NEED) < 0 && !/^sample\b/i.test(ans);
  const label = `<div class="ix-top"><span class="ix-hint">${escH_((q.label || 'QUESTION') + ' · ' + (q.from_textbook ? '교재 문항' : '생각해 보기'))}</span></div>`;
  if (graded && q.options && q.options.length) {
    const hit = matchOption_(q.options, ans);
    if (hit) {
      return label.replace('</span></div>', ' · 보기를 누른 뒤 → 로 채점</span></div>') +
        `<div class="ix"><div class="row" data-a="${escH_(hit)}"><div class="idx">${escH_((q.label.match(/\d+/) || ['Q'])[0])}</div><div class="main">` +
        `<div class="q">${emH_(noNum_(q.q_en))}</div><div class="q-ko">${emH_(noNum_(q.q_ko))}</div><div class="opts">${q.options.map(o => `<button class="opt">${escH_(o)}</button>`).join('')}</div>` +
        `</div></div><div class="fb"></div></div>${answerBox_(a, true)}`;
    }
  }
  if (graded && /_{3,}/.test(q.q_en) && ans.length < 60) {
    const gap = `<input class="gap" type="text" autocomplete="off" spellcheck="false" style="width:${Math.min(320, 60 + ans.length * 9)}px">`;
    return label.replace('</span></div>', ' · 빈칸에 쓰고 Enter 또는 → 로 채점</span></div>') +
      `<div class="ix"><div class="row" data-a="${escH_(ans)}"><div class="idx">${escH_((q.label.match(/\d+/) || ['Q'])[0])}</div><div class="main">` +
      `<div class="q">${escH_(noNum_(q.q_en)).replace(/_{3,}/, gap)}</div><div class="q-ko">${emH_(noNum_(q.q_ko))}</div></div></div><div class="fb"></div></div>${answerBox_(a, true)}`;
  }
  return label + `<div class="q"><div class="q-en">${emH_(q.q_en)}</div><div class="q-ko">${emH_(q.q_ko)}</div></div>` + (a ? answerBox_(a, true) : '');
}

/** 포커스 패널의 큰 글자: 길면 줄인다 (패널 폭 292px) */
function bigSize_(t) { const n = String(t || '').length; return n > 14 ? 'font-size:22px;letter-spacing:-.01em' : n > 9 ? 'font-size:30px' : ''; }
/** 문항 앞 번호("1 ", "2. ")는 번호 동그라미가 따로 있으므로 뺀다 */
function noNum_(t) { return String(t || '').replace(/^\s*\d+[.)]?\s+/, ''); }

function answerBox_(a, step) {
  return `<div class="answer${step ? ' st' : ''}"><div class="a-label">Answer · 정답과 해설</div><div class="a-en">${emH_(a.answer_en)}</div>` +
    `<div class="a-ko">${emH_(a.why_ko)}${a.evidence ? `<br><i>근거: “${escH_(a.evidence)}”</i>` : ''}</div></div>`;
}

/** 정답("a", "b. a walking tour", "F")에 맞는 보기 글을 찾는다 */
function matchOption_(opts, ans) {
  const n = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = n(ans);
  if (!a) return null;
  let hit = opts.find(o => n(o) === a);
  if (!hit && a.length === 1) hit = opts.find(o => new RegExp('^\\s*\\(?' + a + '[\\s).·:-]', 'i').test(o));
  if (!hit && a.length > 1 && /^[a-d]$/.test(a[0]) && /^[a-d][\s.).·:-]/i.test(String(ans).trim())) {
    hit = opts.find(o => new RegExp('^\\s*\\(?' + a[0] + '[\\s).·:-]', 'i').test(o));
  }
  if (!hit) hit = opts.find(o => n(o).indexOf(a) > -1 || (a.length > 4 && a.indexOf(n(o)) > -1));
  return hit || null;
}

// ───────────────────────── 음원·영상·사진 넣기 ─────────────────────────

function embedAudio_(a, key, media) {
  if (media.store[key]) return true;
  try {
    const blob = DriveApp.getFileById(a.id).getBlob();
    const size = blob.getBytes().length;
    if (media.used + size > EMBED_LIMIT) { media.notes.push(`음원 ${a.name}은 용량이 커서 넣지 않았습니다.`); return false; }
    media.used += size;
    media.store[key] = `data:${blob.getContentType() || 'audio/wav'};base64,` + Utilities.base64Encode(blob.getBytes());
    return true;
  } catch (e) { media.notes.push(`음원을 읽지 못했습니다: ${a.name}`); return false; }
}

function imageData_(id, media) {
  try {
    const blob = DriveApp.getFileById(id).getBlob();
    const size = blob.getBytes().length;
    if (media.used + size > EMBED_LIMIT) return null;
    media.used += size;
    return `data:${blob.getContentType()};base64,` + Utilities.base64Encode(blob.getBytes());
  } catch (e) { return null; }
}

function videoHtml_(v, media) {
  if (v.source === 'YOUTUBE') {
    return `<iframe src="https://www.youtube.com/embed/${escH_(v.id)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  try {
    const f = DriveApp.getFileById(v.id);
    if (media.used + f.getSize() <= EMBED_LIMIT) {
      const blob = f.getBlob();
      media.used += f.getSize();
      return `<video controls preload="metadata" playsinline src="data:${blob.getContentType() || 'video/mp4'};base64,${Utilities.base64Encode(blob.getBytes())}"></video>`;
    }
    media.notes.push(`영상 ${f.getName()}은 용량이 커서 드라이브 재생 창으로 연결했습니다(학생에게 공유 필요).`);
  } catch (e) { media.notes.push('영상 파일을 읽지 못해 드라이브 재생 창으로 연결했습니다.'); }
  return `<iframe src="https://drive.google.com/file/d/${escH_(v.id)}/preview" allow="autoplay" allowfullscreen></iframe>`;
}
