// ============================================================
// Code.gs – AI 학생 질문 분류 시스템 (Gemini API 연동)
// ============================================================

const SPREADSHEET_ID = '1C7QvSfXDDxvy_IluJDYqi8WVh4byKmJfzUKJbuj1mIQ';

// API 키는 프로젝트 설정 → 스크립트 속성(GEMINI_API_KEY)에서 읽어옴
function getGeminiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

// ----------------------------------------------------------
// doGet: ?page=student(기본) / ?page=teacher
// ----------------------------------------------------------
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'student';
  if (page === 'teacher') {
    return HtmlService.createHtmlOutputFromFile('teacher')
      .setTitle('교사 대시보드 | AI 질문 분류 시스템')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('student')
    .setTitle('AI 질문 분류기 | 학생 페이지')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ----------------------------------------------------------
// 시트명 생성: "2학년" + "1" → "2-1"
// ----------------------------------------------------------
function buildSheetName_(grade, classNum) {
  const g = String(grade || '').replace('학년', '').trim();
  const c = String(classNum || '').trim();
  return g + '-' + c;
}

// ----------------------------------------------------------
// 학년-반 시트 가져오기 (없으면 자동 생성)
// ----------------------------------------------------------
function getOrCreateClassSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = [
      '타임스탬프', '학년', '반', '번호', '이름',
      '질문내용', '피드백', '질문유형', '등급이름', '이모지', '내부점수', '표시점수'
    ];
    sheet.appendRow(headers);
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#3B4A6B');
    hRange.setFontColor('#FFFFFF');
    hRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(6, 320);
    sheet.setColumnWidth(7, 420);
  }
  return sheet;
}

// ----------------------------------------------------------
// Gemini API 호출: 질문 분류 + 맞춤형 피드백 생성
// 키워드 폴백 없이 API 결과만 사용
// ----------------------------------------------------------
function classifyWithGemini_(question, name) {
  const apiKey = getGeminiKey_();
  if (!apiKey) throw new Error('GEMINI_API_KEY 스크립트 속성이 설정되지 않았습니다.');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;

  const prompt =
    '당신은 학생의 질문 수준을 분석하는 교육 전문가입니다.\n\n' +
    '학생 이름: ' + name + '\n' +
    '학생 질문: "' + question + '"\n\n' +

    '[질문 수준 3단계]\n' +
    '1. factual(병아리): 하나의 정답이 있는 사실 확인 질문. "무엇?", "언제?", "누가?", "어디?" 등\n' +
    '2. conceptual(사춘기닭): 원리·이유·관계·과정을 탐구하는 질문. "왜?", "어떻게?", "차이는?", "원인은?", "어쩌다?", "어떤 과정?" 등\n' +
    '3. debatable(시조새): 정답이 없고 가치 판단·토론이 필요한 질문. "옳은가?", "해야 하는가?", "어떤 것이 더 나은가?" 등\n\n' +

    '[분류 판단 기준 — 반드시 질문의 의미와 맥락을 읽어서 판단할 것]\n' +
    '- 사실 확인(factual): 단순히 "무엇인지", "누구인지", "어디인지"처럼 정해진 답이 있는 경우\n' +
    '- 개념·과정 탐구(conceptual): 인과관계, 변화 과정, 이유, 원리를 묻는 경우. 예) "왜 그렇게 되었을까?", "어쩌다 ~하게 됐을까?", "어떻게 ~할 수 있었을까?" 등 과정·원인을 탐구하는 질문은 conceptual\n' +
    '- 가치 판단·토론(debatable): 옳고 그름, 선택의 정당성, 찬반이 갈리는 경우\n\n' +

    '[분석 요청]\n' +
    '① type: 위 세 수준 중 하나로 분류 (factual / conceptual / debatable)\n' +
    '② feedback: 이 질문이 해당 수준으로 분류된 이유를, 질문의 구체적인 표현·구조·의도를 짚어서 설명 (2~3문장, ' + name + ' 학생에게 직접 말하는 친근한 톤)\n' +
    '③ tips: 이 질문을 한 단계 더 높은 수준으로 바꾸는 방법 설명 (debatable이면 질문을 더 풍부하게 만드는 방법) (2문장)\n' +
    '④ example: ③의 방법을 적용해서 이 질문을 직접 변형한 업그레이드 예시 질문 1개 (질문 형식으로, 짧고 구체적으로)\n\n' +

    '[출력] 아래 JSON만 출력 (다른 텍스트 없이):\n' +
    '{\n' +
    '  "type": "factual" 또는 "conceptual" 또는 "debatable",\n' +
    '  "feedback": "이 질문이 해당 수준인 이유 설명",\n' +
    '  "tips": "업그레이드 방법 설명",\n' +
    '  "example": "변형된 예시 질문"\n' +
    '}';

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 1024
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const resJson = JSON.parse(response.getContentText());
  if (resJson.error) throw new Error('Gemini 오류: ' + resJson.error.message);

  const rawText = resJson.candidates[0].content.parts[0].text;
  Logger.log('Gemini raw: ' + rawText);

  // 첫 번째 { 부터 마지막 } 까지 잘라서 파싱 (마크다운·앞뒤 텍스트 무관)
  const start = rawText.indexOf('{');
  const end   = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini 응답에 JSON이 없습니다: ' + rawText.slice(0, 200));
  }
  const result = JSON.parse(rawText.slice(start, end + 1));

  // type 값이 허용 범위 밖이면 에러 (키워드 폴백 없음)
  if (!['factual', 'conceptual', 'debatable'].includes(result.type)) {
    throw new Error('Gemini가 유효하지 않은 type을 반환했습니다: ' + result.type);
  }

  return result;
}

