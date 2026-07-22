/**
 * Logika Aplikasi Presensi & Honorarium GTT SMP THHK v5.1 (Security Patch)
 */

// SECURITY: HTML Escape utility untuk mencegah XSS
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// SECURITY: Brute Force Protection
let loginAttempts = 0;
let loginLockUntil = 0;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 30000; // 30 detik
const MIN_PASSWORD_LENGTH = 6;

// STATE APLIKASI
let state = {
  teachers: [],
  attendance: [],
  settings: {
    schoolName: "SMP THHK Tegal",
    schoolAddress: "Jalan Gurami, No. 6, Kota Tegal",
    principalName: "Sri Wahyuningsih, S.S., S.Pd",
    principalNip: "-",
    treasurerName: "Elsa Angraeni, S.T",
    treasurerNip: "-"
  },
  theme: "light",
  currentTab: "dashboard",
  currentUser: null
};

// SUPABASE CONFIGURATION
// Supabase JS expects the project base URL, not the REST endpoint URL.
const SUPABASE_URL = "https://ckhkummpclhlfofhkddi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNraGt1bW1wY2xobGZvZmhrZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzM0OTcsImV4cCI6MjA5ODgwOTQ5N30.wwBR7xRQiLUuezBG9iNcEcL7_rZSBphORnP7BPmEZT4";
let supabaseClient = null;

try {
  if (typeof window !== 'undefined' && window.supabase) {
    let cleanedUrl = SUPABASE_URL.trim();
    if (cleanedUrl.endsWith("/rest/v1/")) {
      cleanedUrl = cleanedUrl.substring(0, cleanedUrl.length - 9);
    } else if (cleanedUrl.endsWith("/rest/v1")) {
      cleanedUrl = cleanedUrl.substring(0, cleanedUrl.length - 8);
    }
    supabaseClient = window.supabase.createClient(cleanedUrl, SUPABASE_ANON_KEY);
  }
} catch (err) {
  console.error("Gagal menginisialisasi Supabase client:", err);
}

function isSupabaseConfigured() {
  return Boolean(
    supabaseClient &&
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("YOUR_SUPABASE_URL") &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")
  );
}

const SUPABASE_REQUEST_TIMEOUT_MS = 15000;
const SUPABASE_REQUEST_ATTEMPTS = 2;

function getSupabaseErrorMessage(error) {
  if (!error) return "Kesalahan tidak diketahui.";

  const parts = [error.message, error.details, error.hint]
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter((value, index, values) => values.indexOf(value) === index);

  if (error.code) parts.push(`Kode: ${error.code}`);
  return parts.join(" — ") || String(error);
}

function createSupabaseError(error, context) {
  const message = getSupabaseErrorMessage(error);
  const wrappedError = new Error(`${context}: ${message}`);
  wrappedError.code = error && error.code ? error.code : "SUPABASE_REQUEST_FAILED";
  wrappedError.originalError = error;
  return wrappedError;
}

async function runSupabaseRequest(requestFactory, context, attempts = SUPABASE_REQUEST_ATTEMPTS) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let timeoutId;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Waktu koneksi habis setelah ${SUPABASE_REQUEST_TIMEOUT_MS / 1000} detik.`));
        }, SUPABASE_REQUEST_TIMEOUT_MS);
      });

      const result = await Promise.race([requestFactory(), timeoutPromise]);
      clearTimeout(timeoutId);

      if (result && result.error) {
        throw createSupabaseError(result.error, context);
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : createSupabaseError(error, context);

      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, 600 * attempt));
      }
    }
  }

  if (lastError && !lastError.message.startsWith(`${context}:`)) {
    throw createSupabaseError(lastError, context);
  }

  throw lastError || new Error(`${context}: permintaan gagal.`);
}

// DYNAMIC LOADING OVERLAY
function showLoadingOverlay(show) {
  let overlay = document.getElementById("appLoadingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "appLoadingOverlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(15, 23, 42, 0.7)";
    overlay.style.backdropFilter = "blur(10px)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.color = "white";
    overlay.style.transition = "opacity 0.3s ease";
    overlay.style.fontFamily = "var(--font-primary)";
    overlay.innerHTML = `
      <div class="spinner" style="width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid var(--primary, #0d9488); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
      <h3 style="font-family: var(--font-title); font-weight: 600; font-size: 1.2rem;">Menghubungkan ke Database...</h3>
      <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Harap tunggu beberapa saat.</p>
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(overlay);
  }
  
  if (show) {
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "all";
    overlay.style.display = "flex";
  } else {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    setTimeout(() => { overlay.style.display = "none"; }, 300);
  }
}

// INITIALIZATION & DOM LOAD
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initDateDisplay();
  safeCreateIcons();
  
  showLoadingOverlay(true);
  await loadData();
  showLoadingOverlay(false);
  
  // Check login session status
  if (state.currentUser) {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("appMain").style.display = "flex";
    applyRoleConstraints();
  } else {
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("appMain").style.display = "none";
  }
  
  // Setup Tab Navigation
  setupTabs();
  
  // Render views
  renderAllViews();
  
  // Event listeners configuration
  setupEventListeners();
  
  // Initialize Signature Pad
  const sigCanvas = document.getElementById('signatureCanvas');
  if (sigCanvas) {
    signaturePadInstance = new SignaturePad(sigCanvas);
  }
});

// LOAD DATA
async function loadData() {
  // Load session from sessionStorage (theme and session are local)
  const session = sessionStorage.getItem("gtt_session");
  if (session) {
    state.currentUser = JSON.parse(session);
  }
  
  const localTheme = localStorage.getItem("gtt_theme");
  if (localTheme) state.theme = localTheme;
  
  if (!isSupabaseConfigured()) {
    console.log("Supabase belum dikonfigurasi. Menggunakan database local (localStorage).");
    loadDataFromStorage();
    return;
  }
  
  try {
    // Fetch independent datasets in parallel so a slow request does not block the others.
    const [settingsResult, teachersResult, attendanceResult] = await Promise.all([
      runSupabaseRequest(
        () => supabaseClient
          .from("settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle(),
        "Gagal mengambil pengaturan sekolah"
      ),
      runSupabaseRequest(
        () => supabaseClient
          .from("teachers")
          .select("*")
          .order("name", { ascending: true }),
        "Gagal mengambil data guru"
      ),
      runSupabaseRequest(
        () => supabaseClient
          .from("attendance")
          .select("*"),
        "Gagal mengambil data presensi"
      )
    ]);

    const settingsData = settingsResult.data;
    const teachersData = teachersResult.data;
    const attendanceData = attendanceResult.data;

    if (settingsData) {
      state.settings = {
        schoolName: settingsData.school_name,
        schoolAddress: settingsData.school_address,
        principalName: settingsData.principal_name,
        principalNip: settingsData.principal_nip,
        treasurerName: settingsData.treasurer_name,
        treasurerNip: settingsData.treasurer_nip
      };
    }
    
    if (teachersData) {
      state.teachers = teachersData.map((t, idx) => ({
        id: t.id,
        name: t.name,
        subject: t.subject,
        rate: Number(t.rate),
        transport: Number(t.transport),
        status: t.status,
        password: undefined // SECURITY: password tidak pernah disimpan di client state
      }));
    }
    
    if (attendanceData) {
      state.attendance = attendanceData.map(a => ({
        id: a.id,
        teacherId: a.teacher_id,
        date: a.date,
        status: a.status,
        jp: Number(a.jp),
        class: a.class,
        topic: a.topic,
        signature: a.signature || ''
      }));
    }
    
    sanitizeTeachersState();
  } catch (err) {
    console.error("Gagal mengambil data dari Supabase:", {
      message: err.message,
      code: err.code,
      originalError: err.originalError
    });
    alert(
      "Data online belum dapat dimuat. Aplikasi akan menggunakan data lokal sementara.\n\n" +
      "Penyebab: " + getSupabaseErrorMessage(err)
    );
    loadDataFromStorage();
  }
}

function loadDataFromStorage() {
  const localTeachers = localStorage.getItem("gtt_teachers");
  const localAttendance = localStorage.getItem("gtt_attendance");
  const localSettings = localStorage.getItem("gtt_settings");
  const localTheme = localStorage.getItem("gtt_theme");
  
  if (localTeachers) {
    const parsedTeachers = JSON.parse(localTeachers);
    const hasNewTeachers = parsedTeachers.some(t => t.name.includes("Anom Kudho") || t.name.includes("Brigita Ajeng"));
    if (!hasNewTeachers) {
      localStorage.removeItem("gtt_teachers");
      localStorage.removeItem("gtt_attendance");
      sessionStorage.removeItem("gtt_session");
      state.currentUser = null;
      state.teachers = [];
      state.attendance = [];
    } else {
      state.teachers = parsedTeachers;
    }
  }
  
  if (localAttendance && localStorage.getItem("gtt_teachers")) {
    state.attendance = JSON.parse(localAttendance);
  }
  
  if (localSettings) state.settings = JSON.parse(localSettings);
  if (localTheme) state.theme = localTheme;
  
  if (state.teachers.length === 0) {
    loadSampleData(false);
  }
  
  sanitizeTeachersState();
}

// SANITIZE SENSITIVE DATA FROM STATE — SECURITY: selalu hapus password
function sanitizeTeachersState() {
  state.teachers.forEach(t => {
    delete t.password;
  });
}

// SAVE DATA — SECURITY: password tidak pernah disimpan ke localStorage
function saveData() {
  const safeTeachers = state.teachers.map(t => {
    const copy = { ...t };
    delete copy.password;
    return copy;
  });
  localStorage.setItem("gtt_teachers", JSON.stringify(safeTeachers));
  localStorage.setItem("gtt_attendance", JSON.stringify(state.attendance));
  localStorage.setItem("gtt_settings", JSON.stringify(state.settings));
}

// THEME SYSTEM
function initTheme() {
  document.body.setAttribute("data-theme", state.theme);
  updateThemeUI();
}

function updateThemeUI() {
  const icon = document.getElementById("themeIcon");
  const text = document.getElementById("themeText");
  const mobBtn = document.getElementById("mobileThemeToggleBtn");
  
  if (state.theme === "dark") {
    if (icon) icon.setAttribute("data-lucide", "sun");
    if (text) text.textContent = "Mode Terang";
    if (mobBtn) {
      mobBtn.innerHTML = '<i data-lucide="sun"></i> <span>Mode Terang</span>';
    }
  } else {
    if (icon) icon.setAttribute("data-lucide", "moon");
    if (text) text.textContent = "Mode Gelap";
    if (mobBtn) {
      mobBtn.innerHTML = '<i data-lucide="moon"></i> <span>Mode Gelap</span>';
    }
  }
  safeCreateIcons();
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem("gtt_theme", state.theme);
  initTheme();
}

// FORMATTERS & HELPERS
function safeCreateIcons() {
  try {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } catch (err) {
    console.warn("Ikon gagal dimuat (Lucide offline):", err);
  }
}

// ====================================================
// SIGNATURE PAD CLASS
// ====================================================
class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drawing = false;
    this.isEmpty = true;
    this.lastX = 0;
    this.lastY = 0;
    
    this.ctx.strokeStyle = '#1a1a1a';
    this.ctx.lineWidth = 2.2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    this._resizeCanvas();
    this._bindEvents();
  }
  
  _resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = rect.width || 460;
    const cssHeight = 180;
    
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;
    this.canvas.style.width = cssWidth + 'px';
    this.canvas.style.height = cssHeight + 'px';
    
    this.ctx.scale(dpr, dpr);
    this.ctx.strokeStyle = '#1a1a1a';
    this.ctx.lineWidth = 2.2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }
  
  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }
  
  _bindEvents() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this._startDraw(e));
    this.canvas.addEventListener('mousemove', (e) => this._draw(e));
    this.canvas.addEventListener('mouseup', () => this._endDraw());
    this.canvas.addEventListener('mouseleave', () => this._endDraw());
    
    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._startDraw(e);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this._draw(e);
    }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._endDraw();
    });
  }
  
  _startDraw(e) {
    this.drawing = true;
    this.isEmpty = false;
    const pos = this._getPos(e);
    this.lastX = pos.x;
    this.lastY = pos.y;
    this.canvas.classList.add('active');
  }
  
  _draw(e) {
    if (!this.drawing) return;
    const pos = this._getPos(e);
    
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    
    this.lastX = pos.x;
    this.lastY = pos.y;
  }
  
  _endDraw() {
    this.drawing = false;
    this.canvas.classList.remove('active');
  }
  
  clear() {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    this.isEmpty = true;
  }
  
  toDataURL() {
    if (this.isEmpty) return '';
    return this.canvas.toDataURL('image/png');
  }
  
  loadFromDataURL(dataUrl) {
    if (!dataUrl) {
      this.clear();
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.clear();
      const dpr = window.devicePixelRatio || 1;
      this.ctx.drawImage(img, 0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
      this.isEmpty = false;
    };
    img.src = dataUrl;
  }
}

