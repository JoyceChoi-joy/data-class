// ============================================================
// Code.gs – AI 학생 질문 분류 시스템 (Google Apps Script)
// ============================================================

const SPREADSHEET_ID = '1C7QvSfXDDxvy_IluJDYqi8WVh4byKmJfzUKJbuj1mIQ';

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
    sheet.setColumnWidth(1, 140);  // 타임스탬프
    sheet.setColumnWidth(6, 320);  // 질문내용
    sheet.setColumnWidth(7, 420);  // 피드백
  }
  return sheet;
}

// ----------------------------------------------------------
// saveQuestion: 학생이 질문 제출 시 해당 학년-반 시트에 저장
// ----------------------------------------------------------
function saveQuestion(data) {
  try {
    const ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetName = buildSheetName_(data.grade, data.classNum);
    const sheet     = getOrCreateClassSheet_(ss, sheetName);

    // 피드백 + 개선 팁 합쳐서 저장
    const feedbackText =
      '[' + (data.gradeName || '') + ' 등급] ' + (data.feedbackMsg || '') +
      '\n\n💡 개선 팁: ' + (data.tipsMsg || '');

    sheet.appendRow([
      new Date(),
      String(data.grade         || ''),
      String(data.classNum      || ''),
      String(data.number        || ''),
      String(data.name          || ''),
      String(data.question      || ''),
      feedbackText,
      String(data.type          || 'factual'),
      String(data.gradeName     || '병아리'),
      String(data.emoji         || '🐣'),
      Number(data.internalScore || 100),
      Number(data.displayScore  || 1)
    ]);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// ----------------------------------------------------------
// getQuestions: 모든 학년-반 시트에서 질문 수집, 점수 내림차순 정렬
//   반환값에 sheetName + rowNum 포함 (삭제에 사용)
// ----------------------------------------------------------
function getQuestions() {
  try {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    const tz     = Session.getScriptTimeZone();
    const allQ   = [];

    sheets.forEach(function(sheet) {
      const sName = sheet.getName();
      // "숫자-숫자" 형식의 시트만 처리 (예: 2-1, 3-4)
      if (!/^\d+-\d+$/.test(sName)) return;
      if (sheet.getLastRow() <= 1) return;

      const values = sheet.getDataRange().getValues();
      const rows   = values.slice(1); // 헤더 제외

      rows.forEach(function(row, idx) {
        if (!row[5]) return; // 질문 내용 없는 행 제외

        let timeStr = '';
        try {
          timeStr = (row[0] instanceof Date)
            ? Utilities.formatDate(row[0], tz, 'M/d HH:mm')
            : String(row[0] || '');
        } catch (_) {}

        allQ.push({
          sheetName:     sName,
          rowNum:        idx + 2, // 실제 시트 행 번호 (헤더=1행, 데이터 시작=2행)
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

    // 내부 점수 내림차순, 동점이면 최신 순
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
// deleteQuestion: 교사가 특정 질문 삭제
// ----------------------------------------------------------
function deleteQuestion(sheetName, rowNum) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { success: false, error: '시트를 찾을 수 없습니다: ' + sheetName };
    }
    if (rowNum < 2 || rowNum > sheet.getLastRow()) {
      return { success: false, error: '유효하지 않은 행 번호입니다.' };
    }
    sheet.deleteRow(rowNum);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
