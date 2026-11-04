/**
 * app.js - 우리집 재고 찾기 (다이소 & 올리브영 PWA)
 * - 브라우저에서 직접 원격 MCP (https://mcp.aka.page/mcp) 통신
 * - CORS 완벽 지원 및 모바일 최적화
 */

const MCP_ENDPOINT = 'https://mcp.aka.page/mcp';
const DEFAULT_PIN = '1234';

// ----------------- MCP Client -----------------
class McpClient {
  constructor(endpoint = MCP_ENDPOINT) {
    this.endpoint = endpoint;
    this.sessionId = null;
    this.requestId = 0;
  }

  async initSession() {
    this.requestId++;
    const payload = {
      jsonrpc: '2.0',
      id: this.requestId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'retail-pwa-web', version: '1.0.0' }
      }
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`MCP 세션 연결 실패 (HTTP ${res.status})`);
    }

    this.sessionId = res.headers.get('mcp-session-id');
    return this.sessionId;
  }

  async callTool(name, args) {
    if (!this.sessionId) {
      await this.initSession();
    }

    this.requestId++;
    const payload = {
      jsonrpc: '2.0',
      id: this.requestId,
      method: 'tools/call',
      params: { name, arguments: args }
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    let res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    // 세션 만료 시 1회 재초기화
    if (res.status === 400) {
      await this.initSession();
      headers['mcp-session-id'] = this.sessionId;
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      throw new Error(`도구 실행 오류 (HTTP ${res.status})`);
    }

    const rawText = await res.text();
    const lines = rawText.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('data: ')) {
        const dataJson = JSON.parse(line.substring(6));
        if (dataJson.error) {
          throw new Error(dataJson.error.message || 'MCP Tool 오류');
        }
        const result = dataJson.result || {};
        if (result.structuredContent) {
          return result.structuredContent;
        }
        if (result.content && result.content[0]?.type === 'text') {
          try {
            return JSON.parse(result.content[0].text);
          } catch (e) {
            return { text: result.content[0].text };
          }
        }
        return result;
      }
    }
    return {};
  }
}

const mcp = new McpClient();

// ----------------- State -----------------
const state = {
  currentTab: 'all', // 'all', 'daiso', 'oliveyoung'
  currentQuery: '',
  currentLocation: '',
  geoCoords: null, // { lat, lng }
  recentSearches: JSON.parse(localStorage.getItem('recent_searches') || '[]')
};

// ----------------- DOM Elements -----------------
const pinModal = document.getElementById('pin-modal');
const pinInput = document.getElementById('pin-input');
const pinSubmitBtn = document.getElementById('pin-submit-btn');
const pinError = document.getElementById('pin-error');

const searchForm = document.getElementById('search-form');
const queryInput = document.getElementById('query-input');
const locationInput = document.getElementById('location-input');
const gpsBtn = document.getElementById('gps-btn');
const gpsStatus = document.getElementById('gps-status');

const tabButtons = document.querySelectorAll('.tab-chip');

const loadingEl = document.getElementById('loading-indicator');
const resultsContainer = document.getElementById('results-container');
const emptyState = document.getElementById('empty-state');
const recentSearchesContainer = document.getElementById('recent-searches');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const newPinInput = document.getElementById('new-pin-input');
const savePinBtn = document.getElementById('save-pin-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');

// Map Picker Modal Elements
const mapPickerBtn = document.getElementById('map-picker-btn');
const mapModal = document.getElementById('map-modal');
const closeMapBtn = document.getElementById('close-map-btn');
const mapMyGpsBtn = document.getElementById('map-my-gps-btn');
const confirmMapBtn = document.getElementById('confirm-map-btn');
const mapAddressDisplay = document.getElementById('map-address-display');

// ----------------- PIN Auth -----------------
function checkAuth() {
  const isAuth = localStorage.getItem('family_authenticated') === 'true';
  if (!isAuth) {
    pinModal.classList.remove('hidden');
    pinInput.focus();
  } else {
    pinModal.classList.add('hidden');
  }
}

pinSubmitBtn.addEventListener('click', () => {
  const currentSavedPin = localStorage.getItem('family_pin') || DEFAULT_PIN;
  if (pinInput.value === currentSavedPin) {
    localStorage.setItem('family_authenticated', 'true');
    pinModal.classList.add('hidden');
    pinError.classList.add('hidden');
  } else {
    pinError.classList.remove('hidden');
    pinInput.value = '';
    pinInput.focus();
  }
});

pinInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') pinSubmitBtn.click();
});

// Settings Modal
settingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});
closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});
savePinBtn.addEventListener('click', () => {
  const newPin = newPinInput.value.trim();
  if (newPin.length >= 4) {
    localStorage.setItem('family_pin', newPin);
    alert('가족 PIN 번호가 변경되었습니다.');
    settingsModal.classList.add('hidden');
    newPinInput.value = '';
  } else {
    alert('PIN 번호는 4자리 이상이어야 합니다.');
  }
});

// ----------------- Tabs -----------------
function setTab(tab) {
  state.currentTab = tab;
  tabButtons.forEach((btn) => {
    if (btn.dataset.tab === tab) {
      btn.className = 'tab-chip px-3 py-1.5 rounded-xl bg-blue-600 text-white shadow-sm shrink-0 transition';
    } else {
      btn.className = 'tab-chip px-3 py-1.5 rounded-xl bg-white text-gray-600 border border-gray-200 shrink-0 hover:bg-gray-50 transition';
    }
  });

  filterSections(tab);
}

