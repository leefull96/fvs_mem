// ① Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 에서 복사한 값으로 교체하세요.
export const firebaseConfig = {
  apiKey: "여기에_apiKey",
  authDomain: "여기에_프로젝트ID.firebaseapp.com",
  projectId: "여기에_프로젝트ID",
  storageBucket: "여기에_프로젝트ID.firebasestorage.app",
  messagingSenderId: "여기에_숫자",
  appId: "여기에_appId"
};

// ② 영업사원 '아이디'를 내부적으로 이메일 형태로 바꿀 때 쓰는 뒷부분입니다.
//    실제 메일은 발송되지 않습니다. 한 번 정하면 바꾸지 마세요.
export const EMAIL_DOMAIN = "fvs-sales.com";

// ③ 입력창 선택지 (엑셀 시트의 드롭다운과 동일). 필요하면 여기만 고치면 됩니다.
export const OPTIONS = {
  dbSource: ["강남개미","주식백서","개인","여의도","급등","주식차트분석","퍼미션","이순신","차프로"],
  status: ["실시간","구디비"],
  contractType: ["신규"],
  grades: ["실버","골드","다이아","밸류업"]
};
