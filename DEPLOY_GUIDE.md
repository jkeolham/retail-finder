# 📱 다이소 올영 상품 찾기 - GitHub Pages 1분 무료 배포 가이드

본 웹앱은 별도의 백엔드 서버 없이 브라우저에서 직접 실시간 재고를 조회하므로, **GitHub Pages에 정적 파일만 올리면 100% 무료로 24시간 운영**됩니다.

---

## 🚀 배포 순서 (초간단 3단계)

### 1단계: GitHub 새 저장소(Repository) 생성
1. [GitHub](https://github.com)에 로그인합니다.
2. 우상단 `+` 버튼 ➔ **`New repository`**를 클릭합니다.
3. 저장소 설정:
   - **Repository name**: `retail-finder` (또는 원하는 이름)
   - **Public** 선택 (GitHub Pages 무료 사용을 위해 Public 선택 필요)
   - `Add a README file` 체크 해제
4. **`Create repository`** 버튼을 클릭합니다.

---

### 2단계: 파일 업로드 및 푸시
터미널에서 아래 명령어를 순서대로 실행하거나, GitHub 웹 페이지에서 파일을 드래그 앤 드롭으로 업로드합니다.

```bash
# 로컬 PWA 디렉터리로 이동
cd ~/.gemini/antigravity-cli/scratch/retail-pwa

# Git 초기화 및 커밋
git init
git add .
git commit -m "Initial commit: 우리집 재고 찾기 PWA"
git branch -M main

# 본인의 GitHub 저장소 주소로 원격 추가 (본인 아이디로 변경)
git remote add origin https://github.com/<본인-GitHub-아이디>/retail-finder.git
git push -u origin main
```

---

### 3단계: GitHub Pages 켜기
1. 방금 생성한 GitHub 저장소 페이지의 상단 메뉴에서 **`Settings`** (설정) 탭을 클릭합니다.
2. 좌측 사이드바 메뉴에서 **`Pages`**를 클릭합니다.
3. **Build and deployment** 항목의 **Branch** 설정을 다음과 같이 변경합니다:
   - `None` ➔ **`main`** 선택
   - 폴더: **`/(root)`** 유지
4. **`Save`** (저장) 버튼을 클릭합니다.
5. 약 1분 후 상단에 배포 완료 주소가 표시됩니다:
   - 👉 **`https://<본인-GitHub-아이디>.github.io/retail-finder/`**

---

## 👨‍👩‍👧‍👦 가족 사용 안내 (스마트폰 앱 추가)

가족 단톡방에 배포된 URL(`https://<아이디>.github.io/retail-finder/`)을 공유합니다.

1. **가족 인증 (최초 1회)**:
   - 첫 접속 시 4자리 PIN 번호 입력창이 뜹니다.
   - 기본 비밀번호: **`1234`** (우상단 ⚙️ 설정에서 변경 가능)
   - 한 번 입력하면 다음부터는 비밀번호 없이 바로 열립니다.

2. **아이폰(iOS) 사용 가족 (2명)**:
   - Safari 브라우저로 접속
   - 하단 가운데 **[공유 버튼 (네모에 위 화살표 ↑)]** 터치
   - 메뉴를 아래로 내려 **`[홈 화면에 추가]`** 터치
   - 스마트폰 바탕화면에 앱 아이콘 생성 완료!

3. **안드로이드(갤럭시 등) 사용 가족 (2명)**:
   - Chrome 브라우저로 접속
   - 우측 상단 메뉴(점 3개 ⋮) 터치
   - **`[앱 설치]`** 또는 **`[홈 화면에 추가]`** 터치
   - 스마트폰 바탕화면에 앱 아이콘 생성 완료!