function filterSections(tab) {
  const allSections = document.querySelectorAll('.result-section');
  if (!allSections.length) return;

  allSections.forEach((sec) => {
    const secType = sec.dataset.service;
    const isCvs = ['gs25', 'cu', 'seveneleven', 'emart24'].includes(secType);

    if (tab === 'all') {
      sec.style.display = 'block';
    } else if (tab === 'cvs') {
      sec.style.display = isCvs ? 'block' : 'none';
    } else {
      sec.style.display = secType === tab ? 'block' : 'none';
    }
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setTab(btn.dataset.tab);
  });
});

// ----------------- Reverse Geocoding (좌표 ➔ 동 이름 정밀 변환) -----------------
async function getDongFromCoordinates(lat, lng) {
  // 1순위: OpenStreetMap Nominatim 역지오코딩 (format=jsonv2 필수: CORS Access-Control-Allow-Origin 보장)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};

      // 한국 행정구역 특화 추출 (법정동 -> 행정동 -> 마을)
      const dong = addr.quarter || addr.suburb || addr.neighbourhood || addr.village || '';
      const borough = addr.borough || addr.district || '';
      const city = addr.city || addr.town || addr.county || '';

      if (dong && (borough || city)) {
        const region = borough || city;
        return `${dong} (${region})`;
      }
      if (dong) return dong;
      if (borough && city) return `${borough} (${city})`;
      if (city) return city;
    }
  } catch (e) {
    console.warn('Nominatim 역지오코딩 실패, 좌표 범위 룩업으로 폴백:', e);
  }

  // 2순위: 대표 좌표 범위 기반 도시/구 안전 룩업 (하드코딩 오표출 원천 차단)
  if (lat >= 37.41 && lat <= 37.46 && lng >= 126.97 && lng <= 127.02) return '중앙동 (과천시)';
  if (lat >= 37.48 && lat <= 37.52 && lng >= 127.01 && lng <= 127.06) return '역삼동 (강남구)';
  if (lat >= 37.38 && lat <= 37.42 && lng >= 127.09 && lng <= 127.13) return '백현동 (성남시 분당구)';
  if (lat >= 37.38 && lat <= 37.41 && lng >= 126.94 && lng <= 126.97) return '범계동 (안양시 동안구)';
  if (lat >= 37.54 && lat <= 37.57 && lng >= 126.91 && lng <= 126.95) return '서교동 (마포구)';
  if (lat >= 37.50 && lat <= 37.53 && lng >= 127.08 && lng <= 127.12) return '잠실동 (송파구)';

  // 3순위: 기타 지역 일반 표기
  return `${lat.toFixed(3)}, ${lng.toFixed(3)} 인근`;
}

// ----------------- Geolocation (GPS 내 위치) -----------------
gpsBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('사용 중인 브라우저에서 위치 서비스를 지원하지 않습니다.');
    return;
  }
  locationInput.value = '동네 확인 중...';
  gpsStatus.textContent = '📍 GPS 확인 중...';
  gpsBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      state.geoCoords = { lat, lng };

      const dong = await getDongFromCoordinates(lat, lng);
      locationInput.value = dong;
      state.currentLocation = dong;
      gpsStatus.textContent = `📍 ${dong.split(' ')[0]}`;
      gpsBtn.disabled = false;
    },
    (err) => {
      alert('위치 권한을 허용해주세요: ' + err.message);
      locationInput.value = '';
      gpsStatus.textContent = '';
      gpsBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ----------------- Map Picker (Leaflet 지도 선택) -----------------
let leafletMap = null;
let mapSelectedCoords = null;
let mapSelectedDong = '';
let mapDebounceTimer = null;

function openMapPicker() {
  mapModal.classList.remove('hidden');

  const defaultLat = state.geoCoords?.lat || 37.4283;
  const defaultLng = state.geoCoords?.lng || 126.9910; // 기본 과천
  mapSelectedCoords = { lat: defaultLat, lng: defaultLng };

  if (!leafletMap) {
    leafletMap = L.map('map-view', { zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(leafletMap);

    // 지도 이동 시 중심 좌표 역지오코딩
    leafletMap.on('moveend', () => {
      clearTimeout(mapDebounceTimer);
      mapDebounceTimer = setTimeout(async () => {
        const center = leafletMap.getCenter();
        mapSelectedCoords = { lat: center.lat, lng: center.lng };
        mapAddressDisplay.textContent = '동네 확인 중...';
        const dong = await getDongFromCoordinates(center.lat, center.lng);
        mapSelectedDong = dong;
        mapAddressDisplay.textContent = dong;
      }, 300);
    });
  }

  leafletMap.setView([defaultLat, defaultLng], 15);
  mapAddressDisplay.textContent = '동네 확인 중...';

  setTimeout(async () => {
    leafletMap.invalidateSize();
    const dong = await getDongFromCoordinates(defaultLat, defaultLng);
    mapSelectedDong = dong;
    mapAddressDisplay.textContent = dong;
  }, 200);
}

mapPickerBtn.addEventListener('click', openMapPicker);
closeMapBtn.addEventListener('click', () => mapModal.classList.add('hidden'));

// 지도 모달 내 [내 GPS] 이동 버튼
mapMyGpsBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('위치 서비스를 지원하지 않습니다.');
    return;
  }
  mapAddressDisplay.textContent = 'GPS 위치 찾는 중...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 16);
    },
    (err) => alert('위치 권한을 확인해주세요: ' + err.message)
  );
});