let signaturePadInstance = null;

function formatRupiah(number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0
  }).format(number);
}

function isLogInMonthYear(logDateStr, month, year) {
  if (!logDateStr) return false;
  const parts = String(logDateStr).split('-');
  if (parts.length < 2) return false;
  const logYear = Number(parts[0]);
  const logMonth = Number(parts[1]);
  return logMonth === Number(month) && logYear === Number(year);
}

function formatIndonesianDate(dateString) {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateString).toLocaleDateString('id-ID', options);
}

function initDateDisplay() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  
  document.getElementById("currentDateText").textContent = formatIndonesianDate(dateStr);
  document.getElementById("presensiTanggal").value = dateStr;
  document.getElementById("filterPresensiTanggal").value = dateStr;
  
  // Set default rekap & history month/year filter to current
  const currentMonthVal = today.getMonth() + 1;
  const currentYearVal = today.getFullYear();
  
  document.getElementById("rekapBulan").value = currentMonthVal;
  document.getElementById("rekapTahun").value = currentYearVal;
  
  const filterBulanEl = document.getElementById("filterPresensiBulan");
  const filterTahunEl = document.getElementById("filterPresensiTahun");
  if (filterBulanEl) filterBulanEl.value = currentMonthVal;
  if (filterTahunEl) filterTahunEl.value = currentYearVal;
}

// SAMPLE DATA GENERATOR
// SAMPLE DATA GENERATOR
async function loadSampleData(showAlert = true) {
  // Demo Teachers (Unique passwords assigned to each teacher)
  const sampleTeachers = [
    { id: "199003122022031001", name: "Anom Kudho Winanto, S.Sn.", subject: "Seni Budaya", rate: 50000, transport: 20000, status: "aktif", password: "anom312" },
    { id: "199208152021022002", name: "Brigita Ajeng Dwiandari, S.Pd", subject: "Matematika", rate: 50000, transport: 20000, status: "aktif", password: "brigita815" },
    { id: "199411202022032003", name: "Fransiska Virgiana M, S.Pd", subject: "Bahasa Indonesia", rate: 50000, transport: 20000, status: "aktif", password: "fransiska112" },
    { id: "198505102018031004", name: "Ismadi, S.Pd", subject: "Fisika", rate: 55000, transport: 25000, status: "aktif", password: "ismadi510" },
    { id: "198810052019052005", name: "WS. Inggried Budiarti, S.Pd", subject: "Informatika", rate: 50000, transport: 20000, status: "aktif", password: "inggried005" },
    { id: "199606142023022006", name: "Yunita Mentari Putri, S. Sn", subject: "Seni Budaya", rate: 45000, transport: 20000, status: "aktif", password: "yunita614" },
    { id: "198712252016031007", name: "Atmo Kusumo, S.Pd.", subject: "Penjasorkes", rate: 45000, transport: 20000, status: "aktif", password: "atmo225" }
  ];
  
  // Generate realistic attendance for the current month
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed
  const sampleAttendance = [];
  
  // Loop from day 1 to yesterday or today
  const endDay = today.getDate();
  for (let day = 1; day <= endDay; day++) {
    const currentDate = new Date(year, month, day);
    const dayOfWeek = currentDate.getDay();
    
    // Skip weekends (Sunday = 0, Saturday = 6)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    const dateStr = currentDate.toISOString().split('T')[0];
    
    // Assign attendance to teachers
    sampleTeachers.forEach(t => {
      // 90% probability of presence
      const rand = Math.random();
      let status = "Hadir";
      let jp = 0;
      let cl = "";
      let topic = "";
      
      if (rand > 0.95) {
        status = Math.random() > 0.5 ? "Sakit" : "Izin";
      } else if (rand > 0.92) {
        status = "Alpa";
      }
      
      if (status === "Hadir") {
        // Teachers usually teach 2, 4, or 6 hours a day
        const jpChoices = [2, 4, 6];
        jp = jpChoices[Math.floor(Math.random() * jpChoices.length)];
        
        // Random class
        const classes = ["VII-A", "VII-B", "VIII-A", "VIII-B", "IX-A", "IX-B"];
        cl = classes[Math.floor(Math.random() * classes.length)] + ", " + classes[Math.floor(Math.random() * classes.length)];
        
        // Topics based on subject
        const topics = {
          "Fisika": ["Materi Tekanan Zat Cair", "Hukum Pascal", "Listrik Statis", "Gelombang Mekanik"],
          "Bahasa Indonesia": ["Ulasan Teks Prosedur", "Menulis Puisi", "Membaca Berita Efektif", "Analisis Novel"],
          "Informatika": ["Logika Algoritma Dasar", "Desain Halaman Web", "Bahasa Pemrograman Python", "Sistem Jaringan Komputer"],
          "Bahasa Inggris": ["Tenses Grammar Practice", "Reading Narrative Text", "Speaking Conversation", "Writing Letter Mockup"],
          "Penjasorkes": ["Praktik Bola Basket", "Senam Lantai Kebugaran", "Teknik Lari Jarak Pendek", "Uji Atletik"],
          "Seni Budaya": ["Seni Rupa 2 Dimensi", "Menggambar Ilustrasi", "Harmonisasi Paduan Suara", "Karya Batik Tulis"],
          "Matematika": ["Persamaan Kuadrat", "Peluang Kejadian", "Teorema Pythagoras", "Geometri Ruang"]
        };
        
        const subjTopics = topics[t.subject] || ["Pembelajaran Kelas regular", "Evaluasi Harian"];
        topic = subjTopics[Math.floor(Math.random() * subjTopics.length)];
      }
      
      sampleAttendance.push({
        id: "sample_" + dateStr + "_" + t.id,
        teacherId: t.id,
        date: dateStr,
        status: status,
        jp: jp,
        class: cl,
        topic: topic
      });
    });
  }
  
  showLoadingOverlay(true);
  try {
    if (isSupabaseConfigured()) {
      // Clear existing first
      await supabaseClient.from("attendance").delete().neq("id", "");
      await supabaseClient.from("teachers").delete().neq("id", "");
      
      // Insert teachers via RPC (password akan di-hash di server)
      for (const t of sampleTeachers) {
        const { error: tErr } = await supabaseClient.rpc('upsert_teacher_with_hash', {
          p_id: t.id,
          p_name: t.name,
          p_subject: t.subject,
          p_rate: t.rate,
          p_transport: t.transport,
          p_status: t.status,
          p_password: t.password || "guru123"
        });
        if (tErr) throw tErr;
      }
      
      // Insert attendance in chunks/full list
      const { error: aErr } = await supabaseClient.from("attendance").insert(
        sampleAttendance.map(a => ({
          id: a.id,
          teacher_id: a.teacherId,
          date: a.date,
          status: a.status,
          jp: a.jp,
          class: a.class,
          topic: a.topic
        }))
      );
      if (aErr) throw aErr;
    }
    
    state.teachers = sampleTeachers;
    state.attendance = sampleAttendance;
    saveData();
    renderAllViews();
    
    if (showAlert) {
      alert("Berhasil memuat data sampel guru GTT dan data presensi bulan ini!");
    }
  } catch (err) {
    console.error("Gagal memuat data sampel ke Supabase:", err);
    alert("Gagal mengunggah data sampel ke database online: " + err.message);
  } finally {
    showLoadingOverlay(false);
  }
}
// ====================================================
// AUTHENTICATION & ROLE-BASED ROUTING HELPERS
// ====================================================

// SECURITY: Login guru via Supabase RPC (password di-hash server-side)
async function checkTeacherCredentials(usernameInput, passwordInput) {
  const username = usernameInput.trim().toLowerCase();
  const password = passwordInput.trim();
  
  if (isSupabaseConfigured()) {
    try {
      // SECURITY: Gunakan RPC agar password diverifikasi di server-side (hashed)
      const { data: matchedTeachers } = await runSupabaseRequest(
        () => supabaseClient.rpc('verify_teacher_login', {
          input_password: password
        }),
        "Gagal verifikasi password guru"
      );

      if (matchedTeachers && matchedTeachers.length > 0) {
        const teacher = matchedTeachers.find(t => {
          const parts = t.name.split(/\s+/);
          const firstWord = parts[0].replace(/[^a-zA-Z]/g, "").toLowerCase();
          if (firstWord === "ws") {
            const secondWord = parts[1] ? parts[1].replace(/[^a-zA-Z]/g, "").toLowerCase() : "";
            return username === "ws" || username === secondWord;
          }
          return username === firstWord;
        });
        if (teacher) return teacher;
      }
    } catch (err) {
      console.warn("Pemeriksaan password online gagal, mencoba pemeriksaan lokal:", err);
    }
  }
  
  // Fallback lokal: hanya cocokkan nama (password tidak tersedia di client)
  return state.teachers.find(teacher => {
    if (teacher.status !== "aktif") return false;
    
    const parts = teacher.name.split(/\s+/);
    const firstWord = parts[0].replace(/[^a-zA-Z]/g, "").toLowerCase();
    
    if (firstWord === "ws") {
      const secondWord = parts[1] ? parts[1].replace(/[^a-zA-Z]/g, "").toLowerCase() : "";
      return username === "ws" || username === secondWord;
    }
    
    return username === firstWord;
  });
}

