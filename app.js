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

const tabAll = document.getElementById('tab-all');
const tabDaiso = document.getElementById('tab-daiso');
const tabOlive = document.getElementById('tab-olive');

const loadingEl = document.getElementById('loading-indicator');
const resultsContainer = document.getElementById('results-container');
const emptyState = document.getElementById('empty-state');
const recentSearchesContainer = document.getElementById('recent-searches');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const newPinInput = document.getElementById('new-pin-input');
const savePinBtn = document.getElementById('save-pin-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');

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
  [tabAll, tabDaiso, tabOlive].forEach((el) => {
    el.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
    el.classList.add('bg-gray-100', 'text-gray-600');
  });

  const activeEl = tab === 'all' ? tabAll : tab === 'daiso' ? tabDaiso : tabOlive;
  activeEl.classList.remove('bg-gray-100', 'text-gray-600');
  activeEl.classList.add('bg-blue-600', 'text-white', 'shadow-sm');

  // 화면 카드 필터링
  const daisoSection = document.getElementById('daiso-section');
  const oliveSection = document.getElementById('olive-section');
  if (daisoSection && oliveSection) {
    if (tab === 'all') {
      daisoSection.style.display = 'block';
      oliveSection.style.display = 'block';
    } else if (tab === 'daiso') {
      daisoSection.style.display = 'block';
      oliveSection.style.display = 'none';
    } else {
      daisoSection.style.display = 'none';
      oliveSection.style.display = 'block';
    }
  }
}

tabAll.addEventListener('click', () => setTab('all'));
tabDaiso.addEventListener('click', () => setTab('daiso'));
tabOlive.addEventListener('click', () => setTab('oliveyoung'));

// ----------------- Geolocation -----------------
gpsBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('사용 중인 브라우저에서 위치 서비스를 지원하지 않습니다.');
    return;
  }
  gpsStatus.textContent = '위치 확인 중...';
  gpsBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.geoCoords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      locationInput.value = '내 위치 (GPS 연동)';
      gpsStatus.textContent = '📍 GPS 완료';
      gpsBtn.disabled = false;
    },
    (err) => {
      alert('위치 권한을 허용해주세요: ' + err.message);
      gpsStatus.textContent = '';
      gpsBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

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
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  const location = locationInput.value.trim();

  if (!query) {
    alert('검색할 상품명을 입력해주세요.');
    return;
  }

  state.currentQuery = query;
  state.currentLocation = location;
  saveRecentSearch(query, location);

  emptyState.classList.add('hidden');
  resultsContainer.innerHTML = '';
  loadingEl.classList.remove('hidden');

  try {
    const promises = [];
    if (state.currentTab === 'all' || state.currentTab === 'daiso') {
      promises.push(fetchDaiso(query, location, state.geoCoords));
    } else {
      promises.push(Promise.resolve(null));
    }

    if (state.currentTab === 'all' || state.currentTab === 'oliveyoung') {
      promises.push(fetchOliveyoung(query, location, state.geoCoords));
    } else {
      promises.push(Promise.resolve(null));
    }

    const [daisoRes, oliveRes] = await Promise.all(promises);
    loadingEl.classList.add('hidden');
    renderResults(daisoRes, oliveRes);
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

// ----------------- Render Results -----------------
function renderResults(daiso, olive) {
  let html = '';

  // 다이소 카드
  if (daiso) {
    html += renderDaisoSection(daiso);
  }

  // 올리브영 카드
  if (olive) {
    html += renderOliveSection(olive);
  }

  if (!html) {
    html = `
      <div class="p-8 text-center text-gray-500">
        검색 결과가 없습니다. 다른 검색어나 지역명을 입력해보세요.
      </div>
    `;
  }

  resultsContainer.innerHTML = html;
  setTab(state.currentTab); // 현재 탭 표시 반영
}

function renderDaisoSection(res) {
  if (res.error) {
    const errorMsg = res.error?.message || (typeof res.error === 'string' ? res.error : res.diagnostics?.message || '다이소 서버 연결 지연');
    return `
      <div id="daiso-section" class="mb-6 bg-white rounded-2xl p-4 shadow-sm border border-red-100">
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
    <div id="daiso-section" class="mb-6 bg-white rounded-2xl p-4 shadow-sm border border-red-100">
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

                  return `
            <div class="p-3 bg-gray-50/70 hover:bg-gray-50 rounded-xl border border-gray-100 flex items-start justify-between gap-2">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-sm text-gray-900">${s.storeName}</span>
                  ${s.distance ? `<span class="text-xs text-gray-400 font-medium">${s.distance}km</span>` : ''}
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
      <div id="olive-section" class="mb-6 bg-white rounded-2xl p-4 shadow-sm border border-emerald-100">
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
    <div id="olive-section" class="mb-6 bg-white rounded-2xl p-4 shadow-sm border border-emerald-100">
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

                          return `
                    <div class="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                      <div class="flex-1 min-w-0 pr-2">
                        <div class="font-medium text-gray-800 truncate">${s.storeName}</div>
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