// 지도 모달 [이 동네로 선택하기]
confirmMapBtn.addEventListener('click', () => {
  if (mapSelectedDong) {
    locationInput.value = mapSelectedDong;
    state.geoCoords = mapSelectedCoords;
    state.currentLocation = mapSelectedDong;
    gpsStatus.textContent = '🗺️ ' + mapSelectedDong.split(' ')[0];
    mapModal.classList.add('hidden');
  } else {
    alert('지도를 움직여 위치를 선택해주세요.');
  }
});

// ----------------- Geocoding & Distance Utilities -----------------
async function getCoordinatesFromText(queryText) {
  if (!queryText) return null;
  const clean = queryText.replace(/\(.*\)/, '').trim();
  if (!clean) return null;

  const quickMap = {
    '과천': { lat: 37.4283, lng: 126.9910 },
    '중앙동': { lat: 37.4292, lng: 126.9876 },
    '별양동': { lat: 37.4262, lng: 126.9918 },
    '원문동': { lat: 37.4215, lng: 126.9930 },
    '갈현동': { lat: 37.4168, lng: 126.9821 },
    '문원동': { lat: 37.4182, lng: 126.9975 },
    '부림동': { lat: 37.4362, lng: 126.9972 },
    '과천동': { lat: 37.4475, lng: 127.0094 },
    '강남': { lat: 37.4979, lng: 127.0276 },
    '역삼동': { lat: 37.5006, lng: 127.0364 },
    '판교': { lat: 37.3947, lng: 127.1112 },
    '분당': { lat: 37.3827, lng: 127.1189 },
    '안양': { lat: 37.3943, lng: 126.9568 },
    '평촌': { lat: 37.3940, lng: 126.9639 },
    '범계': { lat: 37.3898, lng: 126.9507 },
    '인덕원': { lat: 37.4018, lng: 126.9768 },
    '사당': { lat: 37.4765, lng: 126.9816 }
  };

  for (const [key, coords] of Object.entries(quickMap)) {
    if (clean.includes(key)) return coords;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&limit=1&q=${encodeURIComponent(clean)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }
    }
  } catch (e) {
    console.warn('정방향 지오코딩 실패:', e);
  }
  return null;
}

function computeHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function isValidCoords(lat, lng) {
  if (lat == null || lng == null) return false;
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  if (isNaN(numLat) || isNaN(numLng)) return false;
  return numLat >= 33.0 && numLat <= 39.0 && numLng >= 124.0 && numLng <= 132.0;
}

function formatStoreDistance(store, userCoords) {
  const storeLat = store.lat ?? store.latitude;
  const storeLng = store.lng ?? store.longitude;

  // 1. 사용자 좌표와 매장 유효 좌표가 모두 있는 경우 (정밀 하버사인 거리 계산)
  if (userCoords && isValidCoords(userCoords.lat, userCoords.lng) && isValidCoords(storeLat, storeLng)) {
    const dist = computeHaversine(userCoords.lat, userCoords.lng, parseFloat(storeLat), parseFloat(storeLng));
    if (dist > 60) return null; // 60km 초과 시 비정상치로 간주하여 숨김
    return dist < 0.1 ? '100m 이내' : `${dist.toFixed(1)}km`;
  }

  // 2. 서버가 계산해준 store.distance 사용 시 비정상치 방어
  if (store.distance != null) {
    const numDist = parseFloat(store.distance);
    if (isNaN(numDist)) return null;

    // 매장 좌표가 0이거나 유효하지 않은 경우 (13197.1km 등 Null Island 오염치) 완전 차단
    if (storeLat != null && !isValidCoords(storeLat, storeLng)) {
      return null;
    }

    // 서버 반환 거리가 50km 이상인 경우 숨김
    if (numDist >= 50) {
      return null;
    }

    return numDist < 0.1 ? '100m 이내' : `${numDist.toFixed(1)}km`;
  }

  return null;
}

// ----------------- Utilities -----------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ----------------- Recent Searches -----------------
function saveRecentSearch(query, location) {
  const item = { query, location, date: new Date().toLocaleDateString() };
  state.recentSearches = [item, ...state.recentSearches.filter((x) => x.query !== query)].slice(0, 5);
  localStorage.setItem('recent_searches', JSON.stringify(state.recentSearches));
  renderRecentSearches();
}

function renderRecentSearches() {
  if (!state.recentSearches.length) {
    recentSearchesContainer.innerHTML = '';
    return;
  }
  recentSearchesContainer.innerHTML = `
    <div class="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
      <span>최근 검색:</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      ${state.recentSearches
        .map(
          (s) => `
        <button type="button" class="recent-chip text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-full border border-gray-200"
                data-query="${escapeHtml(s.query)}" data-location="${escapeHtml(s.location || '')}">
          🔍 ${escapeHtml(s.query)} ${s.location ? `(${escapeHtml(s.location)})` : ''}
        </button>
      `
        )
        .join('')}
    </div>
  `;

  recentSearchesContainer.querySelectorAll('.recent-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      queryInput.value = btn.dataset.query;
      locationInput.value = btn.dataset.location;
      searchForm.dispatchEvent(new Event('submit'));
    });
  });
}