async function login(usernameInput, passwordInput) {
  const username = usernameInput.trim().toLowerCase();
  const password = passwordInput.trim();
  const errorMsg = document.getElementById("loginErrorMessage");
  
  errorMsg.style.display = "none";
  
  // SECURITY: Brute force protection
  const now = Date.now();
  if (loginLockUntil > now) {
    const remainSec = Math.ceil((loginLockUntil - now) / 1000);
    errorMsg.textContent = `Terlalu banyak percobaan gagal. Coba lagi dalam ${remainSec} detik.`;
    errorMsg.style.display = "block";
    return;
  }
  
  showLoadingOverlay(true);
  
  try {
    // 1. Check Supabase Admins via RPC (hashed password)
    if (isSupabaseConfigured()) {
      const { data: adminRows } = await runSupabaseRequest(
        () => supabaseClient.rpc('verify_admin_login', {
          input_username: username,
          input_password: password
        }),
        "Gagal memeriksa akun admin"
      );
      
      if (adminRows && adminRows.length > 0) {
        const adminData = adminRows[0];
        state.currentUser = { role: "admin", name: adminData.name, id: adminData.username };
        sessionStorage.setItem("gtt_session", JSON.stringify(state.currentUser));
        loginAttempts = 0; // Reset counter on success
        onLoginSuccess();
        return;
      }
    } else {
      // Fallback local admin check (hanya jika Supabase tidak dikonfigurasi)
      if (username === "admin" && password === "admin123") {
        state.currentUser = { role: "admin", name: "Admin THHK", id: "admin" };
        sessionStorage.setItem("gtt_session", JSON.stringify(state.currentUser));
        loginAttempts = 0;
        onLoginSuccess();
        return;
      }
      
      if (username === "elsa" && password === "admin123") {
        state.currentUser = { role: "admin", name: "Elsa Angreani, S.T", id: "elsa" };
        sessionStorage.setItem("gtt_session", JSON.stringify(state.currentUser));
        loginAttempts = 0;
        onLoginSuccess();
        return;
      }
    }
    
    // 2. Check Teacher via RPC
    const teacher = await checkTeacherCredentials(usernameInput, passwordInput);
    if (teacher) {
      state.currentUser = { role: "guru", name: teacher.name, id: teacher.id };
      sessionStorage.setItem("gtt_session", JSON.stringify(state.currentUser));
      loginAttempts = 0; // Reset counter on success
      onLoginSuccess();
      return;
    }
    
    // SECURITY: Increment brute force counter
    loginAttempts++;
    if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      loginLockUntil = Date.now() + LOGIN_LOCKOUT_MS;
      errorMsg.textContent = `Terlalu banyak percobaan gagal (${MAX_LOGIN_ATTEMPTS}x). Akun dikunci selama ${LOGIN_LOCKOUT_MS / 1000} detik.`;
      loginAttempts = 0; // Reset setelah lockout di-set
    } else {
      const remaining = MAX_LOGIN_ATTEMPTS - loginAttempts;
      errorMsg.textContent = `Username atau password salah! Sisa percobaan: ${remaining}`;
    }
    errorMsg.style.display = "block";
  } catch (err) {
    console.error("Gagal melakukan login:", {
      message: err.message,
      code: err.code,
      originalError: err.originalError
    });
    alert(
      "Login online belum dapat diproses. Periksa koneksi internet lalu coba lagi.\n\n" +
      "Penyebab: " + getSupabaseErrorMessage(err)
    );
  } finally {
    showLoadingOverlay(false);
  }
}

function onLoginSuccess() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appMain").style.display = "flex";
  
  sanitizeTeachersState();
  saveData();
  applyRoleConstraints();
  renderAllViews();
}

function logout() {
  state.currentUser = null;
  sessionStorage.removeItem("gtt_session");
  
  document.getElementById("appMain").style.display = "none";
  document.getElementById("loginScreen").style.display = "flex";
  
  document.getElementById("loginForm").reset();
  document.getElementById("loginErrorMessage").style.display = "none";
  
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

function applyRoleConstraints() {
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  
  const adminItems = document.querySelectorAll(".admin-only");
  adminItems.forEach(item => {
    if (isGuru) {
      item.classList.add("hidden");
    } else {
      item.classList.remove("hidden");
    }
  });
  
  const rekapLabel = document.getElementById("rekapTabLabel");
  if (isGuru) {
    rekapLabel.textContent = "Slip Gaji Saya";
  } else {
    rekapLabel.textContent = "Rekap & Gaji";
  }
  
  const userAvatar = document.getElementById("sidebarUserAvatar");
  const userName = document.getElementById("sidebarUserName");
  const userRole = document.getElementById("sidebarUserRole");
  
  const mobAvatar = document.getElementById("mobileUserAvatar");
  const mobModalAvatar = document.getElementById("mobileModalUserAvatar");
  const mobModalName = document.getElementById("mobileModalUserName");
  const mobModalRole = document.getElementById("mobileModalUserRole");
  
  if (state.currentUser) {
    const roleText = state.currentUser.role === "admin" ? "Tata Usaha" : "Guru GTT";
    userName.textContent = state.currentUser.name;
    userRole.textContent = roleText;
    if (mobModalName) mobModalName.textContent = state.currentUser.name;
    if (mobModalRole) mobModalRole.textContent = roleText;
    
    const initials = state.currentUser.name.split(/\s+/).map(p => p[0]).join("").substring(0, 2).toUpperCase();
    userAvatar.textContent = initials;
    if (mobAvatar) mobAvatar.textContent = initials;
    if (mobModalAvatar) mobModalAvatar.textContent = initials;
  }
  
  if (isGuru && (state.currentTab === "guru" || state.currentTab === "pengaturan")) {
    document.querySelector('.nav-link[data-tab="dashboard"]').click();
  }
}

function renderTeacherDashboardChart(teacherId, myMonthLogs) {
  const ctx = document.getElementById("teachingHoursChart").getContext("2d");
  
  const classJP = {};
  myMonthLogs.forEach(log => {
    if (log.status === "Hadir" && log.class) {
      const clsParts = log.class.split(/,\s*/);
      clsParts.forEach(cls => {
        if (!classJP[cls]) classJP[cls] = 0;
        classJP[cls] += Math.round(Number(log.jp) / clsParts.length);
      });
    }
  });
  
  const labels = Object.keys(classJP);
  const data = Object.values(classJP);
  
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  const isDark = document.body.getAttribute("data-theme") === "dark";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)";
  const textColor = isDark ? "#94a3b8" : "#64748b";
  
  try {
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length > 0 ? labels : ["Belum Mengajar"],
        datasets: [{
          label: 'Jam Pelajaran (JP)',
          data: data.length > 0 ? data : [0],
          backgroundColor: 'rgba(14, 165, 233, 0.75)',
          borderColor: 'rgba(14, 165, 233, 1)',
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) { return ` ${context.parsed.y} JP di kelas ini`; }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans' }, precision: 0 },
            beginAtZero: true
          }
        }
      }
    });
  } catch (err) {
    console.error("Gagal memuat grafik (Chart.js kemungkinan terblokir atau offline):", err);
  }
}

// ROUTING / TAB SYSTEMS
function setupTabs() {
  const links = document.querySelectorAll(".nav-link");
  const tabs = document.querySelectorAll(".tab-content");
  
  links.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      
      const tabId = link.getAttribute("data-tab");
      state.currentTab = tabId;
      
      // Update UI menu
      links.forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      
      // Show/Hide divs
      tabs.forEach(tab => {
        tab.classList.remove("active");
        if (tab.id === tabId) {
          tab.classList.add("active");
        }
      });
      
      // Update Headers
      updateHeaderTitle(tabId);
      
      // Render specific tab content if needed
      renderTabSpecific(tabId);
    });
  });
}

function updateHeaderTitle(tabId) {
  const title = document.getElementById("pageTitle");
  const subtitle = document.getElementById("pageSubtitle");
  const mobileTitle = document.getElementById("mobilePageTitle");
  
  let mainTitle = "Dashboard Utama";
  let shortTitle = "Dashboard";
  let subText = "Ringkasan statistik kehadiran & honorarium GTT bulan ini.";
  
  switch(tabId) {
    case "dashboard":
      mainTitle = "Dashboard Utama";
      shortTitle = "Dashboard";
      subText = "Ringkasan statistik kehadiran & honorarium GTT bulan ini.";
      break;
    case "guru":
      mainTitle = "Manajemen Data Guru";
      shortTitle = "Data Guru";
      subText = "Kelola data profil, mata pelajaran, serta tarif honorarium GTT.";
      break;
    case "presensi":
      mainTitle = "Input Presensi & KBM";
      shortTitle = "Input Presensi";
      subText = "Catat kehadiran harian, jam pelajaran (JP), dan materi kelas.";
      break;
    case "rekap":
      mainTitle = "Rekapitulasi & Honorarium";
      shortTitle = "Rekap & Gaji";
      subText = "Laporan kehadiran bulanan dan perhitungan honor otomatis.";
      break;
    case "pengaturan":
      mainTitle = "Pengaturan Aplikasi";
      shortTitle = "Pengaturan";
      subText = "Konfigurasi instansi sekolah, penandatangan slip, dan database.";
      break;
  }
  
  if (title) title.textContent = mainTitle;
  if (subtitle) subtitle.textContent = subText;
  if (mobileTitle) mobileTitle.textContent = shortTitle;
}

function renderTabSpecific(tabId) {
  if (tabId === "dashboard") {
    renderDashboard();
  } else if (tabId === "guru") {
    renderGuruList();
  } else if (tabId === "presensi") {
    renderPresensiForm();
    renderDetailedLogs();
  } else if (tabId === "rekap") {
    renderRekapTable();
  } else if (tabId === "pengaturan") {
    renderSettingsForm();
  }
}

function renderAllViews() {
  renderDashboard();
  renderGuruList();
  renderPresensiForm();
  renderDetailedLogs();
  renderRekapTable();
  renderSettingsForm();
}

// ----------------------------------------------------
// 1. DASHBOARD VIEW FUNCTIONS
// ----------------------------------------------------
let chartInstance = null;

function renderDashboard() {
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  
  const totalGuruCard = document.querySelector(".stat-card.primary");
  const presenceCard = document.querySelector(".stat-card.secondary");
  const jpCard = document.querySelector(".stat-card.accent");
  const salaryCard = document.querySelector(".stat-card.success");
  
  // Update stats
  const activeTeachers = state.teachers.filter(t => t.status === "aktif");
  
  // Attendance today
  const todayStr = new Date().toISOString().split('T')[0];
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const currentYear = today.getFullYear();
  
  const currentMonthLogs = state.attendance.filter(log => {
    return isLogInMonthYear(log.date, currentMonth, currentYear);
  });
  
  if (isGuru) {
    const teacherId = state.currentUser.id;
    const teacher = state.teachers.find(t => t.id === teacherId) || { name: state.currentUser.name, subject: "-", rate: 0, transport: 0 };
    
    // Stat Card 1: Mapel & Tarif
    totalGuruCard.querySelector(".stat-label").textContent = "Mata Pelajaran";
    totalGuruCard.querySelector(".stat-value").textContent = teacher.subject;
    totalGuruCard.querySelector(".stat-desc").textContent = `Tarif: ${formatRupiah(teacher.rate)} /JP`;
    
    // Stat Card 2: Kehadiran Anda
    presenceCard.querySelector(".stat-label").textContent = "Kehadiran Anda";
    const myMonthLogs = currentMonthLogs.filter(log => log.teacherId === teacherId);
    const myHadir = myMonthLogs.filter(log => log.status === "Hadir").length;
    const myTotalDays = myMonthLogs.length;
    const myPct = myTotalDays > 0 ? Math.round((myHadir / myTotalDays) * 100) : 0;
    presenceCard.querySelector(".stat-value").textContent = `${myPct}%`;
    
    // We update content directly bypassing the child id constraint since there is no admin activeCount ratio
    const descEl = presenceCard.querySelector(".stat-desc");
    descEl.textContent = `${myHadir} Hadir dari ${myTotalDays} Hari Aktif`;
    descEl.removeAttribute("id"); // Remove id to avoid logic collisions
    
    // Stat Card 3: JP Anda
    const myJP = myMonthLogs.filter(log => log.status === "Hadir").reduce((sum, log) => sum + Number(log.jp), 0);
    jpCard.querySelector(".stat-label").textContent = "JP Anda Bulan Ini";
    jpCard.querySelector(".stat-value").textContent = `${myJP} JP`;
    jpCard.querySelector(".stat-desc").textContent = "Jam Pelajaran diajar";
    
    // Stat Card 4: Estimasi Gaji Anda
    const myHonor = (myJP * Number(teacher.rate)) + (myHadir * Number(teacher.transport));
    salaryCard.querySelector(".stat-label").textContent = "Honor Anda Bulan Ini";
    salaryCard.querySelector(".stat-value").textContent = formatRupiah(myHonor);
    
    // Quick logs: GTT's own logs for today
    const todayLogs = state.attendance.filter(log => log.date === todayStr && log.teacherId === teacherId);
    renderQuickAttendanceLogs(todayStr, todayLogs);
    
    // GTT teaching breakdown chart
    renderTeacherDashboardChart(teacherId, myMonthLogs);
  } else {
    // Admin global stats
    totalGuruCard.querySelector(".stat-label").textContent = "Total Guru GTT";
    totalGuruCard.querySelector(".stat-value").textContent = activeTeachers.length;
    totalGuruCard.querySelector(".stat-desc").textContent = "Orang Terdaftar";
    
    presenceCard.querySelector(".stat-label").textContent = "Presensi Hari Ini";
    const todayLogsAll = state.attendance.filter(log => log.date === todayStr);
    const activeCount = activeTeachers.length;
    
    let presencePercentage = 0;
    if (activeCount > 0) {
      const presentToday = todayLogsAll.filter(log => log.status === "Hadir").length;
      presencePercentage = Math.round((presentToday / activeCount) * 100);
      
      const descEl = presenceCard.querySelector(".stat-desc");
      descEl.textContent = `${presentToday} dari ${activeCount} Guru Hadir`;
      descEl.setAttribute("id", "statPresensiRatio");
    } else {
      const descEl = presenceCard.querySelector(".stat-desc");
      descEl.textContent = "Tidak ada guru aktif";
      descEl.setAttribute("id", "statPresensiRatio");
    }
    presenceCard.querySelector(".stat-value").textContent = presencePercentage + "%";
    
    const totalJP = currentMonthLogs.reduce((sum, log) => sum + (log.status === "Hadir" ? Number(log.jp) : 0), 0);
    jpCard.querySelector(".stat-label").textContent = "JP Bulan Ini";
    jpCard.querySelector(".stat-value").textContent = totalJP + " JP";
    jpCard.querySelector(".stat-desc").textContent = "Jam Pelajaran";
    
    let totalPayroll = 0;
    activeTeachers.forEach(teacher => {
      const teacherLogs = currentMonthLogs.filter(log => log.teacherId === teacher.id);
      const daysPresent = teacherLogs.filter(log => log.status === "Hadir").length;
      const hoursTaught = teacherLogs.reduce((sum, log) => sum + (log.status === "Hadir" ? Number(log.jp) : 0), 0);
      
      totalPayroll += (hoursTaught * Number(teacher.rate)) + (daysPresent * Number(teacher.transport));
    });
    
    salaryCard.querySelector(".stat-label").textContent = "Estimasi Honor";
    salaryCard.querySelector(".stat-value").textContent = formatRupiah(totalPayroll);
    
    // Quick logs: all logs today
    renderQuickAttendanceLogs(todayStr, todayLogsAll);
    
    // Global bar chart
    renderDashboardChart(activeTeachers, currentMonthLogs);
  }
}

