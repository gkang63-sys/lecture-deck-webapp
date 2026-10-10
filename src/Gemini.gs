/**
 * 제미나이 호출 · 프롬프트 · 원문 대조 검증
 *
 * AI가 교재에 없는 대본·정답을 지어내는 경향이 있어서 두 겹으로 막는다.
 *  1) 프롬프트: 인용 원칙(원문에 없으면 "[원문 필요]")
 *  2) 코드: 대본 줄·정답 근거·퀴즈 근거·표현을 원문과 글자 단위로 대조해, 없으면 자리표시자로 바꾸거나 빼고 경고를 남긴다.
 */

// 앞에서부터 시도. 첫 모델이 붐비거나 없으면 다음 모델로 넘어간다 (채점 자동화와 같은 목록).
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
const NEED = '[원문 필요]';

/** blobs: PDF·사진을 함께 보낼 때 (제미나이가 지면을 직접 읽음) */
function callGemini_(prompt, blobs) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Gemini API 키가 없습니다. 화면 위쪽 [API 키]에서 먼저 저장해 주세요.');
  const parts = (blobs || []).map(b => ({ inline_data: { mime_type: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) } }));
  parts.push({ text: prompt });
  const body = thinking => JSON.stringify({
    contents: [{ parts }],
    generationConfig: Object.assign({ responseMimeType: 'application/json', temperature: 0.5, maxOutputTokens: 32768 },
      thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
  });
  // Apps Script는 한 번에 6분까지만 돈다. 4분 30초가 지나면 새로 시도하지 않고 멈춰서,
  // 화면이 [이 단계 다시]를 보여 줄 수 있게 한다 (6분에 잘리면 이유도 모른 채 끝난다).
  const started = Date.now(), budget = 270 * 1000;
  let lastError = '';
  for (const model of MODELS) {
    let thinking = true; // '생각'을 짧게 — 속도가 크게 빨라진다. 이 설정을 모르는 모델이면 빼고 다시.
    // 서버가 붐빌 때(429·503)는 잠깐 기다렸다가 두 번 더 시도하고, 그래도 안 되면 다음 모델로
    for (const wait of [0, 4000, 10000]) {
      if (Date.now() - started + wait > budget) break;
      if (wait) Utilities.sleep(wait);
      const res = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': key },
          payload: body(thinking),
          muteHttpExceptions: true,
        });
      const code = res.getResponseCode();
      let data = {};
      try { data = JSON.parse(res.getContentText()); } catch (e) { /* HTML 오류 페이지 */ }
      if (code === 200 && data.candidates && data.candidates[0].content) {
        const text = data.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
        return { text, model };
      }
      lastError = `[${model}] ` + ((data.error && data.error.message) || ('HTTP ' + code));
      if (code === 400 && thinking && /thinking/i.test(lastError)) { thinking = false; continue; }
      if (code === 400 || code === 401 || code === 403) throw new Error(lastError); // 키 문제는 다시 시도해도 같음
      if (code !== 429 && code !== 503 && code !== 500) break; // 모델 이름이 없는 경우(404) 등은 바로 다음 모델로
    }
    if (Date.now() - started > budget) break;
  }
  throw new Error('제미나이가 제때 응답하지 않았습니다 (서버 혼잡). 잠시 뒤 [이 단계 다시]를 눌러 주세요. ' + lastError);
}

/**
 * 제미나이 답에서 JSON을 꺼낸다. 가끔 JSON 뒤에 설명을 덧붙이거나 같은 JSON을 두 번 보내므로,
 * 통째로 안 읽히면 첫 번째 { … } (또는 [ … ]) 덩어리만 괄호 짝을 세어 잘라 읽는다.
 */