// ----------------- Search Execution -----------------
locationInput.addEventListener('input', () => {
  // 사용자가 동네를 직접 입력하기 시작하면 이전 GPS/지도 좌표 캐시 초기화
  gpsStatus.textContent = '';
  state.geoCoords = null;
});

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  const location = locationInput.value.trim();

  if (!query) {
    alert('검색할 상품명을 입력해주세요.');
    return;
  }

  // 텍스트 위치 입력 시 좌표가 없으면 자동 지오코딩으로 보완
  if (location && !state.geoCoords) {
    const foundCoords = await getCoordinatesFromText(location);
    if (foundCoords) {
      state.geoCoords = foundCoords;
    }
  }

  state.currentQuery = query;
  state.currentLocation = location;
  saveRecentSearch(query, location);

  emptyState.classList.add('hidden');
  resultsContainer.innerHTML = '';
  loadingEl.classList.remove('hidden');

  try {
    const activeTab = state.currentTab;
    const shouldFetchDaiso = activeTab === 'all' || activeTab === 'daiso';
    const shouldFetchOlive = activeTab === 'all' || activeTab === 'oliveyoung';
    const shouldFetchGs25 = activeTab === 'all' || activeTab === 'cvs' || activeTab === 'gs25';
    const shouldFetchCu = activeTab === 'all' || activeTab === 'cvs' || activeTab === 'cu';
    const shouldFetchSeven = activeTab === 'all' || activeTab === 'cvs' || activeTab === 'seveneleven';
    const shouldFetchEmart24 = activeTab === 'all' || activeTab === 'cvs' || activeTab === 'emart24';

    const tasks = [
      shouldFetchDaiso ? fetchDaiso(query, location, state.geoCoords) : Promise.resolve(null),
      shouldFetchOlive ? fetchOliveyoung(query, location, state.geoCoords) : Promise.resolve(null),
      shouldFetchGs25 ? fetchConvenienceStore('gs25', query, location, state.geoCoords) : Promise.resolve(null),
      shouldFetchCu ? fetchConvenienceStore('cu', query, location, state.geoCoords) : Promise.resolve(null),
      shouldFetchSeven ? fetchConvenienceStore('seveneleven', query, location, state.geoCoords) : Promise.resolve(null),
      shouldFetchEmart24 ? fetchConvenienceStore('emart24', query, location, state.geoCoords) : Promise.resolve(null)
    ];

    const results = await Promise.allSettled(tasks);
    const [daisoRes, oliveRes, gs25Res, cuRes, sevenRes, emart24Res] = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { error: r.reason?.message || '조회 실패' }
    );

    loadingEl.classList.add('hidden');
    renderResults({
      daiso: daisoRes,
      olive: oliveRes,
      gs25: gs25Res,
      cu: cuRes,
      seven: sevenRes,
      emart24: emart24Res
    });
  } catch (err) {
    loadingEl.classList.add('hidden');
    resultsContainer.innerHTML = `
      <div class="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
        ❌ 조회 중 오류가 발생했습니다: ${err.message}
      </div>
    `;
  }
});

// ----------------- Smart Semantic Dictionary (일상어 / 은어 / 유의어 자동 보정) -----------------
const SMART_SYNONYMS = {
  '틴셀': ['글리터헤어피스', '홀로그램 파티 커튼', '파티 커튼'],
  '헤어틴셀': ['글리터헤어피스', '붙임머리'],
  '에기틴셀': ['글리터헤어피스', '홀로그램 파티 커튼', '파티 커튼'],
  '뽁뽁이': ['단열에어캡', '에어캡', '포장용 완충재'],
  '돌돌이': ['테이프 크리너', '롤크리너'],
  '매직블럭': ['매직스펀지', '멜라민스펀지'],
  '찍찍이': ['벨크로 테이프', '벨크로'],
  '도꼬마리': ['벨크로'],
  '마테': ['마스킹 테이프', '디자인 테이프'],
  '알콜스왑': ['소독용 에탄올 스왑', '알콜솜'],
  '오특': ['오늘의 특가'],
  '스팸': ['런천미트', '통조림 햄'],
  '화장솜': ['순면 화장솜', '엠보싱 화장솜']
};

function getSmartKeywords(query) {
  const clean = query.trim().replace(/\s+/g, '');
  for (const [key, list] of Object.entries(SMART_SYNONYMS)) {
    if (clean === key || clean.includes(key) || key.includes(clean)) {
      return list;
    }
  }
  return [];
}

