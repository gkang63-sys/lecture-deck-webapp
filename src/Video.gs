/**
 * 섹션 요약 영상 자동 제작 — Claude 작업의 '섹션 복습 영상'을 구글 웹앱으로
 *
 * 서버(Apps Script)에는 영상 편집 도구가 없으므로 영상은 브라우저가 만든다.
 *  1 step_videoPlan   제미나이가 섹션마다 복습 대본(장면 4–6개, 영어 + 한국어 자막)을 쓴다 — 덱 내용만 근거
 *  2 step_videoAudio  장면 영어를 제미나이 음성으로 읽힌다 (무료 사용량이 찼으면 소리 없이 자막 영상)
 *  3 화면(Index.html)이 캔버스에 장면을 그리며 음성과 함께 녹화 → .webm
 *  4 step_videoSave   올린 영상을 결과 폴더/영상/에 두고 그 섹션의 복습 영상으로 지정 → 조립부터 다시 하면 섹션 끝에 들어간다
 */

function step_videoPlan(folderId) {
  const st = loadState_(folderId);
  const secs = st.outline.sections.map((sec, i) => {
    const slides = st.deck.filter(s => s.sec === sec.name_en && s.kind !== 'divider' && s.kind !== 'page' && s.kind !== 'video');
    const lines = [];
    slides.forEach(s => {
      if (s.kind === 'answer') lines.push(`Q: ${s.q_en} → A: ${s.answer_en}${s.why_ko ? ' (' + s.why_ko + ')' : ''}`);
      else if (s.kind === 'pairs') { if (s.key) lines.push(s.key.en); (s.pairs || []).slice(0, 2).forEach(p => lines.push(p.en)); }
      else if (s.kind === 'chips') lines.push('Expressions: ' + s.groups.map(g => g.items.join(', ')).join(' / '));
      else if (s.kind === 'listen' || s.kind === 'question') { /* 문항은 정답 장에서 함께 */ }
      else if (s.title_en) lines.push(s.title_en);
    });
    return `[섹션 ${i + 1}] ${sec.name_en} (${sec.name_ko})\n` + lines.slice(0, 40).map(l => '- ' + l).join('\n');
  }).join('\n\n');
  const prompt = [
    '당신은 제주대학교 교양영어 강사입니다. 아래는 이번 차시 강의 덱의 섹션별 내용입니다.',
    '섹션마다 학생이 섹션을 다 푼 뒤 보는 "복습 영상" 대본을 쓰세요. 교수 한 사람이 말하는 목소리입니다.',
    '',
    `[덱] ${st.outline.title_en} — ${st.outline.title_ko} · ${COURSES[st.input.course].name} Week ${st.input.week}-${st.input.session}`,
    secs,
    '',
    '규칙:',
    '- 섹션마다 장면 4–6개. 장면마다 영어 1–2문장(쉬운 구어체, 20단어 안팎)과 한국어 자막(그 영어의 충실한 번역).',
    '- 첫 장면은 무엇을 했는지, 가운데 장면은 핵심과 정답 정리, 마지막 장면은 한 문장 정리.',
    '- 위 내용에 없는 사실·정답·예문을 지어내지 않습니다.',
    '- 각 장면에 화면에 크게 띄울 키워드 하나(key, 3단어 이내)를 붙입니다.',
    '',
    '다음 JSON으로만 답하세요:',
    '{"sections": [{"title_en": "...", "title_ko": "...", "scenes": [{"key": "...", "en": "...", "ko": "..."}]}]}',
  ].join('\n');
  const res = geminiJson_(prompt, folderId, '영상대본');
  const plan = (res.json.sections || []).slice(0, st.outline.sections.length).map((s, i) => ({
    name: st.outline.sections[i].name_en,
    title_en: str_(s.title_en) || st.outline.sections[i].name_en, title_ko: str_(s.title_ko) || st.outline.sections[i].name_ko,
    scenes: (s.scenes || []).filter(x => x && str_(x.en)).slice(0, 6).map(x => ({ key: str_(x.key), en: str_(x.en), ko: str_(x.ko) })),
  })).filter(s => s.scenes.length);
  savePart_(folderId, '영상대본.json', { plan, model: res.model });
  const c = ctx_(st);
  return { plan, course: c.name, week: c.week, foot: c.foot, brand: c.brand, deep: c.deep, soft: c.soft, line: c.line, model: res.model };
}

/** 섹션 i의 낭독 음성 (WAV base64). 사용량이 찼으면 {silent:true} */
function step_videoAudio(folderId, i) {
  const p = loadPart_(folderId, '영상대본.json');
  const sec = p && p.plan[i];
  if (!sec) throw new Error('영상 대본이 없습니다.');
  const key = 'vid_' + hash_(sec.scenes.map(s => s.en).join(' '));
  let a = loadPart_(folderId, `오디오_${key}.json`);
  if (!a) {
    try {
      const r = callTTS_('Read this short lesson review for university students, warmly and clearly, like a teacher:\n' + sec.scenes.map(s => s.en).join('\n'), []);
      const file = mediaFolder_(folderId).createFile(pcmToWav_(r.data, r.rate, `영상낭독_${i + 1}_${sec.name}.wav`.replace(/[\\/:*?"<>|]/g, '')));
      a = { key, id: file.getId(), secs: r.bytes / (r.rate * 2), name: file.getName() };
      savePart_(folderId, `오디오_${key}.json`, a);
    } catch (e) {
      return { silent: true, reason: e.message };
    }
  }
  const b64 = Utilities.base64Encode(DriveApp.getFileById(a.id).getBlob().getBytes());
  return { silent: false, b64, secs: a.secs };
}

/** 녹화한 영상(finishUpload로 올린 파일)을 결과 폴더/영상/으로 옮기고 섹션 복습 영상으로 지정 */
function step_videoSave(folderId, i, fileId) {
  const st = loadState_(folderId);
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFoldersByName('영상');
  const vf = it.hasNext() ? it.next() : folder.createFolder('영상');
  const f = DriveApp.getFileById(fileId);
  f.moveTo(vf);
  f.setName(`섹션영상_${i + 1}_${st.outline.sections[i].name_en}.webm`.replace(/[\\/:*?"<>|]/g, ''));
  const lines = String(st.input.videoSections || '').split('\n');
  while (lines.length < st.outline.sections.length) lines.push('');
  lines[i] = `https://drive.google.com/file/d/${fileId}/view`;
  st.input.videoSections = lines.join('\n');
  st.input.videos = parseVideos_({ videoOverview: st.input.videoOverview || '', videoSections: st.input.videoSections });
  saveState_(st);
  return { videoSections: st.input.videoSections, url: `https://drive.google.com/file/d/${fileId}/view` };
}
