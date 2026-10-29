export const firebaseConfig = {
  apiKey: "AIzaSyA4R211WxZSMDdY7O0PeOFAg3eEYvfYXmk",
  authDomain: "fvs-mem.firebaseapp.com",
  projectId: "fvs-mem",
  storageBucket: "fvs-mem.firebasestorage.app",
  messagingSenderId: "400912934541",
  appId: "1:400912934541:web:2975a7d78fb52bbb14a4c4"
};

export const EMAIL_DOMAIN = "fvs-sales.com";

// 입력창 선택지 (DB 출처는 '슈퍼 관리자 > DB 출처 설정' 화면에서 관리합니다)
export const OPTIONS = {
  status: ["실시간", "구디비"],
  contractType: ["신규", "업셀"],
  grades: ["실버", "골드", "다이아", "밸류업"]
};

// DB 출처 설정을 아직 저장하지 않았을 때 쓰는 기본값
export const DEFAULT_DB = {
  realtime: ["급등", "퍼미션", "젠서버"],
  old: ["강남개미", "주식백서", "개인", "여의도", "급등", "주식차트분석", "퍼미션", "이순신", "차프로", "젠서버"]
};