// 다이소 스마트 조회
async function fetchDaiso(query, location, geoCoords) {
  const storeQuery = location && !location.includes('GPS') ? location : '과천';

  // 1차: 원래 검색어로 시도
  try {
    const res = await callDaisoInventory(query, storeQuery, geoCoords);
    // 상품 후보가 정상적으로 있는 경우
    if (res.selectedProduct?.name && (res.storeInventory?.stores?.length > 0 || (res.onlineStock && res.onlineStock > 0))) {
      return res;
    }

    // 2차: 스마트 유의어/은어 사전 확장 검색
    const alternatives = getSmartKeywords(query);
    if (alternatives.length > 0) {
      for (const alt of alternatives) {
        try {
          const altRes = await callDaisoInventory(alt, storeQuery, geoCoords);
          if (altRes.selectedProduct?.name || (altRes.storeInventory?.stores?.length > 0)) {
            altRes.originalQuery = query;
            altRes.matchedKeyword = altRes.selectedProduct?.name || alt;
            return altRes;
          }
        } catch (e) {
          console.warn(`대체어 [${alt}] 조회 실패:`, e);
        }
      }
    }

    return res;
  } catch (e) {
    console.error('다이소 조회 실패:', e);
    return { error: e.message };
  }
}

async function callDaisoInventory(query, storeQuery, geoCoords) {
  const args = {
    service: 'daiso',
    operation: 'by_name',
    query: query,
    storeQuery: storeQuery
  };
  if (geoCoords) {
    args.latitude = geoCoords.lat;
    args.longitude = geoCoords.lng;
  }
  return await mcp.callTool('check_inventory', args);
}

// 올리브영 스마트 조회
async function fetchOliveyoung(query, location, geoCoords) {
  const storeKeyword = location && !location.includes('GPS') ? location : '과천';

  try {
    const res = await callOliveyoungInventory(query, storeKeyword, geoCoords);
    if (res.inventory?.products?.length > 0) {
      return res;
    }

    // 스마트 유의어 사전 확장 검색
    const alternatives = getSmartKeywords(query);
    if (alternatives.length > 0) {
      for (const alt of alternatives) {
        try {
          const altRes = await callOliveyoungInventory(alt, storeKeyword, geoCoords);
          if (altRes.inventory?.products?.length > 0) {
            altRes.originalQuery = query;
            altRes.matchedKeyword = alt;
            return altRes;
          }
        } catch (e) {
          console.warn(`올영 대체어 [${alt}] 조회 실패:`, e);
        }
      }
    }

    return res;
  } catch (e) {
    console.error('올리브영 조회 실패:', e);
    return { error: e.message };
  }
}

async function callOliveyoungInventory(keyword, storeKeyword, geoCoords) {
  const args = {
    service: 'oliveyoung',
    keyword: keyword,
    storeKeyword: storeKeyword
  };
  if (geoCoords) {
    args.latitude = geoCoords.lat;
    args.longitude = geoCoords.lng;
  }
  return await mcp.callTool('check_inventory', args);
}

