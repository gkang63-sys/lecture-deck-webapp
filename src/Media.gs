/**
 * 오디오와 영상
 *
 * 영상: 구글 슬라이드는 드라이브 영상·유튜브 영상을 코드로 넣을 수 있다 → 슬라이드 안에서 바로 재생된다.
 *   - 표지 다음 '개요 영상', 섹션 끝 '복습 영상' (복습 영상에는 정답이 들어 있을 수 있어 섹션 끝에 둔다)
 * 오디오: 구글 슬라이드는 코드로 오디오를 끼워 넣는 기능을 열어 두지 않았다 (편집기의 삽입 → 오디오만 가능).
 *   그래서 제미나이 음성(TTS)으로 듣기 대본을 읽힌 파일(.wav)을 드라이브에 만들고,
 *   대본 장·듣기 장에 ▶ 버튼을 둔다. 누르면 드라이브 재생 창이 열린다.
 *   슬라이드 안에서 바로 재생하려면 편집기에서 삽입 → 오디오 → 같은 파일을 고르면 된다 (장 번호가 파일 이름에 있음).
 * 원음이 아니라 합성 음성이므로 슬라이드와 노트에 'TTS 대체 음원'이라고 밝힌다.
 */

const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'];
const VOICES = ['Kore', 'Puck']; // 화자 둘: 여성·남성 느낌의 기본 목소리

// ───────────────────────── 영상 ─────────────────────────

/** 유튜브·드라이브 링크 → {source, id}. 알아볼 수 없으면 null */
function videoRef_(link) {
  link = String(link || '').trim();
  if (!link) return null;
  const yt = link.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  if (yt) return { source: 'YOUTUBE', id: yt[1], link };
  const dr = link.match(/[-\w]{25,}/);
  if (dr && /drive\.google|docs\.google|^[-\w]{25,}$/.test(link)) return { source: 'DRIVE', id: dr[0], link };
  return null;
}

/** 화면의 영상 칸: 개요 영상 하나 + 섹션별 복습 영상 (줄마다, 섹션 순서대로. 빈 줄은 그 섹션 없음) */
function parseVideos_(f) {
  const s = k => String(f[k] == null ? '' : f[k]);
  return {
    overview: videoRef_(s('videoOverview')),
    sections: s('videoSections').split(/\n/).map(videoRef_),
  };
}

// ───────────────────────── 오디오 (제미나이 TTS) ─────────────────────────