function renderQuickAttendanceLogs(dateStr, todayLogs) {
  const container = document.getElementById("quickAttendanceList");
  container.innerHTML = "";
  
  if (todayLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="clipboard-list"></i>
        <p>Belum ada data presensi hari ini (${formatIndonesianDate(dateStr)}).</p>
      </div>
    `;
    safeCreateIcons();
    return;
  }
  
  // Sort logs by date desc / time
  todayLogs.forEach(log => {
    const teacher = state.teachers.find(t => t.id === log.teacherId);
    if (!teacher) return;
    
    const div = document.createElement("div");
    div.className = "recent-log-item";
    div.innerHTML = `
      <div class="log-info-meta">
        <span class="log-teacher-name">${escapeHTML(teacher.name)}</span>
        <span class="log-subject-jp">${escapeHTML(teacher.subject)} • ${log.status === 'Hadir' ? log.jp + ' JP (' + escapeHTML(log.class) + ')' : 'Tidak Mengajar'}</span>
      </div>
      <div>
        <span class="badge badge-${escapeHTML(log.status).toLowerCase()}">${escapeHTML(log.status)}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderDashboardChart(activeTeachers, currentMonthLogs) {
  const ctx = document.getElementById("teachingHoursChart").getContext("2d");
  
  // Prepare data
  const labels = activeTeachers.map(t => t.name.split(',')[0]); // Shorten names by removing degrees
  const data = activeTeachers.map(t => {
    const tLogs = currentMonthLogs.filter(log => log.teacherId === t.id && log.status === "Hadir");
    return tLogs.reduce((sum, log) => sum + Number(log.jp), 0);
  });
  
  // Destroy old instance
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  const isDark = document.body.getAttribute("data-theme") === "dark";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)";
  const textColor = isDark ? "#94a3b8" : "#64748b";
  
  try {
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Jam Pelajaran (JP)',
          data: data,
          backgroundColor: 'rgba(13, 148, 136, 0.75)',
          borderColor: 'rgba(13, 148, 136, 1)',
          borderWidth: 1,
          borderRadius: 6,
          hoverBackgroundColor: 'rgba(13, 148, 136, 0.95)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` ${context.parsed.y} JP diajarkan`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans' }, precision: 0 },
            beginAtZero: true
          }
        }
      }
    });
  } catch (err) {
    console.error("Gagal memuat grafik (Chart.js kemungkinan terblokir atau offline):", err);
  }
}

// ----------------------------------------------------
// 2. GURU (TEACHER) VIEW FUNCTIONS
// ----------------------------------------------------
function renderGuruList() {
  const tbody = document.getElementById("guruTableBody");
  tbody.innerHTML = "";
  
  const searchQuery = document.getElementById("searchGuruInput").value.toLowerCase();
  
  const filtered = state.teachers.filter(teacher => {
    return teacher.name.toLowerCase().includes(searchQuery) || 
           teacher.id.toLowerCase().includes(searchQuery) ||
           teacher.subject.toLowerCase().includes(searchQuery);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center">
          <div class="empty-state">
            <i data-lucide="users-round"></i>
            <p>Guru GTT tidak ditemukan atau data kosong.</p>
          </div>
        </td>
      </tr>
    `;
    safeCreateIcons();
    return;
  }
  
  filtered.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHTML(t.id)}</td>
      <td class="font-bold">${escapeHTML(t.name)}</td>
      <td>${escapeHTML(t.subject)}</td>
      <td>${formatRupiah(t.rate)} /JP</td>
      <td>${formatRupiah(t.transport)} /Hadir</td>
      <td><span class="badge badge-${t.status === 'aktif' ? 'active' : 'inactive'}">${escapeHTML(t.status)}</span></td>
      <td class="text-right">
        <div class="actions-cell" style="justify-content: flex-end;">
          <button class="icon-btn edit" onclick="editTeacher('${escapeHTML(t.id)}')" title="Edit Data">
            <i data-lucide="edit-3"></i>
          </button>
          <button class="icon-btn delete" onclick="deleteTeacher('${escapeHTML(t.id)}')" title="Hapus Data">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  safeCreateIcons();
}

// Edit & Add Dialog
function openGuruModal(isEdit = false, id = null) {
  const modal = document.getElementById("guruModal");
  const modalTitle = document.getElementById("guruModalTitle");
  const form = document.getElementById("guruForm");
  
  form.reset();
  
  if (isEdit && id) {
    modalTitle.textContent = "Edit Data Guru GTT";
    const teacher = state.teachers.find(t => t.id === id);
    if (teacher) {
      document.getElementById("guruIndex").value = teacher.id; // Store editing ID in index field
      document.getElementById("guruNuptk").value = teacher.id;
      document.getElementById("guruNuptk").disabled = true; // Block ID editing
      document.getElementById("guruNama").value = teacher.name;
      document.getElementById("guruMapel").value = teacher.subject;
      document.getElementById("guruRate").value = teacher.rate;
      document.getElementById("guruTransport").value = teacher.transport;
      document.getElementById("guruStatus").value = teacher.status;
      document.getElementById("guruPassword").value = "";
      document.getElementById("guruPassword").placeholder = "Masukkan password baru (min. 6 karakter)";
    }
  } else {
    modalTitle.textContent = "Tambah Data Guru GTT";
    document.getElementById("guruIndex").value = "";
    document.getElementById("guruNuptk").disabled = false;
    document.getElementById("guruPassword").value = generateRandomPassword(8);
  }
  
  // Reset password visibility mode to hidden (password)
  const guruPassInput = document.getElementById("guruPassword");
  const guruPassToggleBtn = document.getElementById("toggleGuruPassword");
  if (guruPassInput) guruPassInput.type = "password";
  if (guruPassToggleBtn) {
    guruPassToggleBtn.innerHTML = '<i data-lucide="eye"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  modal.classList.add("active");
}

function closeGuruModal() {
  document.getElementById("guruModal").classList.remove("active");
}

window.editTeacher = function(id) {
  openGuruModal(true, id);
};

window.deleteTeacher = async function(id) {
  if (confirm(`Apakah Anda yakin ingin menghapus data guru dengan ID/NUPTK: ${id}? Seluruh data presensi guru tersebut juga akan terhapus.`)) {
    showLoadingOverlay(true);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabaseClient
          .from("teachers")
          .delete()
          .eq("id", id);
        if (error) throw error;
      }
      
      // Remove teacher
      state.teachers = state.teachers.filter(t => t.id !== id);
      // Remove related attendance logs
      state.attendance = state.attendance.filter(log => log.teacherId !== id);
      
      saveData();
      renderAllViews();
      alert("Data guru berhasil dihapus!");
    } catch (err) {
      console.error("Gagal menghapus data guru:", err);
      alert("Gagal menghapus dari database: " + err.message);
    } finally {
      showLoadingOverlay(false);
    }
  }
};

// ----------------------------------------------------
// 3. PRESENSI (ATTENDANCE) VIEW FUNCTIONS
// ----------------------------------------------------
function renderPresensiForm() {
  const select = document.getElementById("presensiGuru");
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  
  const selectedVal = select.value;
  select.innerHTML = '<option value="">-- Pilih Guru --</option>';
  
  if (isGuru) {
    const teacherId = state.currentUser.id;
    const teacher = state.teachers.find(t => String(t.id) === String(teacherId)) || { id: teacherId, name: state.currentUser.name, subject: "-" };
    
    const opt = document.createElement("option");
    opt.value = teacher.id;
    opt.textContent = `${teacher.name} (${teacher.subject})`;
    select.appendChild(opt);
    
    select.value = teacher.id;
    select.disabled = true; // Lock choice for GTT
  } else {
    const activeTeachers = state.teachers.filter(t => t.status === "aktif");
    
    activeTeachers.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.subject})`;
      select.appendChild(opt);
    });
    
    select.disabled = false;
    if (selectedVal) select.value = selectedVal;
  }
}