// 편의점 스마트 조회 (GS25, CU, 세븐일레븐, 이마트24)
async function fetchConvenienceStore(service, query, location, geoCoords) {
  const storeKeyword = location && !location.includes('GPS') ? location.split(' ')[0] : '과천';
  const brandNames = {
    gs25: 'GS25',
    cu: 'CU',
    seveneleven: '세븐일레븐',
    emart24: '이마트24'
  };
  const brandColors = {
    gs25: { bg: 'bg-blue-600', text: 'text-blue-600', border: 'border-blue-100', badgeBg: 'bg-blue-50', badgeBorder: 'border-blue-200' },
    cu: { bg: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', badgeBg: 'bg-purple-50', badgeBorder: 'border-purple-200' },
    seveneleven: { bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', badgeBg: 'bg-emerald-50', badgeBorder: 'border-emerald-200' },
    emart24: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-100', badgeBg: 'bg-amber-50', badgeBorder: 'border-amber-200' }
  };

  const brandName = brandNames[service] || service;
  const brandColor = brandColors[service] || brandColors.gs25;

  const args = {
    service: service,
    keyword: query,
    storeKeyword: storeKeyword
  };
  if (geoCoords) {
    args.latitude = geoCoords.lat;
    args.longitude = geoCoords.lng;
  }

  try {
    const res = await mcp.callTool('check_inventory', args);
    if (res.error) {
      return {
        service,
        brandName,
        brandColor,
        error: res.error
      };
    }

    let rawStores = res.inventory?.stores || res.stores || [];
    let prodName = res.product?.name || res.keyword || query;
    let prodPrice = res.product?.price || null;

    if (service === 'emart24' && res.productCandidates?.length > 0) {
      const topProd = res.productCandidates[0];
      prodName = topProd.goodsName || prodName;
      prodPrice = topProd.viewPrice || topProd.originPrice || prodPrice;
    }

    const stores = rawStores.map((s) => {
      const qty = s.realStockQuantity ?? s.stockQuantity ?? s.bizQty ?? s.quantity ?? 0;
      const lat = s.latitude ?? s.lat;
      const lng = s.longitude ?? s.lng;
      let dist = s.distance;
      if (dist == null && s.distanceM != null) {
        dist = (s.distanceM / 1000).toFixed(1);
      }

      return {
        storeName: s.storeName,
        address: s.address,
        phone: s.phone,
        lat: lat,
        lng: lng,
        distance: dist,
        quantity: qty
      };
    });

    return {
      service,
      brandName,
      brandColor,
      productName: prodName,
      productPrice: prodPrice,
      stores: stores
    };
  } catch (e) {
    console.error(`${brandName} 조회 실패:`, e);
    return {
      service,
      brandName,
      brandColor,
      error: { message: e.message || '일시적인 네트워크 지연' }
    };
  }
}

// ----------------- Render Results -----------------
function renderResults(resMap) {
  let html = '';

  // 기준 동네 안내 헤더
  const locDisplay = state.currentLocation || '내 위치';
  html += `
    <div class="p-3 bg-white rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between text-xs mb-3">
      <div class="flex items-center gap-1.5 text-gray-900 font-bold">
        <span class="text-base">📍</span>
        <span>기준 동네: <b class="text-blue-600">${escapeHtml(locDisplay)}</b></span>
      </div>
      <span class="text-[11px] text-gray-400 font-medium">실시간 매장 재고</span>
    </div>
  `;

  // 다이소 카드
  if (resMap.daiso) {
    html += renderDaisoSection(resMap.daiso);
  }

  // 올리브영 카드
  if (resMap.olive) {
    html += renderOliveSection(resMap.olive);
  }

  // 편의점 4사 카드
  if (resMap.gs25) {
    html += renderConvenienceSection(resMap.gs25);
  }
  if (resMap.cu) {
    html += renderConvenienceSection(resMap.cu);
  }
  if (resMap.seven) {
    html += renderConvenienceSection(resMap.seven);
  }
  if (resMap.emart24) {
    html += renderConvenienceSection(resMap.emart24);
  }

  resultsContainer.innerHTML = html;
  filterSections(state.currentTab);
}

function renderDaisoSection(res) {
  if (res.error) {
    const errorMsg = res.error?.message || (typeof res.error === 'string' ? res.error : res.diagnostics?.message || '다이소 서버 연결 지연');
    return `
      <div id="daiso-section" class="result-section mb-6 bg-white rounded-2xl p-4 shadow-sm border border-red-100" data-service="daiso">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 font-bold text-red-600">
            <span class="w-3 h-3 rounded-full bg-red-500"></span> 다이소
          </div>
          <span class="text-[11px] text-amber-600 font-semibold px-2 py-0.5 bg-amber-50 rounded-md border border-amber-200">일시 지연</span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">${escapeHtml(errorMsg)}</p>
        <p class="text-[11px] text-gray-400 mt-1">다이소 외부 전산망 응답이 지연되고 있습니다. 잠시 후 재시도해주세요.</p>
      </div>
    `;
  }

  const summary = res.summary || {};
  const headline = summary.headline || '';
  const invSummary = summary.inventorySummary || '';
  const selectedProduct = res.selectedProduct || {};
  const stores = res.storeInventory?.stores || [];
  const onlineStock = res.onlineStock;
  const matchedKeyword = res.matchedKeyword;
  const originalQuery = res.originalQuery;

  return `
    <div id="daiso-section" class="result-section mb-6 bg-white rounded-2xl p-4 shadow-sm border border-red-100" data-service="daiso">
      <div class="flex items-center justify-between pb-3 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 text-xs font-bold bg-red-500 text-white rounded-md">다이소</span>
          <span class="text-xs text-gray-500">실시간 재고</span>
        </div>
        ${onlineStock !== undefined ? `<span class="text-xs text-gray-500">온라인 재고: <b class="text-red-500">${onlineStock}</b>개</span>` : ''}
      </div>

      ${
        matchedKeyword
          ? `
        <div class="mt-3 px-3 py-2 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2">
          <span class="text-base leading-none">💡</span>
          <div>
            <b>'${escapeHtml(originalQuery)}'</b> 공식 등록 명칭인 <b>[${escapeHtml(matchedKeyword)}]</b>(으)로 스마트 연동하여 재고를 조회했습니다.
          </div>
        </div>
      `
          : ''
      }

      ${
        selectedProduct.name
          ? `
        <div class="flex items-center gap-3 my-3 p-2.5 bg-gray-50 rounded-xl">
          ${selectedProduct.imageUrl ? `<img src="${selectedProduct.imageUrl}" class="w-14 h-14 object-cover rounded-lg border border-gray-200" alt="${selectedProduct.name}"/>` : ''}
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-bold text-gray-900 truncate">${selectedProduct.name}</h4>
            <p class="text-xs text-gray-500 mt-0.5">${headline}</p>
          </div>
        </div>
      `
          : ''
      }

      ${invSummary ? `<p class="text-xs text-gray-600 mb-3 px-1">📊 ${invSummary}</p>` : ''}

      <div class="space-y-2 mt-2">
        ${
          stores.length === 0
            ? '<p class="text-xs text-gray-400 py-3 text-center">해당 지역 주변에 확인된 매장 재고가 없습니다.</p>'
            : stores
                .map((s) => {
                  const qty = s.quantity;
                  const hasStock = qty && qty > 0;
                  const isZero = qty === 0;
                  const badgeClass = hasStock
                    ? 'bg-green-100 text-green-800 border-green-200'
                    : isZero
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-gray-100 text-gray-600 border-gray-200';
                  const badgeText = hasStock ? `재고 ${qty}개` : isZero ? '품절' : '수량 미확인';
                  const mapUrl = `https://map.kakao.com/link/search/${encodeURIComponent(s.address || s.storeName)}`;
                  const distText = formatStoreDistance(s, state.geoCoords);

                  return `
            <div class="p-3 bg-gray-50/70 hover:bg-gray-50 rounded-xl border border-gray-100 flex items-start justify-between gap-2">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-sm text-gray-900">${s.storeName}</span>
                  ${distText ? `<span class="text-xs text-gray-400 font-medium">${distText}</span>` : ''}
                </div>
                <p class="text-xs text-gray-500 mt-1 leading-relaxed">${s.address || ''}</p>
                <div class="flex items-center gap-3 mt-2 text-xs">
                  ${s.phone ? `<a href="tel:${s.phone}" class="text-blue-600 hover:underline">📞 ${s.phone}</a>` : ''}
                  <a href="${mapUrl}" target="_blank" class="text-gray-500 hover:text-gray-800 underline">🗺️ 지도/길찾기</a>
                </div>
              </div>
              <span class="px-2.5 py-1 text-xs font-bold rounded-lg border ${badgeClass} shrink-0">
                ${badgeText}
              </span>
            </div>
          `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

function renderOliveSection(res) {
  if (res.error) {
    const errorMsg = res.error?.message || (typeof res.error === 'string' ? res.error : res.diagnostics?.message || '올리브영 릴레이 응답 지연');
    return `
      <div id="olive-section" class="result-section mb-6 bg-white rounded-2xl p-4 shadow-sm border border-emerald-100" data-service="oliveyoung">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 font-bold text-emerald-600">
            <span class="w-3 h-3 rounded-full bg-emerald-500"></span> 올리브영
          </div>
          <span class="text-[11px] text-amber-600 font-semibold px-2 py-0.5 bg-amber-50 rounded-md border border-amber-200">일시 지연</span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">${escapeHtml(errorMsg)}</p>
        <p class="text-[11px] text-gray-400 mt-1">올리브영 전산망 릴레이 서버가 일시 지연 중입니다. 잠시 후 재시도해주세요.</p>
      </div>
    `;
  }

  const inv = res.inventory || {};
  const products = inv.products || [];
  const matchedKeyword = res.matchedKeyword;
  const originalQuery = res.originalQuery;

  return `
    <div id="olive-section" class="result-section mb-6 bg-white rounded-2xl p-4 shadow-sm border border-emerald-100" data-service="oliveyoung">
      <div class="flex items-center justify-between pb-3 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 text-xs font-bold bg-emerald-600 text-white rounded-md">올리브영</span>
          <span class="text-xs text-gray-500">실시간 매장 재고</span>
        </div>
        <span class="text-xs text-gray-400">총 ${inv.totalCount || products.length}개 상품</span>
      </div>

      ${
        matchedKeyword
          ? `
        <div class="mt-3 px-3 py-2 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2">
          <span class="text-base leading-none">💡</span>
          <div>
            <b>'${escapeHtml(originalQuery)}'</b> 연관 공식 명칭인 <b>[${escapeHtml(matchedKeyword)}]</b>(으)로 스마트 연동하여 재고를 조회했습니다.
          </div>
        </div>
      `
          : ''
      }

      <div class="divide-y divide-gray-100">
        ${
          products.length === 0
            ? '<p class="text-xs text-gray-400 py-3 text-center">조회된 상품이 없습니다.</p>'
            : products
                .slice(0, 3)
                .map((p, idx) => {
                  const stores = p.storeInventory?.stores || [];
                  const price = p.priceToPay ? p.priceToPay.toLocaleString() + '원' : '';
                  const origPrice = p.originalPrice ? p.originalPrice.toLocaleString() + '원' : '';
                  const inStockStores = stores.filter((s) => s.o2oStockFlag || (s.o2oRemainQuantity && s.o2oRemainQuantity > 0));

                  return `
            <div class="py-3.5 first:pt-3">
              <div class="flex gap-3 items-center">
                ${p.imageUrl ? `<img src="${p.imageUrl}" class="w-16 h-16 object-cover rounded-xl border border-gray-200 shrink-0" alt="${p.goodsName}"/>` : ''}
                <div class="flex-1 min-w-0">
                  <h4 class="text-sm font-bold text-gray-900 leading-snug line-clamp-2">${p.goodsName}</h4>
                  <div class="flex items-baseline gap-1.5 mt-1">
                    <span class="text-sm font-extrabold text-emerald-600">${price}</span>
                    ${origPrice && origPrice !== price ? `<span class="text-xs text-gray-400 line-through">${origPrice}</span>` : ''}
                    ${p.discountRate ? `<span class="text-xs font-bold text-red-500">${p.discountRate}%</span>` : ''}
                  </div>
                </div>
              </div>

              <!-- 인근 매장 재고 리스트 -->
              <div class="mt-2.5 bg-gray-50/80 rounded-xl p-2.5 space-y-1.5">
                <div class="text-[11px] font-semibold text-gray-500 mb-1 flex items-center justify-between">
                  <span>📍 인근 매장 재고 현황</span>
                  <span class="text-emerald-600 font-bold">${inStockStores.length}곳 보유</span>
                </div>
                ${
                  stores.length === 0
                    ? '<p class="text-[11px] text-gray-400">인근 매장 재고 정보를 불러올 수 없습니다.</p>'
                    : stores
                        .slice(0, 4)
                        .map((s) => {
                          const sqty = s.o2oRemainQuantity || 0;
                          const has = s.o2oStockFlag || sqty > 0;
                          const badge = has
                            ? `<span class="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">${sqty > 0 ? sqty + '개' : '보유'}</span>`
                            : '<span class="text-[10px] font-semibold text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">품절</span>';
                          const mapUrl = `https://map.kakao.com/link/search/${encodeURIComponent(s.address || s.storeName)}`;
                          const distText = formatStoreDistance(s, state.geoCoords);

                          return `
                    <div class="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                      <div class="flex-1 min-w-0 pr-2">
                        <div class="font-medium text-gray-800 truncate flex items-center gap-1.5">
                          <span>${s.storeName}</span>
                          ${distText ? `<span class="text-[10px] text-gray-400 font-normal">${distText}</span>` : ''}
                        </div>
                        <div class="text-[10px] text-gray-400 truncate">${s.address || ''}</div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <a href="${mapUrl}" target="_blank" class="text-[10px] text-gray-500 underline">지도</a>
                        ${badge}
                      </div>
                    </div>
                  `;
                        })
                        .join('')
                }
              </div>
            </div>
          `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

function renderConvenienceSection(res) {
  if (!res) return '';
  const { service, brandName, brandColor } = res;

  if (res.error) {
    const errorMsg = res.error?.message || (typeof res.error === 'string' ? res.error : '편의점 릴레이 일시 지연');
    return `
      <div id="${service}-section" class="result-section mb-6 bg-white rounded-2xl p-4 shadow-sm border ${brandColor.border}" data-service="${service}">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 font-bold ${brandColor.text}">
            <span class="w-2.5 h-2.5 rounded-full ${brandColor.bg}"></span> ${brandName}
          </div>
          <span class="text-[11px] text-amber-600 font-semibold px-2 py-0.5 bg-amber-50 rounded-md border border-amber-200">일시 지연</span>
        </div>
        <p class="text-xs text-gray-600 leading-relaxed">${escapeHtml(errorMsg)}</p>
        <p class="text-[11px] text-gray-400 mt-1">${brandName} 전산망 연동이 일시 지연 중입니다. 잠시 후 재시도해주세요.</p>
      </div>
    `;
  }

  const stores = res.stores || [];
  const inStockStores = stores.filter((s) => s.quantity > 0);
  const prodName = res.productName || state.currentQuery;
  const prodPrice = res.productPrice ? Number(res.productPrice).toLocaleString() + '원' : '';

  return `
    <div id="${service}-section" class="result-section mb-6 bg-white rounded-2xl p-4 shadow-sm border ${brandColor.border}" data-service="${service}">
      <div class="flex items-center justify-between pb-3 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 text-xs font-bold ${brandColor.bg} text-white rounded-md">${brandName}</span>
          <span class="text-xs text-gray-500 font-medium truncate max-w-[150px]">${escapeHtml(prodName)}</span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          ${prodPrice ? `<span class="font-bold text-gray-800">${prodPrice}</span>` : ''}
          <span class="text-[11px] font-bold ${inStockStores.length > 0 ? brandColor.text : 'text-gray-400'}">
            ${inStockStores.length > 0 ? `${inStockStores.length}곳 보유` : '재고 없음'}
          </span>
        </div>
      </div>

      <div class="space-y-2 mt-3">
        ${
          stores.length === 0
            ? '<p class="text-xs text-gray-400 py-3 text-center">주변 매장에 확인된 재고가 없습니다.</p>'
            : stores
                .slice(0, 5)
                .map((s) => {
                  const hasStock = s.quantity > 0;
                  const badgeClass = hasStock
                    ? 'bg-green-100 text-green-800 border-green-200'
                    : 'bg-red-100 text-red-700 border-red-200';
                  const badgeText = hasStock ? `재고 ${s.quantity}개` : '품절';
                  const mapUrl = `https://map.kakao.com/link/search/${encodeURIComponent(s.address || s.storeName)}`;
                  const distText = formatStoreDistance(s, state.geoCoords);

                  return `
            <div class="p-3 bg-gray-50/70 hover:bg-gray-50 rounded-xl border border-gray-100 flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-sm text-gray-900 truncate">${escapeHtml(s.storeName)}</span>
                  ${distText ? `<span class="text-xs text-gray-400 font-medium shrink-0">${distText}</span>` : ''}
                </div>
                <p class="text-xs text-gray-500 mt-1 leading-relaxed truncate">${escapeHtml(s.address || '')}</p>
                <div class="flex items-center gap-3 mt-2 text-xs">
                  ${s.phone ? `<a href="tel:${s.phone}" class="text-blue-600 hover:underline">📞 ${s.phone}</a>` : ''}
                  <a href="${mapUrl}" target="_blank" class="text-gray-500 hover:text-gray-800 underline">🗺️ 지도/길찾기</a>
                </div>
              </div>
              <span class="px-2.5 py-1 text-xs font-bold rounded-lg border ${badgeClass} shrink-0">
                ${badgeText}
              </span>
            </div>
          `;
                })
                .join('')
        }
      </div>
    </div>
  `;
}

// ----------------- Service Worker Registration -----------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => console.log('SW 등록 완료:', reg.scope))
      .catch((err) => console.log('SW 등록 실패:', err));
  });
}

// 초기 실행
checkAuth();
renderRecentSearches();
