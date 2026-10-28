# 설치 가이드 (처음 한 번만, 약 20분)

파일 4개: `index.html`, `app.js`, `firebase-config.js`, `firestore.rules`

## 1. Firebase 프로젝트 만들기 (무료 Spark 요금제)
1. https://console.firebase.google.com 접속 → **프로젝트 추가** (Google Analytics는 꺼도 됩니다).
2. 왼쪽 **빌드 > Authentication > 시작하기 > 로그인 방법 > 이메일/비밀번호** 사용 설정 (아래쪽 '이메일 링크'는 켜지 않음).
3. **빌드 > Firestore Database > 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**로 시작.
4. Firestore **규칙** 탭에 `firestore.rules` 내용을 통째로 붙여넣고 **게시**.
5. 프로젝트 설정(톱니바퀴) > **내 앱 > 웹(</>) 앱 추가** → 나오는 `firebaseConfig` 값을 `firebase-config.js`에 붙여넣기.
   * 카드 등록을 요구하는 화면(Blaze 업그레이드)은 누르지 마세요. 누르지 않으면 요금이 나올 수 없습니다.

## 2. 첫 관리자 계정 만들기 (콘솔에서 딱 한 번)
1. **Authentication > 사용자 > 사용자 추가**
   * 이메일: `admin@fvs-sales.com` (아이디가 `admin`이 됩니다. `firebase-config.js`의 EMAIL_DOMAIN을 바꿨다면 그 값에 맞추세요)
   * 비밀번호: 원하는 값(6자 이상)
2. 만들어진 사용자의 **사용자 UID**를 복사.
3. **Firestore Database > 데이터 > 컬렉션 시작** → 컬렉션 ID `users` → 문서 ID에 위의 UID 붙여넣기 → 필드 4개 추가:
   * `loginId` (string) = `admin`
   * `name` (string) = 관리자 이름
   * `role` (string) = `admin`
   * `active` (boolean) = `true`
4. 이후 영업사원 계정은 사이트의 **사원 관리** 탭에서 발급합니다.

## 3. GitHub Pages로 배포
1. GitHub에서 새 저장소 생성 (Public) → 네 파일 업로드 (`index.html`이 최상위에 있어야 함).
2. 저장소 **Settings > Pages > Branch: main / (root) > Save**.
3. 1~2분 뒤 `https://내아이디.github.io/저장소이름/` 에서 접속.
4. Firebase 콘솔 **Authentication > 설정 > 승인된 도메인**에 `내아이디.github.io` 추가.

## 4. 알아둘 점
* Pages 저장소가 공개라서 `firebaseConfig`도 공개되지만, 이 값은 비밀키가 아니라 식별용입니다. 실제 보호는 `firestore.rules`가 합니다 (사원은 본인 건만, 관리자는 전체).
* 무료 한도(Spark, 일 기준): 읽기 5만 / 쓰기 2만 / 저장 1GiB. 사원 수십 명 규모에는 충분합니다. 한도를 넘으면 과금 대신 그날 일시 차단됩니다.
* 비밀번호를 잊은 사원은 새 아이디를 발급하고 기존 계정은 '사용 중지' 하세요. (이메일이 실제가 아니라 재설정 메일이 갈 수 없습니다.)
* 데이터 백업: 관리자 화면의 **엑셀(CSV) 저장**을 월 1회 받아 두세요.
* 입력창 선택지(DB 출처·등급 등)는 `firebase-config.js`의 OPTIONS에서 수정합니다.