function renderDetailedLogs() {
  const container = document.getElementById("detailLogsList");
  container.innerHTML = "";
  
  const modeEl = document.getElementById("filterPresensiMode");
  const mode = modeEl ? modeEl.value : "bulanan";
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  
  const monthWrapper = document.getElementById("filterPresensiBulanWrapper");
  const dateWrapper = document.getElementById("filterPresensiTanggalWrapper");
  const summaryBox = document.getElementById("presensiHistorySummary");
  
  let filteredLogs = [];
  let periodTitleText = "";
  
  if (mode === "harian") {
    if (monthWrapper) monthWrapper.style.display = "none";
    if (dateWrapper) dateWrapper.style.display = "block";
    
    const selectedDate = document.getElementById("filterPresensiTanggal").value;
    filteredLogs = state.attendance.filter(log => log.date === selectedDate);
    periodTitleText = `Presensi ${formatIndonesianDate(selectedDate)}`;
  } else {
    // Monthly mode (default)
    if (monthWrapper) monthWrapper.style.display = "flex";
    if (dateWrapper) dateWrapper.style.display = "none";
    
    const filterMonth = Number(document.getElementById("filterPresensiBulan").value);
    const filterYear = Number(document.getElementById("filterPresensiTahun").value);
    const monthsIndo = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    
    filteredLogs = state.attendance.filter(log => isLogInMonthYear(log.date, filterMonth, filterYear));
    periodTitleText = `Histori Bulan ${monthsIndo[filterMonth - 1]} ${filterYear}`;
  }
  
  if (isGuru) {
    filteredLogs = filteredLogs.filter(log => log.teacherId === state.currentUser.id);
  }
  
  // Sort logs by date descending (newest first)
  filteredLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // Summary Stats
  const countHadir = filteredLogs.filter(l => l.status === "Hadir").length;
  const totalJP = filteredLogs.filter(l => l.status === "Hadir").reduce((sum, l) => sum + Number(l.jp), 0);
  const countSakit = filteredLogs.filter(l => l.status === "Sakit").length;
  const countIzin = filteredLogs.filter(l => l.status === "Izin").length;
  const countAlpa = filteredLogs.filter(l => l.status === "Alpa").length;
  
  if (summaryBox) {
    document.getElementById("summaryText").textContent = periodTitleText;
    document.getElementById("summaryBadges").innerHTML = `
      <span class="badge badge-active" style="font-size: 0.75rem;">${countHadir} Hadir (${totalJP} JP)</span>
      ${countSakit > 0 ? `<span class="badge badge-warning" style="font-size: 0.75rem;">${countSakit} Sakit</span>` : ''}
      ${countIzin > 0 ? `<span class="badge badge-info" style="font-size: 0.75rem;">${countIzin} Izin</span>` : ''}
      ${countAlpa > 0 ? `<span class="badge badge-inactive" style="font-size: 0.75rem;">${countAlpa} Alpa</span>` : ''}
    `;
  }
  
  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-x"></i>
        <p>Tidak ada riwayat presensi untuk periode ini.</p>
      </div>
    `;
    safeCreateIcons();
    return;
  }
  
  filteredLogs.forEach(log => {
    const teacher = state.teachers.find(t => t.id === log.teacherId);
    const teacherName = teacher ? teacher.name : "Guru Terhapus";
    const subject = teacher ? teacher.subject : "-";
    
    const div = document.createElement("div");
    div.className = "recent-log-item";
    div.style.flexDirection = 'column';
    div.style.alignItems = 'stretch';
    div.style.gap = '6px';
    
    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div class="log-info-meta" style="flex:1;">
          <span class="log-teacher-name" style="font-size: 0.95rem;">${escapeHTML(teacherName)}</span>
          <span class="log-subject-jp" style="font-size: 0.8rem;">
            ${formatIndonesianDate(log.date)} • ${escapeHTML(subject)} • <strong class="text-primary-color">${escapeHTML(log.status)}</strong> 
            ${log.status === 'Hadir' ? '• ' + log.jp + ' JP • Kelas: ' + escapeHTML(log.class || '-') : ''}
          </span>
          ${log.status === 'Hadir' && log.topic ? `<span class="log-date-time" style="font-size: 0.75rem; margin-top:2px;">KBM: "${escapeHTML(log.topic)}"</span>` : ''}
        </div>
        <span class="badge badge-${escapeHTML(log.status).toLowerCase()}">${escapeHTML(log.status)}</span>
        ${(!isGuru || (state.currentUser && state.currentUser.role === 'admin')) ? `
          <div class="actions-cell">
            <button class="icon-btn edit" onclick="editLog('${escapeHTML(log.id)}')" title="Edit Presensi">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="icon-btn delete" onclick="deleteLog('${escapeHTML(log.id)}')" title="Hapus Presensi">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        ` : ''}
      </div>
      ${log.signature ? `<div style="display:flex;align-items:center;gap:6px;margin-top:2px;"><span style="font-size:.66rem;color:var(--text-muted);">TTD:</span><img src="${escapeHTML(log.signature)}" alt="Tanda tangan" class="signature-preview"></div>` : ''}
    `;
    container.appendChild(div);
  });
  
  safeCreateIcons();
}

window.editLog = function(id) {
  const log = state.attendance.find(l => l.id === id);
  if (!log) return;
  
  document.getElementById("presensiId").value = log.id;
  document.getElementById("presensiTanggal").value = log.date;
  document.getElementById("presensiGuru").value = log.teacherId;
  document.getElementById("presensiStatus").value = log.status;
  document.getElementById("presensiJP").value = log.jp;
  document.getElementById("presensiKelas").value = log.class || "";
  document.getElementById("presensiMateri").value = log.topic || "";
  
  // Load signature into pad
  if (signaturePadInstance) {
    signaturePadInstance.loadFromDataURL(log.signature || '');
  }
  
  // Enable or disable fields based on status
  togglePresensiFormFields(log.status);
  
  // Scroll to form on mobile/small screens
  document.getElementById("presensiForm").scrollIntoView({ behavior: 'smooth' });
};

window.deleteLog = async function(id) {
  if (confirm("Apakah Anda yakin ingin menghapus catatan presensi ini?")) {
    showLoadingOverlay(true);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabaseClient
          .from("attendance")
          .delete()
          .eq("id", id);
        if (error) throw error;
      }
      
      state.attendance = state.attendance.filter(log => log.id !== id);
      saveData();
      renderAllViews();
      alert("Catatan presensi berhasil dihapus!");
    } catch (err) {
      console.error("Gagal menghapus presensi:", err);
      alert("Gagal menghapus dari database: " + err.message);
    } finally {
      showLoadingOverlay(false);
    }
  }
};

function togglePresensiFormFields(status) {
  const jp = document.getElementById("presensiJP");
  const kelas = document.getElementById("presensiKelas");
  const materi = document.getElementById("presensiMateri");
  
  if (status === "Hadir") {
    jp.disabled = false;
    kelas.disabled = false;
    materi.disabled = false;
    if (jp.value == 0) jp.value = 2; // Default resetting from 0
  } else {
    jp.disabled = true;
    kelas.disabled = true;
    materi.disabled = true;
    jp.value = 0;
    kelas.value = "";
    materi.value = "";
  }
}