// ----------------------------------------------------------
// submitQuestion: 학생 질문 제출 → AI 분류 → 시트 저장 → 결과 반환
// ----------------------------------------------------------
function submitQuestion(data) {
  try {
    const name     = String(data.name     || '');
    const question = String(data.question || '');

    // Gemini API로만 분류 — 실패 시 에러 반환 (키워드 폴백 없음)
    let aiResult;
    try {
      aiResult = classifyWithGemini_(question, name);
    } catch (aiErr) {
      Logger.log('Gemini API 실패: ' + aiErr);
      return { success: false, error: 'AI 분류에 실패했습니다. 잠시 후 다시 시도해 주세요.\n(상세: ' + aiErr.message + ')' };
    }

    // 유형별 메타데이터
    const TYPE_META = {
      factual:    { gradeName:'병아리',   emoji:'🐣', displayScore:1, internalBase:100 },
      conceptual: { gradeName:'사춘기닭', emoji:'🐓', displayScore:3, internalBase:300 },
      debatable:  { gradeName:'시조새',   emoji:'🦕', displayScore:5, internalBase:500 }
    };
    const meta = TYPE_META[aiResult.type] || TYPE_META.factual;
    const lenBonus      = Math.min(Math.floor(question.length / 15), 15);
    const internalScore = meta.internalBase + lenBonus;

    // 시트 저장
    const ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetName = buildSheetName_(data.grade, data.classNum);
    const sheet     = getOrCreateClassSheet_(ss, sheetName);

    const feedbackSaved =
      '[' + meta.gradeName + ' 등급] ' + (aiResult.feedback || '') +
      '\n\n💡 개선 팁: ' + (aiResult.tips || '');

    sheet.appendRow([
      new Date(),
      String(data.grade    || ''),
      String(data.classNum || ''),
      String(data.number   || ''),
      name,
      question,
      feedbackSaved,
      aiResult.type || 'factual',
      meta.gradeName,
      meta.emoji,
      internalScore,
      meta.displayScore
    ]);

    // 클라이언트에 결과 반환
    return {
      success:      true,
      type:         aiResult.type    || 'factual',
      gradeName:    meta.gradeName,
      emoji:        meta.emoji,
      displayScore: meta.displayScore,
      feedback:     aiResult.feedback || '',
      tips:         aiResult.tips     || '',
      example:      aiResult.example  || ''
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ----------------------------------------------------------
// getQuestions: 모든 학년-반 시트에서 질문 수집, 점수 내림차순 정렬
// ----------------------------------------------------------
function getQuestions() {
  try {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const tz     = Session.getScriptTimeZone();
    const allQ   = [];

    sheets.forEach(function(sheet) {
      const sName = sheet.getName();
      if (!/^\d+-\d+$/.test(sName)) return;
      if (sheet.getLastRow() <= 1)   return;

      const values = sheet.getDataRange().getValues();
      const rows   = values.slice(1);

      rows.forEach(function(row, idx) {
        if (!row[5]) return;

        let timeStr = '';
        try {
          timeStr = (row[0] instanceof Date)
            ? Utilities.formatDate(row[0], tz, 'M/d HH:mm')
            : String(row[0] || '');
        } catch (_) {}

        allQ.push({
          sheetName:     sName,
          rowNum:        idx + 2,
          timestamp:     timeStr,
          grade:         String(row[1]  || ''),
          classNum:      String(row[2]  || ''),
          number:        String(row[3]  || ''),
          name:          String(row[4]  || ''),
          question:      String(row[5]  || ''),
          feedback:      String(row[6]  || ''),
          type:          String(row[7]  || 'factual'),
          gradeName:     String(row[8]  || '병아리'),
          emoji:         String(row[9]  || '🐣'),
          internalScore: Number(row[10]) || 100,
          displayScore:  Number(row[11]) || 1
        });
      });
    });

    allQ.sort(function(a, b) {
      return b.internalScore !== a.internalScore
        ? b.internalScore - a.internalScore
        : (b.timestamp > a.timestamp ? 1 : -1);
    });

    return { success: true, data: allQ };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ----------------------------------------------------------
// deleteQuestion: 교사 삭제 기능
// ----------------------------------------------------------
function deleteQuestion(sheetName, rowNum) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { success: false, error: '시트를 찾을 수 없습니다: ' + sheetName };
    if (rowNum < 2 || rowNum > sheet.getLastRow()) return { success: false, error: '유효하지 않은 행 번호입니다.' };
    sheet.deleteRow(rowNum);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