function parseJson_(text) {
  const t = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* 아래에서 첫 덩어리만 */ }
  const start = t.search(/[{\[]/);
  if (start < 0) throw new Error('제미나이 답에 JSON이 없습니다. [이 단계 다시]를 눌러 주세요.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      if (--depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error('제미나이 답이 중간에 끊겼습니다 (너무 김). [이 단계 다시]를 눌러 주세요.');
}

// ───────────────────────── 프롬프트 ─────────────────────────

const RULES = [
  '[반드시 지킬 규칙]',
  '1. 인용 원칙: 교재 본문·듣기 대본·정답은 [교재 원문] [듣기 대본] [정답] 칸에 있는 글만 씁니다. 기억으로 복원하거나 지어내지 않습니다. 확인할 수 없으면 "[원문 필요]"라고 씁니다.',
  '2. 영어(en)가 위, 한국어(ko)가 아래. 한국어는 번역이 아니라 해설입니다. 직역체를 쓰지 말고, 옆자리 조교가 같은 내용을 다시 말해 주듯 "~습니다/~요" 존댓말로 씁니다.',
  '3. 용어는 처음 한 번 주제문(topic sentence)처럼 원어를 괄호로 안고 갑니다.',
  '4. 영어는 교수가 교실에서 실제로 하는 말(구어체, let\'s, notice, look at)로 씁니다. "This slide explains..." 같은 문장은 쓰지 않습니다. 한 덩어리는 1–2문장, 30단어 이내.',
  '5. 한 장에 한 호흡: 한 장에 영·한 쌍은 최대 4개. 연습 문항은 한 문항에 한 장.',
  '6. 강조는 **두 별표**로 감싸고, 한 장에 두 군데까지만.',
  '7. 모든 장에 notes(한국어 강의 노트): 무엇을 시킬지, 시간(예: 짝 활동 2분), 학생이 틀리기 쉬운 지점. 슬라이드 글을 되풀이하지 않습니다.',
  '8. 섹션마다 제주·한국 예를 한 번 들어도 좋습니다. 단, 해설에서만 하고 교재 원문처럼 꾸미지 않습니다.',
  '9. 실제 학생 이름이나 개인 정보는 쓰지 않습니다.',
  '10. [교안·지도서 해설]이 있으면 그 설명 순서와 문장을 뼈대로 삼습니다. 교안과 지도서 정답이 다르면 지도서를 따르고 notes에 적습니다.',
  '11. [입력]의 교재 쪽수 범위 밖의 지면은 다루지 않습니다 (원문에 다른 쪽이 섞여 있어도).',
].join('\n');

function inputBlock_(inp) {
  const c = COURSES[inp.course];
  return [
    '[입력]',
    `과목: ${c.name} (${c.en})`,
    `주차·차시: Week ${inp.week}-${inp.session} · ${inp.kind} (60분)`,
    `교재: ${inp.book || '—'} · 쪽수: ${inp.pages || '—'}`,
    `단원: ${inp.unit || '—'}`,
    `절 제목(교재): ${inp.title}`,
    `교재 섹션(순서대로): ${inp.sections.length ? inp.sections.join(' / ') : '(입력 없음 — 원문에 적힌 교재 표기를 그대로 찾아 쓰기)'}`,
    `학습 목표(교사 메모): ${inp.goals || '—'}`,
    `지난 시간: ${inp.lastClass || '—'}`,
    `과제 안내(교사 입력): ${inp.assignment || '(없음)'}`,
    '',
    '[교재 원문]', '"""', inp.source, '"""',
    '[듣기 대본]', '"""', inp.script || '(없음)', '"""',
    '[정답]', '"""', inp.answers || '(없음)', '"""',
    '[교안·지도서 해설 (참고)]', '"""', inp.plan || '(없음)', '"""',
  ].join('\n');
}

function outlinePrompt_(inp) {
  return [
    '당신은 제주대학교 교양영어 강사의 강의 슬라이드 설계를 돕는 조교입니다.',
    '아래 [입력]만 근거로 60분 차시 강의 덱의 뼈대를 JSON으로 만드세요.',
    '',
    inputBlock_(inp),
    '',
    RULES,
    '',
    '다음 JSON 형식으로만 답하세요.',
    '{',
    '  "title_en": "교재 절 제목 그대로",',
    '  "title_ko": "제목의 번역 — 이 차시를 한 줄로 요약 (예: 삶의 교훈 — 한 사람의 이야기를 듣고 뼈대를 읽어 내기)",',
    '  "intro": {"title_en": "인사 장 제목", "title_ko": "...", "pairs": [{"en": "...", "ko": "..."}], "focus": {"label": "TODAY", "big": "오늘의 축이 되는 낱말 하나", "ko": "한 줄"}, "notes": "..."},',
    '  "goals": [{"en": "...", "ko": "~할 수 있다"}],',
    '  "goals_notes": "...",',
    '  "sections": [{"name_en": "교재 섹션 이름 그대로", "name_ko": "그 섹션이 무엇을 하는 시간인지", "page_ref": "p.50", "starts_with": "이 섹션 원문의 첫 몇 단어 (원문 그대로)", "slides": 10}],',
    '  "phrasebook": {"title_en": "...", "title_ko": "...", "groups": [{"label": "묶음 이름", "items": ["원문에 있는 표현 그대로"]}], "notes": "..."},',
    '  "assignment": {"title_en": "...", "title_ko": "...", "what": {"en": "...", "ko": "..."}, "how": {"en": "...", "ko": "..."}, "when": {"en": "...", "ko": "..."}, "due": "...", "requirements": [{"en": "...", "ko": "..."}], "rubric": [{"t_en": "...", "t_ko": "...", "en": "...", "ko": "..."}], "notes": "..."},',
    '  "close": {"key_en": "오늘 가져갈 한 문장", "key_ko": "...", "today_ko": "오늘 한 일 한 줄", "next_en": "...", "next_ko": "...", "notes": "..."}',
    '}',
    '',
    '추가 규칙:',
    `- 덱 전체 목표는 ${inp.target}장(60분 차시 45–60장)입니다. sections의 slides 합계를 약 ${inp.target - 12}장으로 맞추고, 섹션마다 6–14장. 문항 하나는 문항 장 + 정답 장 = 2장으로 셉니다.`,
    '- 교재 섹션은 [입력]의 순서와 이름을 그대로 따릅니다. 새로 지어내지 않습니다.',
    '- intro.pairs는 2–3개: 인사 → 지난 시간과 오늘을 잇는 말("Last class we listened. Today we speak." 같은).',
    '- goals는 정확히 3개.',
    '- phrasebook.groups는 3묶음 × 3개까지, items는 [교재 원문]이나 [듣기 대본]에 있는 표현을 글자 그대로.',
    '- 과제(assignment)의 분량·기한·형식 숫자는 [과제 안내]에 있는 것만 씁니다. 없으면 "[입력 필요]". due는 과제 안내의 기한을 그대로.',
    '- rubric은 정확히 4항목. 과제 안내에 평가 기준이 있으면 그대로, 없으면 일반 기준(내용·구성·언어·전달)으로 쓰되 배점 숫자는 과제 안내에 있을 때만.',
  ].join('\n');
}

function quizPrompt_(inp, o) {
  return [
    '당신은 제주대학교 교양영어 강사의 조교입니다. 아래 [입력]만 근거로 수업 뒤 확인 퀴즈(구글 폼, 객관식)를 JSON으로 만드세요.',
    '',
    `[덱] ${o.title_en} — ${o.title_ko} · 섹션: ${o.sections.map(s => s.name_en).join(' / ')}`,
    '',
    inputBlock_(inp),
    '',
    '규칙:',
    '- 8문항. [교재 원문]이나 [듣기 대본]으로 정답을 확인할 수 있는 문항만 냅니다. 상식 문제는 내지 않습니다.',
    '- 교재 쪽수 범위 안의 내용만. 섹션마다 고르게.',
    '- 보기는 4개, answer는 보기 중 하나와 글자까지 똑같이.',
    '- evidence는 정답의 근거가 되는 문장을 [교재 원문]·[듣기 대본]·[정답]에서 한 글자도 바꾸지 말고 복사합니다.',
    '- explain_ko는 왜 그것이 답인지 한국어 한두 문장.',
    '',
    '다음 JSON으로만 답하세요:',
    '{"quiz": [{"q": "영어 문항", "q_ko": "한국어 도움말", "options": ["보기1", "보기2", "보기3", "보기4"], "answer": "보기 중 하나", "points": 1, "explain_ko": "...", "evidence": "근거 문장"}]}',
  ].join('\n');
}

function sectionPrompt_(inp, o, i) {
  const sec = o.sections[i];
  return [
    '당신은 제주대학교 교양영어 강사의 강의 슬라이드를 만드는 조교입니다.',
    '아래 [입력]만 근거로, 덱의 한 섹션에 들어갈 슬라이드 내용을 JSON으로 만드세요.',
    '',
    `[덱] ${o.title_en} — ${o.title_ko}`,
    `[덱의 섹션 순서] ${o.sections.map((s, k) => `${k + 1}. ${s.name_en}`).join(' / ')}`,
    `[이번에 만들 섹션] ${i + 1}. ${sec.name_en} (${sec.name_ko}) · 교재 ${sec.page_ref} · 원문 시작: "${sec.starts_with}"`,
    `[이번 섹션 목표 장수] ${sec.slides}장 (문항 하나 = 문항 장 + 정답 장 2장으로 셈)`,
    '',
    inputBlock_(inp),
    '',
    RULES,
    '',
    '섹션 표지와 교재 지면 장은 프로그램이 넣습니다. 그 뒤에 올 해설·문항 장만 slides 배열로 만드세요.',
    '순서: ① 섹션 개요(무엇을 왜 하는가) pairs 한 장 → ② 원문 순서대로 해설과 문항 → ③ (있으면) 표현 정리 → ④ 이 섹션 정리 한 장. 다른 섹션의 내용은 다루지 않습니다.',
    '',
    '각 장의 type은 아래 넷 중 하나입니다.',
    'A. {"type": "pairs", "title_en": "...", "title_ko": "...", "pairs": [{"en": "...", "ko": "..."}], "key": {"en": "...", "ko": "..."} 또는 null, "focus": {"label": "...", "big": "낱말 하나·규칙 하나·숫자 하나", "ko": "..."} 또는 null, "notes": "..."}',
    '   - 텍스트만 있는 장은 key(그 장에서 학생이 가져갈 단 하나의 문장)나 focus 중 최소 하나를 둡니다. key가 있으면 pairs는 3개까지.',
    'B. {"type": "script", "title_en": "...", "title_ko": "...", "lines": [{"spk": "화자 이름", "en": "...", "ko": "..."}], "notes": "..."}',
    '   - en은 [듣기 대본]이나 [교재 원문]의 문장을 한 글자도 바꾸지 않고 그대로 옮깁니다. ko는 요지가 아니라 문장 단위의 충실한 번역. 한 장에 5줄까지.',
    'C. {"type": "question", "from_textbook": true, "label": "Exercise C · 2", "title_en": "...", "title_ko": "...", "q_en": "...", "q_ko": "...", "options": ["..."] 또는 [], "answer": {"answer_en": "...", "why_ko": "왜 그것이 답인지 한 줄", "evidence": "근거 문장"}, "notes": "..."}',
    '   - 한 문항 = 한 장. 교재 연습 문항이면 from_textbook=true이고 q_en은 원문 그대로.',
    '   - answer_en은 [정답] 칸이나 원문에서 확인되는 것만 씁니다. evidence에는 근거 문장을 [정답]·[듣기 대본]·[교재 원문]에서 그대로 복사합니다. 확인할 수 없으면 answer_en을 "[원문 필요]", evidence를 ""로.',
    '   - 토론·자유 답변 질문은 from_textbook=false로 하고, answer_en을 "Sample: ..."처럼 모범 답안 예시로 씁니다(evidence는 "").',
    'D. {"type": "chips", "title_en": "...", "title_ko": "...", "groups": [{"label": "...", "items": ["..."]}], "notes": "..."}',
    '   - 표현 모음. 3묶음 × 3개까지. items는 원문에 있는 표현 그대로.',
    '',
    '다음 JSON 형식으로만 답하세요: {"slides": [ ... ]}',
  ].join('\n');
}

// ───────────────────────── 검증 ─────────────────────────

/** 원문 대조용: 소문자 + 영문·숫자만 남김 (따옴표·띄어쓰기 차이는 무시) */
/** 원문 대조에 쓰는 글 전체: 교재 원문 + 대본 + 정답 + 교안·지도서 */
function srcAll_(inp) { return norm_([inp.source, inp.script, inp.answers, inp.plan].join(' ')); }
function norm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function inSource_(text, src) {
  const t = norm_(String(text || '').replace(/\*\*/g, ''));
  return t.length >= 6 && src.indexOf(t) > -1;
}
/** 짧은 표현(낱말 하나)도 원문에 있는지 */
function found_(text, src) { const t = norm_(text); return t.length >= 2 && src.indexOf(t) > -1; }
function str_(x) { return String(x == null ? '' : x).trim(); }
function pair_(p) { return p && (str_(p.en) || str_(p.ko)) ? { en: str_(p.en), ko: str_(p.ko) } : null; }

function checkOutline_(o, inp, flags) {
  o = o || {};
  const src = srcAll_(inp);
  o.title_en = inp.title; // 제목은 교재 절 제목 그대로
  o.title_ko = str_(o.title_ko);
  o.intro = o.intro || {};
  o.intro.pairs = (o.intro.pairs || []).map(pair_).filter(Boolean).slice(0, 3);
  o.goals = (o.goals || []).map(pair_).filter(Boolean).slice(0, 3);

  // 섹션: 교사가 적은 섹션 이름과 순서를 우선
  let secs = (o.sections || []).filter(s => s && str_(s.name_en));
  if (inp.sections.length) {
    secs = inp.sections.map((name, k) => Object.assign({}, secs[k] || {}, { name_en: name }));
  }
  if (!secs.length) throw new Error('제미나이가 섹션을 나누지 못했습니다. 화면의 [교재 섹션] 칸에 섹션 이름을 줄마다 적고 다시 시도해 주세요.');
  o.sections = secs.map(s => ({
    name_en: str_(s.name_en), name_ko: str_(s.name_ko), page_ref: str_(s.page_ref) || inp.pages,
    starts_with: str_(s.starts_with), slides: Math.min(14, Math.max(6, parseInt(s.slides, 10) || 10)),
  }));

  // 표현 모음: 원문에 있는 표현만
  const pb = o.phrasebook || {};
  pb.groups = (pb.groups || []).map(g => {
    const items = (g.items || []).map(str_).filter(Boolean);
    const ok = items.filter(x => found_(x, src));
    if (ok.length < items.length) flags.push(`[표현 모음] 원문에 없는 표현을 뺐습니다: ${items.filter(x => ok.indexOf(x) < 0).join(', ')}`);
    return { label: str_(g.label), items: ok.slice(0, 3) };
  }).filter(g => g.items.length).slice(0, 3);
  o.phrasebook = pb;

  // 과제: 숫자·기한은 교사 입력에서만
  const a = o.assignment || {};
  a.requirements = (a.requirements || []).map(pair_).filter(Boolean).slice(0, 4);
  a.rubric = (a.rubric || []).filter(Boolean).slice(0, 4).map(r => ({
    t_en: str_(r.t_en), t_ko: str_(r.t_ko), en: str_(r.en), ko: str_(r.ko) }));
  ['what', 'how', 'when'].forEach(k => { a[k] = pair_(a[k]) || { en: '[입력 필요]', ko: '[입력 필요]' }; });
  if (!inp.assignment) {
    a.due = '[기한 입력]';
    a.when = { en: 'Due: [deadline]', ko: '기한: [입력 필요] — 과제 안내 칸이 비어 있었습니다.' };
    flags.push('[과제] 과제 안내 칸이 비어 있어 기한·분량을 자리표시자로 두었습니다. 슬라이드에서 직접 채워 주세요.');
  } else {
    a.due = str_(a.due) || '[기한 입력]';
    const allowed = (inp.assignment.match(/\d+/g) || []);
    const used = JSON.stringify([a.what, a.how, a.when, a.due, a.requirements, a.rubric]).match(/\d+/g) || [];
    const odd = used.filter(n => allowed.indexOf(n) < 0);
    if (odd.length) flags.push(`[과제] 과제 안내에 없는 숫자가 들어갔습니다: ${odd.join(', ')} — 슬라이드의 과제 장을 확인해 주세요.`);
  }
  if (a.rubric.length < 4) flags.push(`[과제] 평가 기준이 ${a.rubric.length}개뿐입니다(4개 필요).`);
  o.assignment = a;

  o.close = o.close || {};
  o.quiz = [];
  return o;
}

function checkQuiz_(quiz, inp, flags) {
  const src = srcAll_(inp);
  const ok = [];
  (quiz || []).forEach((q, n) => {
    q = q || {};
    const opts = (q.options || []).map(str_).filter(Boolean);
    const ans = str_(q.answer);
    const why = [];
    if (!str_(q.q)) why.push('문항이 비어 있음');
    if (opts.length < 2) why.push('보기 부족');
    if (opts.indexOf(ans) < 0) why.push('정답이 보기에 없음');
    if (!inSource_(q.evidence, src)) why.push('근거 문장이 원문에 없음');
    if (why.length) { flags.push(`[퀴즈] ${n + 1}번을 뺐습니다 (${why.join(', ')}): ${str_(q.q)}`); return; }
    ok.push({ q: str_(q.q), q_ko: str_(q.q_ko), options: opts.slice(0, 5), answer: ans,
      points: Math.max(1, parseInt(q.points, 10) || 1), explain_ko: str_(q.explain_ko), evidence: str_(q.evidence) });
  });
  return ok;
}

function checkSectionSlides_(slides, inp, sec, flags) {
  const tag = `[${sec.name_en}]`;
  const src = srcAll_(inp);
  const out = [];
  (slides || []).forEach(s => {
    if (!s || typeof s !== 'object') return;
    const base = { title_en: str_(s.title_en) || sec.name_en, title_ko: str_(s.title_ko), notes: str_(s.notes) };
    const type = s.type || (s.lines ? 'script' : s.q_en ? 'question' : s.groups ? 'chips' : 'pairs');

    if (type === 'script') {
      const lines = (s.lines || []).filter(l => l && str_(l.en)).map(l => {
        if (inSource_(l.en, src)) return { spk: str_(l.spk), en: str_(l.en), ko: str_(l.ko) };
        flags.push(`${tag} 대본에 없는 줄을 자리표시자로 바꿨습니다: "${str_(l.en).slice(0, 60)}"`);
        return { spk: str_(l.spk), en: NEED + ' 대본에서 이 줄을 확인해 주세요.', ko: '' };
      });
      for (let k = 0; k < lines.length; k += 5) out.push(Object.assign({ type: 'script', lines: lines.slice(k, k + 5) }, base));
    } else if (type === 'question') {
      const a = s.answer || {};
      const q = Object.assign({ type: 'question', label: str_(s.label), from_textbook: s.from_textbook === true,
        q_en: str_(s.q_en), q_ko: str_(s.q_ko), options: (s.options || []).map(str_).filter(Boolean).slice(0, 4),
        answer_en: str_(a.answer_en), why_ko: str_(a.why_ko), evidence: str_(a.evidence) }, base);
      if (!q.q_en) return;
      if (q.from_textbook && !inSource_(q.q_en, src)) {
        q.from_textbook = false;
        flags.push(`${tag} 교재 문항이라고 했지만 원문에 없는 문항 → '생각해 보기' 질문으로 표시: "${q.q_en.slice(0, 60)}"`);
      }
      const sample = /^sample\b/i.test(q.answer_en);
      const need = q.answer_en.indexOf(NEED) > -1 || !q.answer_en;
      if (!sample && !need && !inSource_(q.evidence, src)) {
        flags.push(`${tag} 원문에서 근거를 찾지 못한 정답을 자리표시자로 바꿨습니다: "${q.q_en.slice(0, 50)}" → ${q.answer_en.slice(0, 40)}`);
        q.answer_en = NEED; q.evidence = '';
      } else if (need) {
        q.answer_en = NEED;
        flags.push(`${tag} 정답 원문이 필요합니다: "${q.q_en.slice(0, 60)}"`);
      }
      out.push(q);
    } else if (type === 'chips') {
      const groups = (s.groups || []).map(g => ({ label: str_(g && g.label),
        items: ((g && g.items) || []).map(str_).filter(x => found_(x, src)).slice(0, 3) }))
        .filter(g => g.items.length).slice(0, 3);
      if (groups.length) out.push(Object.assign({ type: 'chips', groups }, base));
    } else {
      const pairs = (s.pairs || []).map(pair_).filter(Boolean);
      const key = pair_(s.key);
      const focus = s.focus && str_(s.focus.big) ? { label: str_(s.focus.label), big: str_(s.focus.big), ko: str_(s.focus.ko) } : null;
      if (pairs.length || key) out.push(Object.assign({ type: 'pairs', pairs, key, focus }, base));
    }
  });
  if (!out.length) throw new Error(`${sec.name_en} 섹션 내용을 받지 못했습니다. [이 단계 다시]를 눌러 주세요.`);
  return out;
}