// ----------------------------------------------------
// 4. REKAPITULASI & PAYROLL (GAJI) VIEW FUNCTIONS
// ----------------------------------------------------
function renderRekapTable() {
  const tbody = document.getElementById("rekapTableBody");
  tbody.innerHTML = "";
  
  const filterMonth = Number(document.getElementById("rekapBulan").value);
  const filterYear = Number(document.getElementById("rekapTahun").value);
  
  // Filter logs for selected Month and Year
  const monthlyLogs = state.attendance.filter(log => isLogInMonthYear(log.date, filterMonth, filterYear));
  
  if (state.teachers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center">
          <div class="empty-state">
            <i data-lucide="wallet"></i>
            <p>Data guru kosong. Silakan tambahkan guru terlebih dahulu.</p>
          </div>
        </td>
      </tr>
    `;
    safeCreateIcons();
    return;
  }
  
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  let teachersToShow = state.teachers;
  if (isGuru) {
    teachersToShow = state.teachers.filter(t => t.id === state.currentUser.id);
  }
  
  teachersToShow.forEach(teacher => {
    const teacherLogs = monthlyLogs.filter(log => log.teacherId === teacher.id);
    
    // Status counts
    const countHadir = teacherLogs.filter(log => log.status === "Hadir").length;
    const countSakit = teacherLogs.filter(log => log.status === "Sakit").length;
    const countIzin = teacherLogs.filter(log => log.status === "Izin").length;
    const countAlpa = teacherLogs.filter(log => log.status === "Alpa").length;
    
    const totalJP = teacherLogs.reduce((sum, log) => sum + (log.status === "Hadir" ? Number(log.jp) : 0), 0);
    
    // Calc values
    const honorJP = totalJP * Number(teacher.rate);
    const uangTransport = countHadir * Number(teacher.transport);
    const grandTotal = honorJP + uangTransport;
    
    const countOther = countSakit + countIzin + countAlpa;
    const otherSummaryStr = countOther > 0 ? `${countSakit}S/${countIzin}I/${countAlpa}A` : '-';
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-bold">${escapeHTML(teacher.name)}</td>
      <td class="text-right">${countHadir} hari</td>
      <td class="text-right text-muted" style="font-size: 0.8rem;">${otherSummaryStr}</td>
      <td class="text-right">${totalJP} JP</td>
      <td class="text-right">${formatRupiah(honorJP)}</td>
      <td class="text-right">${formatRupiah(uangTransport)}</td>
      <td class="text-right font-bold text-primary-color">${formatRupiah(grandTotal)}</td>
      <td class="text-right">
        <button class="btn btn-secondary btn-sm" onclick="generateSlipGaji('${escapeHTML(teacher.id)}', ${filterMonth}, ${filterYear})" title="Lihat Slip Gaji">
          <i data-lucide="receipt"></i> Slip
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  safeCreateIcons();
}

window.generateSlipGaji = function(teacherId, month, year) {
  const teacher = state.teachers.find(t => t.id === teacherId);
  if (!teacher) return;
  
  const monthlyLogs = state.attendance.filter(log => isLogInMonthYear(log.date, month, year));
  
  const teacherLogs = monthlyLogs.filter(log => log.teacherId === teacher.id);
  
  // Calculate
  const countHadir = teacherLogs.filter(log => log.status === "Hadir").length;
  const countSakit = teacherLogs.filter(log => log.status === "Sakit").length;
  const countIzin = teacherLogs.filter(log => log.status === "Izin").length;
  const countAlpa = teacherLogs.filter(log => log.status === "Alpa").length;
  const totalJP = teacherLogs.reduce((sum, log) => sum + (log.status === "Hadir" ? Number(log.jp) : 0), 0);
  
  const honorJP = totalJP * Number(teacher.rate);
  const uangTransport = countHadir * Number(teacher.transport);
  const totalGaji = honorJP + uangTransport;
  
  // Format Month Year Text
  const monthsIndo = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  const periodText = `${monthsIndo[month-1]} ${year}`;
  
  const slipContainer = document.getElementById("slipGajiPrintArea");
  
  slipContainer.innerHTML = `
    <div class="slip-header">
      <h2>${escapeHTML(state.settings.schoolName)}</h2>
      <p>${escapeHTML(state.settings.schoolAddress)}</p>
      <div style="font-weight: bold; margin-top: 6px;">SLIP HONORARIUM GURU TIDAK TETAP (GTT)</div>
      <div>Periode: ${escapeHTML(periodText)}</div>
    </div>
    
    <dl class="slip-metadata">
      <dt>NUPTK / ID</dt><dd>: ${escapeHTML(teacher.id)}</dd>
      <dt>Nama GTT</dt><dd>: ${escapeHTML(teacher.name)}</dd>
      <dt>Mata Pelajaran</dt><dd>: ${escapeHTML(teacher.subject)}</dd>
      <dt>Status Kehadiran</dt><dd>: Hadir (${countHadir} hari), Sakit (${countSakit} hari), Izin (${countIzin} hari), Alpa (${countAlpa} hari)</dd>
    </dl>
    
    <div class="slip-divider"></div>
    
    <div class="slip-details">
      <table>
        <thead>
          <tr>
            <th style="padding: 4px 0; background:none; border-bottom:1px solid #000; color:#000;">Rincian Pendapatan</th>
            <th style="padding: 4px 0; background:none; border-bottom:1px solid #000; color:#000; text-align:right;">Volume</th>
            <th style="padding: 4px 0; background:none; border-bottom:1px solid #000; color:#000; text-align:right;">Tarif</th>
            <th style="padding: 4px 0; background:none; border-bottom:1px solid #000; color:#000; text-align:right;">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="color:#000;">Honor Mengajar (JP)</td>
            <td style="text-align:right; color:#000;">${totalJP} JP</td>
            <td style="text-align:right; color:#000;">${formatRupiah(teacher.rate)}</td>
            <td style="text-align:right; color:#000;">${formatRupiah(honorJP)}</td>
          </tr>
          <tr>
            <td style="color:#000;">Uang Transport / Kehadiran</td>
            <td style="text-align:right; color:#000;">${countHadir} Hari</td>
            <td style="text-align:right; color:#000;">${formatRupiah(teacher.transport)}</td>
            <td style="text-align:right; color:#000;">${formatRupiah(uangTransport)}</td>
          </tr>
          
          <tr class="slip-total-row">
            <td colspan="3" style="padding-top:10px; color:#000;">TOTAL HONORARIUM NETTO</td>
            <td style="text-align:right; padding-top:10px; color:#000;">${formatRupiah(totalGaji)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <div class="slip-divider"></div>
    
    <div class="slip-signatures">
      <div class="signature-box">
        <div>Mengetahui,</div>
        <div>Kepala Sekolah</div>
        <div class="signature-space"></div>
        <div style="font-weight: bold; text-decoration: underline;">${escapeHTML(state.settings.principalName)}</div>
        <div>NIP: ${escapeHTML(state.settings.principalNip)}</div>
      </div>
      <div class="signature-box">
        <div>Tegal, ${new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</div>
        <div>Manager Sekolah</div>
        <div class="signature-space"></div>
        <div style="font-weight: bold; text-decoration: underline;">${escapeHTML(state.settings.treasurerName)}</div>
        <div>NIP: ${escapeHTML(state.settings.treasurerNip)}</div>
      </div>
    </div>
    
    ${(() => {
      // Find the latest signature from this teacher's attendance logs for this period
      const latestSigLog = teacherLogs.slice().reverse().find(l => l.signature);
      if (latestSigLog) {
        return `
          <div class="slip-divider"></div>
          <div class="slip-signatures">
            <div class="signature-box" style="width: 100%; text-align: center;">
              <div>Penerima Honorarium,</div>
              <div style="margin-top: 6px;"><img src="${latestSigLog.signature}" alt="Tanda Tangan Guru" class="slip-signature-img"></div>
              <div style="font-weight: bold; text-decoration: underline; margin-top: 6px;">${teacher.name}</div>
              <div>NUPTK: ${teacher.id}</div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="slip-divider"></div>
          <div class="slip-signatures">
            <div class="signature-box" style="width: 100%; text-align: center;">
              <div>Penerima Honorarium,</div>
              <div class="signature-space"></div>
              <div style="font-weight: bold; text-decoration: underline;">${teacher.name}</div>
              <div>NUPTK: ${teacher.id}</div>
            </div>
          </div>
        `;
      }
    })()}
  `;
  
  // Show modal
  document.getElementById("slipModal").classList.add("active");
};

function closeSlipModal() {
  document.getElementById("slipModal").classList.remove("active");
}

window.openMobileProfileModal = function() {
  document.getElementById("mobileProfileModal").classList.add("active");
};

window.closeMobileProfileModal = function() {
  document.getElementById("mobileProfileModal").classList.remove("active");
};

// ----------------------------------------------------
// 5. SETTINGS VIEW FUNCTIONS
// ----------------------------------------------------
function renderSettingsForm() {
  document.getElementById("setSchoolName").value = state.settings.schoolName;
  document.getElementById("setSchoolAddress").value = state.settings.schoolAddress;
  document.getElementById("setPrincipalName").value = state.settings.principalName;
  document.getElementById("setPrincipalNIP").value = state.settings.principalNip;
  document.getElementById("setTreasurerName").value = state.settings.treasurerName;
  document.getElementById("setTreasurerNIP").value = state.settings.treasurerNip;
}

// DATABASE PORTABILITY BACKUP/RESTORE
function exportBackupJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
  const downloadAnchor = document.createElement('a');
  
  const today = new Date().toISOString().split('T')[0];
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `Backup_GTT_SMP_THHK_${today}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importRestoreJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedState = JSON.parse(e.target.result);
      
      // Simple validation of fields
      if (importedState.teachers && importedState.attendance && importedState.settings) {
        state.teachers = importedState.teachers;
        state.attendance = importedState.attendance;
        state.settings = importedState.settings;
        if (importedState.theme) state.theme = importedState.theme;
        
        saveData();
        initTheme();
        renderAllViews();
        alert("Restorasi database berhasil dilakukan!");
      } else {
        alert("Gagal membaca cadangan: Format file JSON tidak sesuai.");
      }
    } catch (err) {
      alert("Error parsing file JSON: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ====================================================
// PRINT REKAP GAJI (LAPORAN REKAPITULASI HONORARIUM & GAJI GTT)
// ====================================================
async function generatePrintRekapGaji() {
  showLoadingOverlay(true);
  try {
    if (isSupabaseConfigured()) {
      await loadData();
    }
  } catch (err) {
    console.warn("Gagal memperbarui data sebelum mencetak rekap gaji:", err);
  } finally {
    showLoadingOverlay(false);
  }

  const month = Number(document.getElementById("rekapBulan").value);
  const year = Number(document.getElementById("rekapTahun").value);
  
  const monthsIndo = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  const monthlyLogs = state.attendance.filter(log => isLogInMonthYear(log.date, month, year));
  
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  let teachersToShow = state.teachers.filter(t => t.status === 'aktif');
  if (isGuru) {
    teachersToShow = state.teachers.filter(t => t.id === state.currentUser.id);
  }
  
  if (teachersToShow.length === 0) {
    alert("Tidak ada data guru untuk dicetak.");
    return;
  }
  
  let totalHadirSemua = 0;
  let totalJPSemua = 0;
  let totalHonorJPSemua = 0;
  let totalTransportSemua = 0;
  let grandTotalSemua = 0;
  
  let tableRowsHtml = '';
  teachersToShow.forEach((teacher, idx) => {
    const teacherLogs = monthlyLogs.filter(log => log.teacherId === teacher.id);
    const countHadir = teacherLogs.filter(log => log.status === "Hadir").length;
    const countSakit = teacherLogs.filter(log => log.status === "Sakit").length;
    const countIzin = teacherLogs.filter(log => log.status === "Izin").length;
    const countAlpa = teacherLogs.filter(log => log.status === "Alpa").length;
    
    const totalJP = teacherLogs.reduce((sum, log) => sum + (log.status === "Hadir" ? Number(log.jp) : 0), 0);
    const honorJP = totalJP * Number(teacher.rate);
    const uangTransport = countHadir * Number(teacher.transport);
    const totalGaji = honorJP + uangTransport;
    
    totalHadirSemua += countHadir;
    totalJPSemua += totalJP;
    totalHonorJPSemua += honorJP;
    totalTransportSemua += uangTransport;
    grandTotalSemua += totalGaji;
    
    const countOther = countSakit + countIzin + countAlpa;
    const otherStr = countOther > 0 ? `${countSakit}S/${countIzin}I/${countAlpa}A` : '-';
    
    tableRowsHtml += `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td style="font-weight: bold;">${escapeHTML(teacher.name)}</td>
        <td>${escapeHTML(teacher.subject)}</td>
        <td style="text-align: center;">${countHadir} Hari</td>
        <td style="text-align: center; font-size: 8.5pt; color: #64748b;">${otherStr}</td>
        <td style="text-align: center;">${totalJP} JP</td>
        <td style="text-align: right;">${formatRupiah(honorJP)}</td>
        <td style="text-align: right;">${formatRupiah(uangTransport)}</td>
        <td style="text-align: right; font-weight: bold;">${formatRupiah(totalGaji)}</td>
      </tr>
    `;
  });
  
  const container = document.getElementById('printRekapArea');
  container.innerHTML = `
    <div class="print-rekap-page">
      <div class="print-rekap-header">
        <img src="school-logo.png" class="print-logo" alt="Logo">
        <div class="print-header-text">
          <div class="print-yayasan">Yayasan Tri Dharma Tegal</div>
          <div class="print-school-name">${escapeHTML(state.settings.schoolName)}</div>
          <div class="print-school-subtitle">( SEKOLAH RAMAH ANAK, TERAKREDITASI "B" )</div>
          <div class="print-school-address">Alamat: ${escapeHTML(state.settings.schoolAddress)}</div>
          <div class="print-school-email">Surel: smpthhk.tegal@gmail.com</div>
        </div>
      </div>
      
      <div class="print-rekap-title" style="margin-top: 14px; margin-bottom: 16px;">
        <strong style="font-size: 12pt; text-transform: uppercase;">REKAPITULASI HONORARIUM GURU TIDAK TETAP (GTT)</strong><br>
        <span style="font-size: 10pt;">PERIODE : ${monthsIndo[month - 1]} ${year}</span>
      </div>
      
      <table class="print-rekap-table" style="width: 100%;">
        <thead>
          <tr>
            <th style="width:30px;">NO</th>
            <th>NAMA GTT</th>
            <th>MAPEL</th>
            <th style="width:55px;">HADIR</th>
            <th style="width:55px;">KET.</th>
            <th style="width:55px;">TOTAL JP</th>
            <th style="width:100px;">HONOR JP</th>
            <th style="width:100px;">TRANSPORT</th>
            <th style="width:110px;">TOTAL GAJI</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
          <tr style="font-weight: bold; background-color: #f1f5f9;">
            <td colspan="3" style="text-align: center;">TOTAL KESELURUHAN</td>
            <td style="text-align: center;">${totalHadirSemua} Hari</td>
            <td>-</td>
            <td style="text-align: center;">${totalJPSemua} JP</td>
            <td style="text-align: right;">${formatRupiah(totalHonorJPSemua)}</td>
            <td style="text-align: right;">${formatRupiah(totalTransportSemua)}</td>
            <td style="text-align: right;">${formatRupiah(grandTotalSemua)}</td>
          </tr>
        </tbody>
      </table>
      
      <div class="slip-signatures" style="margin-top: 35px;">
        <div class="signature-box">
          <div>Mengetahui,</div>
          <div>Kepala Sekolah</div>
          <div class="signature-space" style="height: 55px;"></div>
          <div style="font-weight: bold; text-decoration: underline;">${escapeHTML(state.settings.principalName)}</div>
          <div>NIP: ${escapeHTML(state.settings.principalNip)}</div>
        </div>
        <div class="signature-box">
          <div>Tegal, ${new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</div>
          <div>Manager / Bendahara Sekolah</div>
          <div class="signature-space" style="height: 55px;"></div>
          <div style="font-weight: bold; text-decoration: underline;">${escapeHTML(state.settings.treasurerName)}</div>
          <div>NIP: ${escapeHTML(state.settings.treasurerNip)}</div>
        </div>
      </div>
    </div>
  `;
  
  document.body.classList.add('printing-rekap');
  setTimeout(() => {
    window.print();
  }, 200);
  
  const cleanup = () => {
    document.body.classList.remove('printing-rekap');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 5000);
}

// ====================================================
// PRINT REKAP PER GURU — DAFTAR HADIR GURU
// ====================================================
async function generatePrintRekapPerGuru() {
  showLoadingOverlay(true);
  try {
    if (isSupabaseConfigured()) {
      await loadData();
    }
  } catch (err) {
    console.warn("Gagal memperbarui data sebelum mencetak absensi:", err);
  } finally {
    showLoadingOverlay(false);
  }

  const month = Number(document.getElementById("rekapBulan").value);
  const year = Number(document.getElementById("rekapTahun").value);
  
  const monthsIndo = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  const daysIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  
  const monthlyLogs = state.attendance.filter(log => isLogInMonthYear(log.date, month, year));
  
  const isGuru = state.currentUser && state.currentUser.role === "guru";
  let teachersToShow = state.teachers.filter(t => t.status === 'aktif');
  if (isGuru) {
    teachersToShow = state.teachers.filter(t => t.id === state.currentUser.id);
  }
  
  if (teachersToShow.length === 0) {
    alert("Tidak ada data guru untuk dicetak.");
    return;
  }
  
  const container = document.getElementById('printRekapArea');
  container.innerHTML = '';
  
  const schoolNameDisplay = state.settings.schoolName && state.settings.schoolName.toUpperCase().includes("TUNAS") 
    ? state.settings.schoolName 
    : "SMP TUNAS HIDUP HARAPAN KITA";

  teachersToShow.forEach(teacher => {
    const teacherLogs = monthlyLogs
      .filter(log => log.teacherId === teacher.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Build table rows from attendance data
    let tableRows = '';
    teacherLogs.forEach((log, idx) => {
      const dParts = log.date.split('-');
      const dObj = new Date(Number(dParts[0]), Number(dParts[1]) - 1, Number(dParts[2]));
      const dayName = daysIndo[dObj.getDay()];
      const dateStr = `${dayName}, ${dObj.getDate()}.${dObj.getMonth() + 1}.${String(dObj.getFullYear()).slice(-2)}`;
      
      let kelasMapel = '-';
      if (log.status === 'Hadir') {
        kelasMapel = log.class || teacher.subject;
      } else {
        kelasMapel = log.status;
      }
      
      const jpStr = log.status === 'Hadir' ? `${log.jp} jp` : '-';
      const sigHtml = log.signature ? `<img src="${escapeHTML(log.signature)}" alt="TTD">` : '';
      
      tableRows += `<tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td class="text-left" style="text-align: left; padding-left: 8px;">${dateStr}</td>
        <td></td>
        <td></td>
        <td style="text-align: center;">${escapeHTML(kelasMapel)}</td>
        <td style="text-align: center;">${jpStr}</td>
        <td class="td-sig" style="text-align: center;">${sigHtml}</td>
      </tr>`;
    });
    
    // Fill empty rows to reach at least 22 rows to fill the page grid like physical form
    const minRows = 22;
    for (let i = teacherLogs.length; i < minRows; i++) {
      tableRows += `<tr>
        <td class="td-empty" style="text-align: center;">${i + 1}</td>
        <td class="td-empty"></td>
        <td class="td-empty"></td>
        <td class="td-empty"></td>
        <td class="td-empty"></td>
        <td class="td-empty"></td>
        <td class="td-empty"></td>
      </tr>`;
    }
    
    const pageHtml = `
      <div class="print-rekap-page" style="page-break-after: always; padding: 10px 15px;">
        <div class="print-rekap-header" style="display: flex; align-items: center; gap: 14px; padding-bottom: 8px; border-bottom: 3px double #000; margin-bottom: 10px;">
          <img src="school-logo.png" class="print-logo" alt="Logo" style="width: 60px; height: 60px; object-fit: contain;">
          <div class="print-header-text" style="flex: 1; text-align: center; line-height: 1.3;">
            <div class="print-yayasan" style="font-size: 11pt; font-weight: bold;">YAYASAN TRI DHARMA TEGAL</div>
            <div class="print-school-name" style="font-size: 13.5pt; font-weight: bold; text-transform: uppercase;">${escapeHTML(schoolNameDisplay)}</div>
            <div class="print-school-subtitle" style="font-size: 9pt; font-weight: bold;">( SEKOLAH RAMAH ANAK, TERAKREDITASI "B" )</div>
            <div class="print-school-address" style="font-size: 8pt;">Alamat : Jalan Gurami Nomor 6, Telepon (0283) 6146846, Kota Tegal</div>
            <div class="print-school-email" style="font-size: 8pt;">Surel : smpthhk.tegal@gmail.com</div>
          </div>
        </div>
        
        <div class="print-rekap-title" style="text-align: center; margin-top: 8px; margin-bottom: 10px; line-height: 1.4;">
          <strong style="font-size: 12pt; text-transform: uppercase;">DAFTAR HADIR GURU</strong><br>
          <span style="font-size: 10pt; font-weight: bold;">BULAN : ${monthsIndo[month - 1]} ${year}</span>
        </div>
        
        <div class="print-rekap-info" style="margin-bottom: 8px; font-size: 10pt;">
          <span>Nama : <strong>${escapeHTML(teacher.name)}</strong></span>
        </div>
        
        <table class="print-rekap-table" style="width: 100%; border-collapse: collapse; font-size: 9.5pt;">
          <thead>
            <tr>
              <th rowspan="2" style="width: 32px; border: 1px solid #000; padding: 4px; text-align: center;">NO</th>
              <th rowspan="2" style="width: 160px; border: 1px solid #000; padding: 4px; text-align: center;">HARI, TANGGAL</th>
              <th colspan="2" style="border: 1px solid #000; padding: 4px; text-align: center;">WAKTU</th>
              <th rowspan="2" style="border: 1px solid #000; padding: 4px; text-align: center;">KELAS / MAPEL</th>
              <th rowspan="2" style="width: 45px; border: 1px solid #000; padding: 4px; text-align: center;">JP</th>
              <th rowspan="2" style="width: 130px; border: 1px solid #000; padding: 4px; text-align: center;">TANDA TANGAN</th>
            </tr>
            <tr>
              <th style="width: 65px; border: 1px solid #000; padding: 4px; text-align: center;">DATANG</th>
              <th style="width: 65px; border: 1px solid #000; padding: 4px; text-align: center;">PULANG</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        
        <div class="print-rekap-footer" style="display: flex; justify-content: flex-end; margin-top: 20px; font-size: 10pt;">
          <div class="print-rekap-sig-box" style="text-align: center; min-width: 210px;">
            <div>Mengetahui,</div>
            <div>Pemilik Sekolah</div>
            <div class="print-sig-space" style="height: 55px;"></div>
            <div class="print-sig-name" style="font-weight: bold; text-decoration: underline;">${escapeHTML(state.settings.treasurerName)}</div>
          </div>
        </div>
      </div>
    `;
    
    container.innerHTML += pageHtml;
  });
  
  // Trigger print with rekap mode
  document.body.classList.add('printing-rekap');
  
  setTimeout(() => {
    window.print();
  }, 200);
  
  // Cleanup after print
  const cleanup = () => {
    document.body.classList.remove('printing-rekap');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 5000);
}

// CSV Export for Recap Table
function exportRecapToCSV() {
  const month = Number(document.getElementById("rekapBulan").value);
  const year = Number(document.getElementById("rekapTahun").value);
  
  const monthlyLogs = state.attendance.filter(log => isLogInMonthYear(log.date, month, year));
  
  // Headers for CSV
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Nama GTT,Hadir (Hari),Sakit (Hari),Izin (Hari),Alpa (Hari),Total JP (Jam),Tarif per JP (Rp),Uang Transport per Hadir (Rp),Honor JP (Rp),Uang Transport (Rp),Total Gaji (Rp)\n";
  
  state.teachers.forEach(t => {
    const teacherLogs = monthlyLogs.filter(log => log.teacherId === t.id);
    const countHadir = teacherLogs.filter(log => log.status === "Hadir").length;
    const countSakit = teacherLogs.filter(log => log.status === "Sakit").length;
    const countIzin = teacherLogs.filter(log => log.status === "Izin").length;
    const countAlpa = teacherLogs.filter(log => log.status === "Alpa").length;
    const totalJP = teacherLogs.reduce((sum, log) => sum + (log.status === "Hadir" ? Number(log.jp) : 0), 0);
    
    const honorJP = totalJP * Number(t.rate);
    const uangTransport = countHadir * Number(t.transport);
    const totalGaji = honorJP + uangTransport;
    
    csvContent += `"${t.name}",${countHadir},${countSakit},${countIzin},${countAlpa},${totalJP},${t.rate},${t.transport},${honorJP},${uangTransport},${totalGaji}\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Rekap_Gaji_GTT_${month}_${year}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// RESET ALL DATA
async function resetAllData() {
  if (confirm("WARNING: Apakah Anda yakin ingin menghapus SELURUH data guru, pengaturan, dan riwayat kehadiran? Tindakan ini permanen dan tidak dapat dibatalkan!")) {
    showLoadingOverlay(true);
    try {
      if (isSupabaseConfigured()) {
        await supabaseClient.from("attendance").delete().neq("id", "");
        await supabaseClient.from("teachers").delete().neq("id", "");
        await supabaseClient.from("settings").update({
          school_name: "SMP THHK Tegal",
          school_address: "Jl. Dr. Sutomo No.50, Kota Tegal",
          principal_name: "Haryanto, S.Pd., M.M.",
          principal_nip: "19740512 199903 1 002",
          treasurer_name: "Siti Rahmawati, A.Md.",
          treasurer_nip: "-"
        }).eq("id", 1);
      }
      
      state.teachers = [];
      state.attendance = [];
      state.settings = {
        schoolName: "SMP THHK Tegal",
        schoolAddress: "Jl. Dr. Sutomo No.50, Kota Tegal",
        principalName: "Haryanto, S.Pd., M.M.",
        principalNip: "19740512 199903 1 002",
        treasurerName: "Siti Rahmawati, A.Md.",
        treasurerNip: "-"
      };
      
      saveData();
      renderAllViews();
      alert("Semua data aplikasi telah dikosongkan.");
    } catch (err) {
      console.error("Gagal mereset data:", err);
      alert("Gagal mereset data di database online: " + err.message);
    } finally {
      showLoadingOverlay(false);
    }
  }
}

// ----------------------------------------------------
// EVENT LISTENERS CONFIGURATION
// ----------------------------------------------------
function setupEventListeners() {
  // Theme Toggle Button
  document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);
  
  // Mobile profile interactions
  const mobThemeBtn = document.getElementById("mobileThemeToggleBtn");
  if (mobThemeBtn) {
    mobThemeBtn.addEventListener("click", () => {
      toggleTheme();
      closeMobileProfileModal();
    });
  }
  const mobLogoutBtn = document.getElementById("mobileLogoutBtn");
  if (mobLogoutBtn) {
    mobLogoutBtn.addEventListener("click", () => {
      logout();
      closeMobileProfileModal();
    });
  }
  
  // Mobile Bottom Nav Auto Click trigger (delegates to sidebar click handlers)
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const tabId = link.getAttribute('data-tab');
      // Sync active state in DOM for PWA/Bottom Navigation
      document.querySelectorAll('.nav-link').forEach(l => {
        if (l.getAttribute('data-tab') === tabId) {
          l.classList.add('active');
        } else {
          l.classList.remove('active');
        }
      });
    });
  });

  
  // Dashboard quick links
  document.getElementById("btnGoToPresensi").addEventListener("click", () => {
    document.querySelector('.nav-link[data-tab="presensi"]').click();
  });
  
  // --- Teacher GTT Handlers ---
  document.getElementById("btnTambahGuru").addEventListener("click", () => openGuruModal(false));
  document.getElementById("btnCloseGuruModal").addEventListener("click", closeGuruModal);
  document.getElementById("btnBatalGuru").addEventListener("click", closeGuruModal);
  
  // Search bar key up
  document.getElementById("searchGuruInput").addEventListener("input", renderGuruList);
  
  // Teacher modal submit
  document.getElementById("guruForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const idField = document.getElementById("guruNuptk").value.trim();
    const nameField = document.getElementById("guruNama").value.trim();
    const mapelField = document.getElementById("guruMapel").value.trim();
    const rateField = Number(document.getElementById("guruRate").value);
    const transportField = Number(document.getElementById("guruTransport").value);
    const statusField = document.getElementById("guruStatus").value;
    const passwordField = document.getElementById("guruPassword").value.trim() || "guru123";
    const editingId = document.getElementById("guruIndex").value; // Empty if creating
    
    // SECURITY: Validasi minimum password
    if (passwordField.length < MIN_PASSWORD_LENGTH) {
      alert(`Password minimal ${MIN_PASSWORD_LENGTH} karakter!`);
      return;
    }
    
    showLoadingOverlay(true);
    try {
      if (editingId) {
        // Edit mode — SECURITY: gunakan RPC untuk hash password di server
        if (isSupabaseConfigured()) {
          const { error } = await supabaseClient.rpc('upsert_teacher_with_hash', {
            p_id: editingId,
            p_name: nameField,
            p_subject: mapelField,
            p_rate: rateField,
            p_transport: transportField,
            p_status: statusField,
            p_password: passwordField
          });
            
          if (error) throw error;
        }
        
        const idx = state.teachers.findIndex(t => t.id === editingId);
        if (idx !== -1) {
          state.teachers[idx] = {
            id: editingId,
            name: nameField,
            subject: mapelField,
            rate: rateField,
            transport: transportField,
            status: statusField
            // SECURITY: password tidak disimpan di client state
          };
        }
      } else {
        // Add mode
        // Validate unique ID
        if (state.teachers.some(t => t.id === idField)) {
          alert("ID/NUPTK Guru ini sudah terdaftar! Harap gunakan ID yang unik.");
          showLoadingOverlay(false);
          return;
        }
        
        // SECURITY: gunakan RPC untuk hash password di server
        if (isSupabaseConfigured()) {
          const { error } = await supabaseClient.rpc('upsert_teacher_with_hash', {
            p_id: idField,
            p_name: nameField,
            p_subject: mapelField,
            p_rate: rateField,
            p_transport: transportField,
            p_status: statusField,
            p_password: passwordField
          });
            
          if (error) throw error;
        }
        
        state.teachers.push({
          id: idField,
          name: nameField,
          subject: mapelField,
          rate: rateField,
          transport: transportField,
          status: statusField
          // SECURITY: password tidak disimpan di client state
        });
      }

      
      saveData();
      renderAllViews();
      closeGuruModal();
      alert("Data guru berhasil disimpan!");
    } catch (err) {
      console.error("Gagal menyimpan data guru:", err);
      alert("Gagal menyimpan ke database: " + err.message);
    } finally {
      showLoadingOverlay(false);
    }
  });
  
  // --- Attendance Log Handlers ---
  // Status change toggles KBM fields (sakit/izin/alpa disables JP/class/topic)
  document.getElementById("presensiStatus").addEventListener("change", (e) => {
    togglePresensiFormFields(e.target.value);
  });
  
  // Attendance logs filter listeners
  const filterModeEl = document.getElementById("filterPresensiMode");
  const filterBulanEl = document.getElementById("filterPresensiBulan");
  const filterTahunEl = document.getElementById("filterPresensiTahun");
  const filterTanggalEl = document.getElementById("filterPresensiTanggal");
  
  if (filterModeEl) filterModeEl.addEventListener("change", renderDetailedLogs);
  if (filterBulanEl) filterBulanEl.addEventListener("change", renderDetailedLogs);
  if (filterTahunEl) filterTahunEl.addEventListener("change", renderDetailedLogs);
  if (filterTanggalEl) filterTanggalEl.addEventListener("change", renderDetailedLogs);
  
  // Reset Form button
  document.getElementById("btnResetPresensiForm").addEventListener("click", () => {
    document.getElementById("presensiForm").reset();
    document.getElementById("presensiId").value = "";
    document.getElementById("presensiTanggal").value = new Date().toISOString().split('T')[0];
    togglePresensiFormFields("Hadir");
    if (signaturePadInstance) signaturePadInstance.clear();
    renderPresensiForm();
  });
  
async function saveAttendanceToSupabase(payload, isUpdate = false, logId = null) {
  if (!isSupabaseConfigured()) return;
  
  let res;
  if (isUpdate) {
    res = await supabaseClient.from("attendance").update(payload).eq("id", logId);
  } else {
    res = await supabaseClient.from("attendance").insert(payload);
  }
  
  if (res.error) {
    const errStr = String(res.error.message || res.error.details || JSON.stringify(res.error)).toLowerCase();
    // Fallback: If signature column does not exist in Supabase schema yet
    if (payload.signature && (errStr.includes("signature") || errStr.includes("schema cache"))) {
      console.warn("Kolom 'signature' belum ada di Supabase. Menyimpan data presensi tanpa signature ke Supabase...");
      delete payload.signature;
      if (isUpdate) {
        const retryRes = await supabaseClient.from("attendance").update(payload).eq("id", logId);
        if (retryRes.error) throw retryRes.error;
      } else {
        const retryRes = await supabaseClient.from("attendance").insert(payload);
        if (retryRes.error) throw retryRes.error;
      }
    } else {
      throw res.error;
    }
  }
}

  // Save log
  document.getElementById("presensiForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const logId = document.getElementById("presensiId").value;
    const tId = document.getElementById("presensiGuru").value;
    const dateVal = document.getElementById("presensiTanggal").value;
    const statusVal = document.getElementById("presensiStatus").value;
    const jpVal = Number(document.getElementById("presensiJP").value);
    const classVal = document.getElementById("presensiKelas").value.trim();
    const topicVal = document.getElementById("presensiMateri").value.trim();
    
    if (!tId) {
      alert("Harap pilih guru terlebih dahulu!");
      return;
    }
    
    showLoadingOverlay(true);
    try {
      const sigData = signaturePadInstance ? signaturePadInstance.toDataURL() : '';

      if (logId) {
        // Edit existing log
        const updatePayload = {
          teacher_id: tId,
          date: dateVal,
          status: statusVal,
          jp: jpVal,
          class: classVal,
          topic: topicVal
        };
        if (sigData) updatePayload.signature = sigData;
        
        await saveAttendanceToSupabase(updatePayload, true, logId);
        
        const idx = state.attendance.findIndex(log => log.id === logId);
        if (idx !== -1) {
          state.attendance[idx] = {
            id: logId,
            teacherId: tId,
            date: dateVal,
            status: statusVal,
            jp: jpVal,
            class: classVal,
            topic: topicVal,
            signature: sigData || state.attendance[idx].signature || ''
          };
        }
      } else {
        // Check duplicate log for same teacher on same day
        const duplicate = state.attendance.some(log => log.teacherId === tId && log.date === dateVal);
        if (duplicate) {
          alert("Presensi guru tersebut pada tanggal yang dipilih sudah tercatat! Silakan edit riwayat presensi yang sudah ada jika ingin mengubah data.");
          showLoadingOverlay(false);
          return;
        }
        
        const newLogId = "log_" + Date.now();
        
        const insertPayload = {
          id: newLogId,
          teacher_id: tId,
          date: dateVal,
          status: statusVal,
          jp: jpVal,
          class: classVal,
          topic: topicVal
        };
        if (sigData) insertPayload.signature = sigData;
        
        await saveAttendanceToSupabase(insertPayload, false);
        
        // New log
        state.attendance.push({
          id: newLogId,
          teacherId: tId,
          date: dateVal,
          status: statusVal,
          jp: jpVal,
          class: classVal,
          topic: topicVal,
          signature: sigData
        });
      }
      
      saveData();
      renderAllViews();
      
      // Clear and reset form
      document.getElementById("btnResetPresensiForm").click();
      alert("Data presensi berhasil disimpan!");
    } catch (err) {
      console.error("Gagal menyimpan presensi:", err);
      alert("Gagal menyimpan ke database: " + getSupabaseErrorMessage(err));
    } finally {
      showLoadingOverlay(false);
    }
  });
  
  // --- Recap Gaji Handlers ---
  document.getElementById("rekapBulan").addEventListener("change", renderRekapTable);
  document.getElementById("rekapTahun").addEventListener("change", renderRekapTable);
  
  // Export CSV
  document.getElementById("btnExportRecapCSV").addEventListener("click", exportRecapToCSV);
  
  // Print Rekap Gaji (Laporan Rekapitulasi Honorarium)
  document.getElementById("btnPrintRecapTable").addEventListener("click", () => {
    generatePrintRekapGaji();
  });
  
  // Print Absensi Guru (Daftar Hadir Guru)
  const btnAbsensi = document.getElementById("btnPrintAbsensiGuru");
  if (btnAbsensi) {
    btnAbsensi.addEventListener("click", () => {
      generatePrintRekapPerGuru();
    });
  }
  
  // --- Slip Gaji Modal Handlers ---
  document.getElementById("btnCloseSlipModal").addEventListener("click", closeSlipModal);
  document.getElementById("btnBatalSlip").addEventListener("click", closeSlipModal);
  document.getElementById("btnPrintSlip").addEventListener("click", () => {
    window.print();
  });
  
  // --- Settings Form Handlers ---
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const schName = document.getElementById("setSchoolName").value.trim();
    const schAddress = document.getElementById("setSchoolAddress").value.trim();
    const prName = document.getElementById("setPrincipalName").value.trim();
    const prNip = document.getElementById("setPrincipalNIP").value.trim();
    const trName = document.getElementById("setTreasurerName").value.trim();
    const trNip = document.getElementById("setTreasurerNIP").value.trim();
    
    showLoadingOverlay(true);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabaseClient
          .from("settings")
          .update({
            school_name: schName,
            school_address: schAddress,
            principal_name: prName,
            principal_nip: prNip,
            treasurer_name: trName,
            treasurer_nip: trNip
          })
          .eq("id", 1);
          
        if (error) throw error;
      }
      
      state.settings.schoolName = schName;
      state.settings.schoolAddress = schAddress;
      state.settings.principalName = prName;
      state.settings.principalNip = prNip;
      state.settings.treasurerName = trName;
      state.settings.treasurerNip = trNip;
      
      saveData();
      renderAllViews();
      alert("Pengaturan instansi sekolah berhasil disimpan!");
    } catch (err) {
      console.error("Gagal menyimpan pengaturan sekolah:", err);
      alert("Gagal menyimpan ke database: " + err.message);
    } finally {
      showLoadingOverlay(false);
    }
  });
  
  // Backup / Restore Handlers
  document.getElementById("btnBackupData").addEventListener("click", exportBackupJSON);
  document.getElementById("importFileInput").addEventListener("change", importRestoreJSON);
  
  // Signature Pad Clear Button
  document.getElementById("btnClearSignature").addEventListener("click", () => {
    if (signaturePadInstance) signaturePadInstance.clear();
  });
  document.getElementById("btnLoadDemoData").addEventListener("click", () => loadSampleData(true));
  document.getElementById("btnResetAllData").addEventListener("click", resetAllData);
  
  // --- Authentication Form Handlers ---
  document.getElementById("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const userVal = document.getElementById("loginUsername").value;
    const passVal = document.getElementById("loginPassword").value;
    login(userVal, passVal);
  });
  
  document.getElementById("btnLogoutBtn").addEventListener("click", logout);
  
  // --- Password Toggle & Generator Handlers ---
  document.querySelectorAll(".btn-toggle-password").forEach(btn => {
    btn.addEventListener("click", function() {
      const container = this.closest(".password-input-container");
      if (!container) return;
      const input = container.querySelector("input");
      if (!input) return;
      
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      
      this.innerHTML = isPassword ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    });
  });

  const btnGenPass = document.getElementById("btnGenerateGuruPassword");
  if (btnGenPass) {
    btnGenPass.addEventListener("click", () => {
      const passInput = document.getElementById("guruPassword");
      const toggleBtn = document.getElementById("toggleGuruPassword");
      if (passInput) {
        passInput.value = generateRandomPassword(8);
        passInput.type = "text";
      }
      if (toggleBtn) {
        toggleBtn.innerHTML = '<i data-lucide="eye-off"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    });
  }
}

// Password Generator Utility
function generateRandomPassword(length = 8) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}