/** 대본 줄들에서 화자 이름을 찾는다: "Guide: Good morning…" */
function speakers_(lines) {
  const names = [];
  lines.forEach(l => { const m = String(l).match(/^\s*([A-Z][\w .'-]{0,20}):\s/); if (m && names.indexOf(m[1].trim()) < 0) names.push(m[1].trim()); });
  return names;
}

/**
 * 오디오 할 일 하나를 만든다. text는 "화자: 대사" 줄들.
 * 화자가 정확히 둘이면 두 목소리로, 아니면 한 목소리로 (이름은 읽지 않게 지운다).
 */
function audioJob_(key, title, lines) {
  // "AUDIO SCRIPT 1.04", "Extract 1" 같은 제목 줄은 읽지 않는다
  lines = lines.map(l => String(l).trim()).filter(l => l && !/^(audio\s*script\b|track\b|extract\s*\d+\s*$|\d+\.\d+\s*$)/i.test(l));
  const names = speakers_(lines);
  const multi = names.length === 2;
  const body = multi ? lines.join('\n') : lines.map(l => l.replace(/^\s*[A-Z][\w .'-]{0,20}:\s/, '')).join('\n');
  return { key, title, speakers: multi ? names : [], text: body };
}

/**
 * 긴 대본(강의 4분 등)은 한 번에 읽히면 끝나지 않는다 → 문장 단위로 700자 안팎씩 나눈 할 일들로 만든다.
 * 나눈 조각은 step3_audioMerge가 한 파일로 잇는다.
 */
function splitAudioJob_(key, title, lines) {
  const job = audioJob_(key, title, lines);
  if (job.text.length <= 900) return { jobs: [job], merge: null };
  const sents = job.text.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$|\n/g) || [job.text];
  const chunks = [];
  let cur = '';
  sents.forEach(t => { if ((cur + t).length > 700 && cur.trim()) { chunks.push(cur.trim()); cur = ''; } cur += t; });
  if (cur.trim()) chunks.push(cur.trim());
  // 조각 이름은 글 내용으로 — 나누는 자리가 바뀌면 그 조각만 새로 만든다
  const jobs = chunks.map((t, i) => Object.assign({}, job, { key: `${key}__${hash_(t)}`, title: `${title}_${i + 1}`, text: t }));
  return { jobs, merge: { key, title, parts: jobs.map(j => j.key) } };
}

/** 나눠 만든 조각 음성을 한 WAV로 잇는다 (머리말 54바이트, 조각은 6바이트 단위로 맞춰 base64 글자째로) */
function step3_audioMerge(folderId) {
  const st = loadState_(folderId);
  const merged = [];
  (st.audioMerge || []).forEach(m => {
    if (loadPart_(folderId, `오디오_${m.key}.json`)) return;
    const parts = m.parts.map(k => loadPart_(folderId, `오디오_${k}.json`));
    if (parts.some(p => !p)) return; // 조각이 덜 됐으면 다음에
    let b64 = '', bytes = 0, rate = 24000;
    parts.forEach(p => {
      const all = Utilities.base64Encode(DriveApp.getFileById(p.id).getBlob().getBytes());
      const pcmLen = Math.floor(all.length / 4) * 3 - 54 - (all.endsWith('==') ? 2 : all.endsWith('=') ? 1 : 0);
      const keep = pcmLen - (pcmLen % 6); // 3의 배수이면서 샘플(2바이트) 단위
      b64 += all.substr(72, keep / 3 * 4);
      bytes += keep;
    });
    const name = `${m.title}.wav`;
    const file = mediaFolder_(folderId).createFile(pcmToWav_(b64, rate, name));
    const info = { key: m.key, id: file.getId(), url: `https://drive.google.com/file/d/${file.getId()}/view`,
      secs: Math.round(bytes / (rate * 2)), name, model: '조각 ' + parts.length + '개 이음' };
    savePart_(folderId, `오디오_${m.key}.json`, info);
    merged.push(info);
  });
  return { merged: merged.length };
}

/** 선생님이 준 음원(드라이브 링크)을 'full' 자리에 쓴다 — 합성 음성보다 우선 */
function linkOwnAudio_(folderId, link) {
  const id = (String(link || '').match(/[-\w]{25,}/) || [])[0];
  if (!id) return null;
  const f = DriveApp.getFileById(id);
  const info = { key: 'full', id, url: `https://drive.google.com/file/d/${id}/view`, secs: 0, name: f.getName(), model: '선생님 음원', own: true };
  savePart_(folderId, '오디오_full.json', info);
  return info;
}

function step3_audio(folderId, k) {
  const st = loadState_(folderId);
  const job = st.audioJobs[k];
  if (!job) return { skipped: true };
  const done = loadPart_(folderId, `오디오_${job.key}.json`);
  if (done) return Object.assign({ reused: true }, done); // 같은 글은 이미 만들었음
  const prompt = (job.speakers.length === 2
    ? `Read this English listening script for university students as a natural conversation between ${job.speakers[0]} and ${job.speakers[1]}, at a clear, moderate pace:\n`
    : 'Read this English listening script for university students in a clear, natural voice at a moderate pace:\n') + job.text;
  const r = callTTS_(prompt, job.speakers);
  const name = `${job.title}.wav`.replace(/[\\/:*?"<>|]/g, '');
  const file = mediaFolder_(folderId).createFile(pcmToWav_(r.data, r.rate, name));
  const info = { key: job.key, id: file.getId(), url: `https://drive.google.com/file/d/${file.getId()}/view`,
    secs: Math.round(r.bytes / (r.rate * 2)), name, model: r.model };
  savePart_(folderId, `오디오_${job.key}.json`, info);
  return info;
}

function callTTS_(prompt, speakers) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const speechConfig = speakers && speakers.length === 2
    ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map((s, i) => ({ speaker: s, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[i] } } })) } }
    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[0] } } };
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig },
  });
  const started = Date.now();
  let lastError = '';
  for (const model of TTS_MODELS) {
    for (const wait of [0, 6000, 15000]) {
      if (Date.now() - started + wait > 270 * 1000) break;
      if (wait) Utilities.sleep(wait);
      const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload, muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      let data = {};
      try { data = JSON.parse(res.getContentText()); } catch (e) { /* 오류 페이지 */ }
      const part = code === 200 && data.candidates && data.candidates[0].content
        ? (data.candidates[0].content.parts || []).filter(p => p.inlineData || p.inline_data)[0] : null;
      if (part) {
        const inl = part.inlineData || part.inline_data;
        const rate = parseInt((String(inl.mimeType || inl.mime_type || '').match(/rate=(\d+)/) || [])[1], 10) || 24000;
        const b64 = inl.data;
        const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
        return { data: b64, rate, bytes, model };
      }
      lastError = `[${model}] ` + ((data.error && data.error.message) || ('HTTP ' + code));
      if (code === 401 || code === 403) throw new Error(lastError);
      if (code !== 429 && code !== 503 && code !== 500) break;
    }
  }
  throw new Error('음성을 만들지 못했습니다 (무료 사용량이 찼거나 서버 혼잡). 덱은 버튼 없이 만들어집니다. ' + lastError);
}

/**
 * 제미나이가 주는 소리(PCM 16비트, 한 채널)에 WAV 머리말을 붙인다.
 * 큰 배열을 이어 붙이지 않으려고 머리말을 54바이트(3의 배수)로 맞춰 base64 글자째로 잇는다.
 */
function pcmToWav_(b64, rate, name) {
  const n = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  const h = [];
  const str = s => s.split('').forEach(c => h.push(c.charCodeAt(0)));
  const u32 = v => h.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const u16 = v => h.push(v & 255, (v >> 8) & 255);
  str('RIFF'); u32(46 + n); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
  str('JUNK'); u32(2); u16(0);          // 머리말을 54바이트로 맞추는 빈 덩어리
  str('data'); u32(n);
  const head = Utilities.base64Encode(h.map(b => (b > 127 ? b - 256 : b)));
  return Utilities.newBlob(Utilities.base64Decode(head + b64), 'audio/wav', name);
}

function mediaFolder_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const it = folder.getFoldersByName('오디오');
  return it.hasNext() ? it.next() : folder.createFolder('오디오');
}

/** 만들어진 오디오 조각들을 key → {url, secs, name} 으로 */
function audioMap_(folderId, jobs) {
  const map = {};
  (jobs || []).forEach(j => { const p = loadPart_(folderId, `오디오_${j.key}.json`); if (p) map[j.key] = p; });
  return map;
}

function mmss_(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
