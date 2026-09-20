(() => {
  'use strict';

  const STORAGE_KEY = 'ali-fitness-log-v2';
  const PROFILE_KEY = 'ali-fitness-profile-v1';
  const API_KEY_STORAGE = 'ali-fitness-api-key';
  const DB_NAME = 'AliFitnessDB';
  const DB_VERSION = 1;
  const PHOTO_STORE = 'mealPhotos';

  let db = null;

  const DEFAULT_PLANS = {
    monday: {
      label: 'Monday Push',
      exercises: [
        'Incline chest press',
        'Flat bench',
        'Lateral raises',
        'Triceps pushdowns',
        'Overhead extensions',
        'Stomach vacuums',
        'Dead hang (optional)'
      ]
    },
    wednesday: {
      label: 'Wednesday Pull',
      exercises: [
        'Lat pulldown',
        'Bent-over rows',
        'Bicep curls',
        'Preacher curls',
        'Reverse barbell curls',
        'Farmers carry / dead hang',
        'Stomach vacuums'
      ]
    },
    friday: {
      label: 'Friday Legs+posture',
      exercises: [
        'Goblet squat or leg press',
        'RDL',
        'Lunges or leg curl',
        'Calf raises',
        'Face pulls / rear delt fly',
        'Front plank',
        'Vacuums',
        'Wall angels'
      ]
    }
  };

  const DEFAULT_PROFILE = {
    age: 28,
    birthMonth: 11,
    height: 173,
    weight: 76.5,
    ethnicity: 'South Asian',
    goals: 'Gain muscle (very serious); flatter/tighter belly to look taller; V-taper (broader upper body)',
    proteinTarget: '150–160',
    dietNotes: 'Small surplus diet',
    workSchedule: 'Mon–Fri',
    scheduleNotes: 'Late meeting every Tuesday (stay fresh). Does not like leaving home Saturdays.',
    gymDays: 'Mon/Wed/Fri',
    startDate: '2026-10-05'
  };

  const HOLD_HINT = /plank|hang|vacuum|hold|angel|carry/i;

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function weekdayKey(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return map[d.getDay()];
  }

  function weekdayLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    return {
      plans: structuredClone(DEFAULT_PLANS),
      workouts: {},
      meals: {}
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data.plans) data.plans = structuredClone(DEFAULT_PLANS);
      if (!data.workouts) data.workouts = {};
      if (!data.meals) data.meals = {};
      return data;
    } catch {
      return defaultState();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return structuredClone(DEFAULT_PROFILE);
      return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    } catch {
      return structuredClone(DEFAULT_PROFILE);
    }
  }

  function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function loadApiSettings() {
    try {
      const raw = localStorage.getItem(API_KEY_STORAGE);
      if (!raw) return { provider: 'openai', key: '' };
      return JSON.parse(raw);
    } catch {
      return { provider: 'openai', key: '' };
    }
  }

  function saveApiSettings(provider, key) {
    localStorage.setItem(API_KEY_STORAGE, JSON.stringify({ provider, key }));
  }

  async function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(PHOTO_STORE)) {
          database.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  async function savePhoto(id, blob) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      const store = tx.objectStore(PHOTO_STORE);
      store.put({ id, blob, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getPhoto(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const store = tx.objectStore(PHOTO_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result?.blob || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function deletePhoto(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      const store = tx.objectStore(PHOTO_STORE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let state = load();
  let profile = loadProfile();
  let currentPhotoBlob = null;
  let currentPhotoId = null;

  const $ = (id) => document.getElementById(id);
  const todayStrip = $('todayStrip');
  const workoutDate = $('workoutDate');
  const foodDate = $('foodDate');
  const planDay = $('planDay');
  const workoutList = $('workoutList');
  const mealList = $('mealList');
  const foodTotals = $('foodTotals');
  const foodHistory = $('foodHistory');
  const photoPreview = $('photoPreview');
  const analyzeSection = $('analyzeSection');

  function syncDates() {
    const t = todayISO();
    if (!workoutDate.value) workoutDate.value = t;
    if (!foodDate.value) foodDate.value = t;
  }

  function renderTodayStrip() {
    const t = todayISO();
    const key = weekdayKey(t);
    const planHint =
      key === 'monday' || key === 'wednesday' || key === 'friday'
        ? ` · ${state.plans[key].label}`
        : ' · pick a plan';
    todayStrip.innerHTML = `<strong>${weekdayLabel(t)}</strong>${planHint}`;
  }

  function ensureWorkout(date) {
    if (!state.workouts[date]) {
      state.workouts[date] = { planKey: null, exercises: [] };
    }
    return state.workouts[date];
  }

  function ensureMeals(date) {
    if (!state.meals[date]) state.meals[date] = [];
    return state.meals[date];
  }

  function emptySet(name) {
    return { weight: '', reps: '', unit: HOLD_HINT.test(name) ? 'sec' : 'reps' };
  }

  function loadPlanForDate(date, planKey) {
    const plan = state.plans[planKey];
    if (!plan) return;
    const w = ensureWorkout(date);
    w.planKey = planKey;
    w.exercises = plan.exercises.map((name) => ({
      id: uid(),
      name,
      sets: [emptySet(name)]
    }));
    save();
    renderWorkout();
  }

  function suggestPlanKey(date) {
    const key = weekdayKey(date);
    if (key === 'monday' || key === 'wednesday' || key === 'friday') return key;
    return planDay.value;
  }

  function renderWorkout() {
    const date = workoutDate.value || todayISO();
    const w = ensureWorkout(date);
    if (w.planKey) planDay.value = w.planKey;

    if (!w.exercises.length) {
      workoutList.innerHTML = `<div class="card empty">No exercises yet. Tap <strong>Load today's plan</strong> or add a custom one.</div>`;
      return;
    }

    workoutList.innerHTML = w.exercises
      .map((ex, ei) => {
        const unitLabel = HOLD_HINT.test(ex.name) ? 'sec' : 'reps';
        const setsHtml = ex.sets
          .map((s, si) => {
            const unit = s.unit || unitLabel;
            return `<div class="set-row" data-ei="${ei}" data-si="${si}">
              <span class="n">${si + 1}</span>
              <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="kg" data-field="weight" value="${s.weight ?? ''}" aria-label="Weight kg" />
              <input type="number" inputmode="numeric" min="0" step="1" placeholder="${unit}" data-field="reps" value="${s.reps ?? ''}" aria-label="${unit}" />
              <button type="button" class="btn btn-sm btn-danger" data-action="del-set" title="Remove set">✕</button>
            </div>`;
          })
          .join('');

        return `<div class="card exercise" data-ei="${ei}">
          <div class="exercise-head">
            <div class="exercise-name" contenteditable="true" spellcheck="false" data-action="rename">${escapeHtml(ex.name)}</div>
            <button type="button" class="btn btn-sm btn-danger" data-action="del-ex">Remove</button>
          </div>
          <div class="sets">${setsHtml}</div>
          <div class="actions-inline">
            <button type="button" class="btn btn-sm" data-action="add-set">+ Set</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderFood() {
    const date = foodDate.value || todayISO();
    const meals = ensureMeals(date);
    let kcal = 0, protein = 0, carbs = 0, fat = 0;
    
    meals.forEach((m) => {
      if (m.kcal != null && m.kcal !== '') kcal += Number(m.kcal) || 0;
      if (m.protein != null && m.protein !== '') protein += Number(m.protein) || 0;
      if (m.carbs != null && m.carbs !== '') carbs += Number(m.carbs) || 0;
      if (m.fat != null && m.fat !== '') fat += Number(m.fat) || 0;
    });

    const proteinClass = protein >= 150 ? 'ok' : protein > 0 ? 'low' : '';
    foodTotals.innerHTML = `
      <div class="stat">
        <div class="label">kcal</div>
        <div class="value">${kcal ? Math.round(kcal) : '—'}</div>
      </div>
      <div class="stat ${proteinClass}">
        <div class="label">protein</div>
        <div class="value">${protein ? Math.round(protein) + 'g' : '—'}</div>
      </div>
      <div class="stat">
        <div class="label">carbs</div>
        <div class="value">${carbs ? Math.round(carbs) + 'g' : '—'}</div>
      </div>
      <div class="stat">
        <div class="label">fat</div>
        <div class="value">${fat ? Math.round(fat) + 'g' : '—'}</div>
      </div>`;

    renderMealList(meals);
    renderFoodHistory();
  }

  async function renderMealList(meals) {
    if (!meals.length) {
      mealList.innerHTML = `<div class="empty">No meals logged for this day.</div>`;
      return;
    }

    const items = await Promise.all(meals.map(async (m, i) => {
      const bits = [];
      if (m.kcal != null && m.kcal !== '') bits.push(`${m.kcal} kcal`);
      if (m.protein != null && m.protein !== '') bits.push(`${m.protein}g P`);
      if (m.carbs != null && m.carbs !== '') bits.push(`${m.carbs}g C`);
      if (m.fat != null && m.fat !== '') bits.push(`${m.fat}g F`);

      let photoHtml = '';
      if (m.photoId) {
        try {
          const blob = await getPhoto(m.photoId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            photoHtml = `<img src="${url}" class="meal-photo-thumb" alt="Meal photo" />`;
          }
        } catch {}
      }

      return `<div class="meal" data-i="${i}">
        <div class="meal-content">
          ${photoHtml}
          <div>
            <div class="meal-desc">${escapeHtml(m.desc)}</div>
            <div class="meal-meta">${bits.length ? bits.join(' · ') : 'no macros'}</div>
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-danger" data-action="del-meal">✕</button>
      </div>`;
    }));

    mealList.innerHTML = items.join('');
  }

  function renderFoodHistory() {
    const dates = Object.keys(state.meals).sort().reverse().slice(0, 7);
    const today = foodDate.value || todayISO();
    const otherDates = dates.filter(d => d !== today);

    if (!otherDates.length) {
      foodHistory.innerHTML = `<div class="empty">No previous days logged yet.</div>`;
      return;
    }

    foodHistory.innerHTML = otherDates.map(date => {
      const meals = state.meals[date] || [];
      let kcal = 0, protein = 0;
      meals.forEach(m => {
        if (m.kcal != null) kcal += Number(m.kcal) || 0;
        if (m.protein != null) protein += Number(m.protein) || 0;
      });
      return `<div class="history-row" data-date="${date}">
        <div class="history-date">${weekdayLabel(date)}</div>
        <div class="history-stats">${meals.length} meal${meals.length !== 1 ? 's' : ''} · ${kcal ? Math.round(kcal) + ' kcal' : '—'} · ${protein ? Math.round(protein) + 'g P' : '—'}</div>
      </div>`;
    }).join('');
  }

  function renderProfile() {
    $('profileAge').value = profile.age || '';
    $('profileBirthMonth').value = profile.birthMonth || 11;
    $('profileHeight').value = profile.height || '';
    $('profileWeight').value = profile.weight || '';
    $('profileEthnicity').value = profile.ethnicity || '';
    $('profileGoals').value = profile.goals || '';
    $('profileProteinTarget').value = profile.proteinTarget || '';
    $('profileDietNotes').value = profile.dietNotes || '';
    $('profileWorkSchedule').value = profile.workSchedule || '';
    $('profileScheduleNotes').value = profile.scheduleNotes || '';
    $('profileGymDays').value = profile.gymDays || '';
    $('profileStartDate').value = profile.startDate || '';

    const apiSettings = loadApiSettings();
    $('apiProvider').value = apiSettings.provider || 'openai';
    $('apiKey').value = apiSettings.key || '';
  }

  function clearPhotoPreview() {
    currentPhotoBlob = null;
    currentPhotoId = null;
    photoPreview.innerHTML = '';
    analyzeSection.style.display = 'none';
  }

  function showPhotoPreview(blob) {
    currentPhotoBlob = blob;
    currentPhotoId = uid();
    const url = URL.createObjectURL(blob);
    photoPreview.innerHTML = `
      <div class="preview-container">
        <img src="${url}" alt="Meal preview" />
        <button type="button" class="btn btn-sm btn-danger preview-remove" id="btnRemovePhoto">✕</button>
      </div>`;
    
    const apiSettings = loadApiSettings();
    analyzeSection.style.display = apiSettings.key ? 'flex' : 'none';
  }

  async function analyzePhotoWithAI(blob) {
    const apiSettings = loadApiSettings();
    if (!apiSettings.key) {
      alert('No API key configured. Go to the Me tab to add one.');
      return null;
    }

    const base64 = await blobToBase64(blob);
    
    try {
      if (apiSettings.provider === 'openai') {
        return await analyzeWithOpenAI(apiSettings.key, base64);
      } else {
        return await analyzeWithGemini(apiSettings.key, base64);
      }
    } catch (err) {
      console.error('AI analysis error:', err);
      alert(`Error analyzing photo: ${err.message}`);
      return null;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function analyzeWithOpenAI(apiKey, base64Image) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a nutrition expert. Analyze the food in the image and estimate its macronutrients. Respond ONLY with a JSON object containing: description (brief food description), kcal (number), protein (number in grams), carbs (number in grams), fat (number in grams). Be conservative with estimates. If you cannot identify the food, set all values to null.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Estimate the macros for this meal:' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ]
          }
        ],
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return parseAIResponse(content);
  }

  async function analyzeWithGemini(apiKey, base64Image) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Analyze this food image and estimate its macronutrients. Respond ONLY with a JSON object containing: description (brief food description), kcal (number), protein (number in grams), carbs (number in grams), fat (number in grams). Be conservative with estimates. If you cannot identify the food, set all values to null.' },
            { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
          ]
        }],
        generationConfig: { maxOutputTokens: 300 }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAIResponse(content);
  }

  function parseAIResponse(content) {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: parsed.description || null,
        kcal: typeof parsed.kcal === 'number' ? parsed.kcal : null,
        protein: typeof parsed.protein === 'number' ? parsed.protein : null,
        carbs: typeof parsed.carbs === 'number' ? parsed.carbs : null,
        fat: typeof parsed.fat === 'number' ? parsed.fat : null
      };
    } catch {
      return null;
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $(`panel-${name}`).classList.add('active');
  }

  document.querySelector('.nav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  $('btnLoadPlan').addEventListener('click', () => {
    const date = workoutDate.value || todayISO();
    const key = suggestPlanKey(date);
    planDay.value = key;
    if (!confirm(`Load ${state.plans[key].label} for ${date}? This replaces today's exercise list.`)) return;
    loadPlanForDate(date, key);
  });

  workoutDate.addEventListener('change', () => {
    const w = ensureWorkout(workoutDate.value);
    if (w.planKey) planDay.value = w.planKey;
    else {
      const key = weekdayKey(workoutDate.value);
      if (key === 'monday' || key === 'wednesday' || key === 'friday') planDay.value = key;
    }
    renderWorkout();
  });

  foodDate.addEventListener('change', renderFood);

  $('btnAddExercise').addEventListener('click', () => {
    const name = $('customExercise').value.trim();
    if (!name) return;
    const date = workoutDate.value || todayISO();
    const w = ensureWorkout(date);
    w.exercises.push({ id: uid(), name, sets: [emptySet(name)] });
    $('customExercise').value = '';
    save();
    renderWorkout();
  });

  workoutList.addEventListener('click', (e) => {
    const card = e.target.closest('.exercise');
    if (!card) return;
    const ei = Number(card.dataset.ei);
    const date = workoutDate.value || todayISO();
    const w = ensureWorkout(date);
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'add-set') {
      w.exercises[ei].sets.push(emptySet(w.exercises[ei].name));
      save();
      renderWorkout();
    } else if (action === 'del-ex') {
      w.exercises.splice(ei, 1);
      save();
      renderWorkout();
    } else if (action === 'del-set') {
      const row = e.target.closest('.set-row');
      const si = Number(row.dataset.si);
      w.exercises[ei].sets.splice(si, 1);
      if (!w.exercises[ei].sets.length) w.exercises[ei].sets.push(emptySet(w.exercises[ei].name));
      save();
      renderWorkout();
    }
  });

  workoutList.addEventListener('input', (e) => {
    const row = e.target.closest('.set-row');
    const card = e.target.closest('.exercise');
    if (!card) return;
    const date = workoutDate.value || todayISO();
    const w = ensureWorkout(date);
    const ei = Number(card.dataset.ei);

    if (e.target.classList.contains('exercise-name')) return;

    if (row && e.target.dataset.field) {
      const si = Number(row.dataset.si);
      const field = e.target.dataset.field;
      w.exercises[ei].sets[si][field] = e.target.value;
      save();
    }
  });

  workoutList.addEventListener('blur', (e) => {
    if (!e.target.classList.contains('exercise-name')) return;
    const card = e.target.closest('.exercise');
    const ei = Number(card.dataset.ei);
    const date = workoutDate.value || todayISO();
    const w = ensureWorkout(date);
    const name = e.target.textContent.trim() || 'Exercise';
    w.exercises[ei].name = name;
    save();
  }, true);

  $('btnCapturePhoto').addEventListener('click', () => {
    $('cameraInput').click();
  });

  $('btnSelectPhoto').addEventListener('click', () => {
    $('photoInput').click();
  });

  async function handlePhotoSelect(file) {
    if (!file) return;
    
    const maxSize = 4 * 1024 * 1024;
    let blob = file;
    
    if (file.size > maxSize) {
      blob = await compressImage(file);
    }
    
    showPhotoPreview(blob);
  }

  async function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1200;
        let { width, height } = img;
        
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = (height / width) * maxDim;
            width = maxDim;
          } else {
            width = (width / height) * maxDim;
            height = maxDim;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  $('photoInput').addEventListener('change', (e) => {
    handlePhotoSelect(e.target.files?.[0]);
    e.target.value = '';
  });

  $('cameraInput').addEventListener('change', (e) => {
    handlePhotoSelect(e.target.files?.[0]);
    e.target.value = '';
  });

  photoPreview.addEventListener('click', (e) => {
    if (e.target.id === 'btnRemovePhoto' || e.target.closest('#btnRemovePhoto')) {
      clearPhotoPreview();
    }
  });

  $('btnAnalyzePhoto').addEventListener('click', async () => {
    if (!currentPhotoBlob) return;
    
    const btn = $('btnAnalyzePhoto');
    const originalText = btn.textContent;
    btn.textContent = 'Analyzing...';
    btn.disabled = true;
    
    try {
      const result = await analyzePhotoWithAI(currentPhotoBlob);
      if (result) {
        if (result.description && !$('mealDesc').value.trim()) {
          $('mealDesc').value = result.description;
        }
        if (result.kcal != null) $('mealKcal').value = Math.round(result.kcal);
        if (result.protein != null) $('mealProtein').value = Math.round(result.protein * 10) / 10;
        if (result.carbs != null) $('mealCarbs').value = Math.round(result.carbs * 10) / 10;
        if (result.fat != null) $('mealFat').value = Math.round(result.fat * 10) / 10;
      } else {
        alert('Could not analyze the photo. Try a clearer image or enter macros manually.');
      }
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  $('btnAddMeal').addEventListener('click', async () => {
    const desc = $('mealDesc').value.trim();
    if (!desc) {
      alert('Please add a description for the meal.');
      return;
    }
    
    const date = foodDate.value || todayISO();
    const kcalVal = $('mealKcal').value;
    const protVal = $('mealProtein').value;
    const carbsVal = $('mealCarbs').value;
    const fatVal = $('mealFat').value;
    
    const meal = {
      id: uid(),
      desc,
      kcal: kcalVal === '' ? null : Number(kcalVal),
      protein: protVal === '' ? null : Number(protVal),
      carbs: carbsVal === '' ? null : Number(carbsVal),
      fat: fatVal === '' ? null : Number(fatVal),
      photoId: null
    };
    
    if (currentPhotoBlob && currentPhotoId) {
      await savePhoto(currentPhotoId, currentPhotoBlob);
      meal.photoId = currentPhotoId;
    }
    
    ensureMeals(date).push(meal);
    
    $('mealDesc').value = '';
    $('mealKcal').value = '';
    $('mealProtein').value = '';
    $('mealCarbs').value = '';
    $('mealFat').value = '';
    clearPhotoPreview();
    
    save();
    renderFood();
  });

  mealList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="del-meal"]');
    if (!btn) return;
    const row = btn.closest('.meal');
    const i = Number(row.dataset.i);
    const date = foodDate.value || todayISO();
    const meals = ensureMeals(date);
    const meal = meals[i];
    
    if (meal?.photoId) {
      try {
        await deletePhoto(meal.photoId);
      } catch {}
    }
    
    meals.splice(i, 1);
    save();
    renderFood();
  });

  foodHistory.addEventListener('click', (e) => {
    const row = e.target.closest('.history-row');
    if (!row) return;
    const date = row.dataset.date;
    if (date) {
      foodDate.value = date;
      renderFood();
    }
  });

  const profileFields = [
    { id: 'profileAge', key: 'age', type: 'number' },
    { id: 'profileBirthMonth', key: 'birthMonth', type: 'number' },
    { id: 'profileHeight', key: 'height', type: 'number' },
    { id: 'profileWeight', key: 'weight', type: 'number' },
    { id: 'profileEthnicity', key: 'ethnicity', type: 'text' },
    { id: 'profileGoals', key: 'goals', type: 'text' },
    { id: 'profileProteinTarget', key: 'proteinTarget', type: 'text' },
    { id: 'profileDietNotes', key: 'dietNotes', type: 'text' },
    { id: 'profileWorkSchedule', key: 'workSchedule', type: 'text' },
    { id: 'profileScheduleNotes', key: 'scheduleNotes', type: 'text' },
    { id: 'profileGymDays', key: 'gymDays', type: 'text' },
    { id: 'profileStartDate', key: 'startDate', type: 'text' }
  ];

  profileFields.forEach(({ id, key, type }) => {
    $(id)?.addEventListener('input', (e) => {
      profile[key] = type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
      saveProfile();
    });
  });

  $('apiProvider').addEventListener('change', (e) => {
    const key = $('apiKey').value;
    saveApiSettings(e.target.value, key);
    analyzeSection.style.display = (key && currentPhotoBlob) ? 'flex' : 'none';
  });

  $('apiKey').addEventListener('input', (e) => {
    const provider = $('apiProvider').value;
    saveApiSettings(provider, e.target.value);
    analyzeSection.style.display = (e.target.value && currentPhotoBlob) ? 'flex' : 'none';
  });

  $('btnToggleKey').addEventListener('click', () => {
    const input = $('apiKey');
    const btn = $('btnToggleKey');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'Hide key';
    } else {
      input.type = 'password';
      btn.textContent = 'Show key';
    }
  });

  $('btnClearKey').addEventListener('click', () => {
    if (!confirm('Clear your API key?')) return;
    $('apiKey').value = '';
    saveApiSettings($('apiProvider').value, '');
    analyzeSection.style.display = 'none';
  });

  function renderAll() {
    renderTodayStrip();
    renderWorkout();
    renderFood();
    renderProfile();
  }

  syncDates();
  {
    const key = weekdayKey(workoutDate.value);
    if (key === 'monday' || key === 'wednesday' || key === 'friday') planDay.value = key;
  }

  initDB().then(() => {
    renderAll();
  }).catch(() => {
    renderAll();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
