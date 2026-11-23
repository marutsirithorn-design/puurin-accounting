/**
 * ระบบบัญชีร้าน — Google Apps Script Web App
 * ฐานข้อมูล: Google Sheet (ชีตขึ้นต้นด้วย DB_)
 *
 * ติดตั้งครั้งแรก: เลือกฟังก์ชัน setup แล้วกด Run หนึ่งครั้ง
 * ผู้ใช้เริ่มต้น: admin / admin1234  (เปลี่ยนรหัสผ่านทันทีหลังเข้าสู่ระบบ)
 */

const SPREADSHEET_ID = '1E6rH56qXSe0XYZIRlnL2vJHyqAN5FD7fHIK_5XxZdXU';
const TZ = 'Asia/Bangkok';
const PREFIX = 'DB_';
const SESSION_TTL = 21600; // 6 ชั่วโมง (สูงสุดของ CacheService)
const PAYMENTS = ['เงินสด', 'โอน'];
const COST_TYPES = ['food', 'drink', 'other'];
const PAYROLL_TYPES = ['เงินเดือน', 'ค่าแรงรายวัน', 'เบิกล่วงหน้า', 'โบนัส/อื่นๆ'];

const TABLES = {
  Users: ['id', 'username', 'passwordHash', 'salt', 'displayName', 'role', 'active', 'createdAt'],
  Bills: ['id', 'date', 'tableNo', 'food', 'drink', 'concert', 'discount', 'total', 'payment', 'note', 'createdBy', 'createdAt', 'updatedAt'],
  Expenses: ['id', 'date', 'categoryId', 'item', 'amount', 'payment', 'note', 'createdBy', 'createdAt', 'updatedAt'],
  Categories: ['id', 'name', 'group', 'costType', 'color', 'sort', 'active'],
  Employees: ['id', 'name', 'position', 'payType', 'rate', 'phone', 'startDate', 'active', 'note'],
  Payroll: ['id', 'date', 'employeeId', 'employeeName', 'type', 'amount', 'payment', 'note', 'createdBy', 'createdAt'],
  Settings: ['key', 'value'],
  Audit: ['id', 'at', 'username', 'approvedBy', 'action', 'entity', 'recordId', 'recordDate', 'before', 'after', 'reason'],
};
TABLES.DailyCash = ['id', 'date', 'cashFloat', 'countedCash', 'note', 'updatedBy', 'updatedAt']; // id = วันที่
// สรุปรายวัน: แยกยอดอาหาร/เครื่องดื่ม, ส่วนลด, ยอดยกมา (ว่าง = คำนวณอัตโนมัติ) — id = วันที่
TABLES.DaySummary = ['id', 'date', 'food', 'drink', 'discount', 'carryOverride', 'note', 'updatedBy', 'updatedAt'];
// บิล: amount = ค่าอาหารและเครื่องดื่ม (รวม) — คอลัมน์ food/drink เก็บไว้สำหรับข้อมูลเก่า
TABLES.Bills = TABLES.Bills.concat(['amount', 'extras']); // extras = JSON {incomeTypeId: จำนวนเงิน}
// หัวข้อรายรับเพิ่มเติม (admin เพิ่มเองได้ เช่น ค่าห้อง VIP)
TABLES.IncomeTypes = ['id', 'name', 'color', 'sort', 'active'];
// พนักงาน: ชื่อเล่น + บัญชีรับโอน
TABLES.Employees = TABLES.Employees.concat(['nickname', 'bank', 'accountNo']);
// รอบจ่ายค่าแรง (หัวเอกสาร) และรายการแต่ละคน
TABLES.PayRuns = ['id', 'payDate', 'periodStart', 'periodEnd', 'note', 'status', 'paidAt', 'createdBy', 'createdAt', 'updatedAt', 'group'];
// group: daily = ค่าแรงรายวัน (ค่าแรง × วัน) | monthly = เงินเดือน
TABLES.PayRunItems = ['id', 'runId', 'sort', 'employeeId', 'employeeName', 'position', 'rate', 'days', 'base', 'addition', 'deduction', 'net', 'bank', 'accountNo', 'payment', 'note', 'otherDeduction'];
const SETUP_VERSION = '7';
const NUMERIC = ['food', 'drink', 'concert', 'discount', 'total', 'amount', 'rate', 'sort', 'cashFloat', 'days', 'base', 'addition', 'deduction', 'net', 'otherDeduction'];
const BOOLEAN = ['active'];
const NO_SANITIZE = ['passwordHash', 'salt'];

// [ชื่อหมวด, กลุ่มในรายงาน, ประเภทต้นทุน, สี]
const DEFAULT_CATEGORIES = [
  ['ซื้อของสด', 'ค่าวัตถุดิบอาหาร', 'food', '#8fb9dd'],
  ['เครื่องดื่ม', 'ค่าเครื่องดื่ม+น้ำแข็ง', 'drink', '#e79c9c'],
  ['น้ำแข็ง', 'ค่าเครื่องดื่ม+น้ำแข็ง', 'drink', '#7a6a58'],
  ['ค่าไฟ', 'ค่าไฟ', 'other', '#b9a3d6'],
  ['แก๊ส', 'ค่าวัตถุดิบอาหาร', 'food', '#9c6b4a'],
  ['ข้าวสาร', 'ค่าวัตถุดิบอาหาร', 'food', '#5f8f6b'],
  ['Makro', 'ค่าวัตถุดิบอาหาร', 'food', '#f0b48f'],
  ['ของใช้ในร้าน', 'ค่าของใช้ในร้าน', 'other', '#9fb4bd'],
  ['ค่าแรง', 'ค่าแรงพนักงาน', 'other', '#6c5a9c'],
  ['ค่าน้ำมัน', 'ค่าน้ำมัน/เดินทาง', 'other', '#e8cf7d'],
  ['ค่าซ่อมบำรุง', 'ค่าซ่อมบำรุง', 'other', '#b0564f'],
  ['ค่าเน็ต', 'ค่าเน็ตร้าน', 'other', '#c3b3e3'],
  ['ค่าศิลปินคอนเสิร์ต', 'ค่าศิลปินคอนเสิร์ต', 'other', '#e0874f'],
  ['ค่านักดนตรี', 'ค่านักดนตรี', 'other', '#e57fae'],
  ['ค่าน้ำประปา', 'ค่าน้ำประปา', 'other', '#a9b3b8'],
];

/* ===================== Web entry ===================== */

function doGet() {
  ensureSetup_(false);
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(getSetting_('shopName') || 'ระบบบัญชีร้าน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** รันครั้งแรกจาก editor เพื่อสร้างชีตฐานข้อมูล */
function setup() {
  ensureSetup_(true);
  Logger.log('ติดตั้งเรียบร้อย — ผู้ใช้เริ่มต้น admin / admin1234');
}

/* ===================== API dispatcher ===================== */

const ACTIONS = {
  bootstrap: { run: bootstrap_ },
  logout: { run: logout_ },
  changePassword: { run: changePassword_, write: true },

  getDay: { run: getDay_ },
  saveBill: { run: saveBill_, write: true },
  deleteBill: { run: deleteBill_, write: true },
  saveExpense: { run: saveExpense_, write: true },
  deleteExpense: { run: deleteExpense_, write: true },

  getMonth: { run: getMonth_, admin: true },

  listIncomeTypes: { run: listIncomeTypes_, admin: true },
  saveIncomeType: { run: saveIncomeType_, admin: true, write: true },
  deleteIncomeType: { run: deleteIncomeType_, admin: true, write: true },

  listCategories: { run: listCategories_, admin: true },
  saveCategory: { run: saveCategory_, admin: true, write: true },
  deleteCategory: { run: deleteCategory_, admin: true, write: true },

  listUsers: { run: listUsers_, admin: true },
  saveUser: { run: saveUser_, admin: true, write: true },
  deleteUser: { run: deleteUser_, admin: true, write: true },

  listEmployees: { run: listEmployees_, admin: true },
  saveEmployee: { run: saveEmployee_, admin: true, write: true },
  deleteEmployee: { run: deleteEmployee_, admin: true, write: true },

  listPayroll: { run: listPayroll_, admin: true },
  savePayroll: { run: savePayroll_, admin: true, write: true },
  deletePayroll: { run: deletePayroll_, admin: true, write: true },

  listPayRuns: { run: listPayRuns_, admin: true },
  getPayRun: { run: getPayRun_, admin: true },
  draftPayRun: { run: draftPayRun_, admin: true },
  createPayRun: { run: createPayRun_, admin: true, write: true },
  savePayRun: { run: savePayRun_, admin: true, write: true },
  setPayRunStatus: { run: setPayRunStatus_, admin: true, write: true },
  deletePayRun: { run: deletePayRun_, admin: true, write: true },

  saveSettings: { run: saveSettings_, admin: true, write: true },
  listAudit: { run: listAudit_, admin: true },
  saveDailyCash: { run: saveDailyCash_, admin: true, write: true },
  saveDaySummary: { run: saveDaySummary_, write: true },
  deleteDaySummary: { run: deleteDaySummary_, write: true },
};

function api(token, action, payload) {
  let lock = null;
  try {
    if (action === 'login') return { ok: true, data: login_(payload || {}) };
    const def = ACTIONS[action];
    if (!def) throw new Error('ไม่พบคำสั่ง: ' + action);
    const user = auth_(token);
    if (def.admin && user.role !== 'admin') throw new Error('ไม่มีสิทธิ์ใช้งานส่วนนี้');
    if (def.write) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    const data = def.run(user, payload || {}, token);
    return { ok: true, data: data === undefined ? null : clean_(data) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    if (lock) {
      SpreadsheetApp.flush();
      lock.releaseLock();
    }
  }
}

/* ===================== Auth ===================== */

function login_(p) {
  const username = String(p.username || '').trim().toLowerCase();
  const password = String(p.password || '');
  if (!username || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');

  const u = readAll_('Users').find(x => x.username.toLowerCase() === username);
  if (!u || !u.active || hash_(password, u.salt) !== u.passwordHash) {
    cache.put(failKey, String(fails + 1), 300);
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('s_' + token, u.id, SESSION_TTL);
  return { token: token, user: publicUser_(u) };
}

function auth_(token) {
  if (!token) throw new Error('AUTH');
  const cache = CacheService.getScriptCache();
  const uid = cache.get('s_' + token);
  if (!uid) throw new Error('AUTH');
  const u = readAll_('Users').find(x => x.id === uid);
  if (!u || !u.active) {
    cache.remove('s_' + token);
    throw new Error('AUTH');
  }
  cache.put('s_' + token, uid, SESSION_TTL);
  return publicUser_(u);
}

function logout_(user, p, token) {
  CacheService.getScriptCache().remove('s_' + token);
  return true;
}

function publicUser_(u) {
  return { id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role };
}

function hash_(password, salt) {
  let h = salt + '|' + password;
  for (let i = 0; i < 64; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8);
    h = bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return h;
}

function changePassword_(user, p) {
  const oldPw = String(p.oldPassword || '');
  const newPw = String(p.newPassword || '');
  if (newPw.length < 6) throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
  const u = getById_('Users', user.id);
  if (!u || hash_(oldPw, u.salt) !== u.passwordHash) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
  const salt = Utilities.getUuid();
  update_('Users', u.id, { salt: salt, passwordHash: hash_(newPw, salt) });
  return true;
}

/* ===================== Bootstrap / settings ===================== */

function bootstrap_(user) {
  const cats = readAll_('Categories').filter(c => c.active).sort(bySort_);
  return {
    user: user,
    today: today_(),
    settings: getSettings_(),
    categories: cats,
    payments: PAYMENTS,
    incomeTypes: readAll_('IncomeTypes').sort(bySort_),
    payrollTypes: PAYROLL_TYPES,
    spreadsheetUrl: user.role === 'admin' ? ss_().getUrl() : '',
  };
}

function getSettings_() {
  const out = { shopName: 'ระบบบัญชีร้าน', cashFloat: 0 };
  readAll_('Settings').forEach(s => { out[s.key] = s.value; });
  out.cashFloat = Number(out.cashFloat) || 0;
  return out;
}

function getSetting_(key) {
  try {
    const s = readAll_('Settings').find(x => x.key === key);
    return s ? s.value : '';
  } catch (e) {
    return '';
  }
}

function setSetting_(key, value) {
  const sh = sheet_('Settings');
  if (findRow_(sh, key) > 0) update_('Settings', key, { value: value });
  else insert_('Settings', { key: key, value: value });
}

function saveSettings_(user, p) {
  const shopName = String(p.shopName || '').trim();
  const cashFloat = num_(p.cashFloat);
  if (!shopName) throw new Error('กรุณากรอกชื่อร้าน');
  if (cashFloat < 0) throw new Error('เงินทอนตั้งต้นต้องไม่ติดลบ');
  setSetting_('shopName', shopName);
  setSetting_('cashFloat', String(cashFloat));
  return getSettings_();
}

/* ===================== Daily ===================== */

function getDay_(user, p) {
  const isAdmin = user.role === 'admin';
  const today = today_();
  let date = checkDate_(p.date || today);
  if (!isAdmin && date > today) date = today;
  const month = date.slice(0, 7);
  const cats = catMap_();
  const inMonth = r => String(r.date).slice(0, 7) === month;

  const mBills = readAll_('Bills').filter(inMonth);
  const mExps = readAll_('Expenses').filter(inMonth);
  const mPays = payouts_(d => String(d).slice(0, 7) === month);
  const mSums = readAll_('DaySummary').filter(inMonth);

  const bills = mBills.filter(b => b.date === date).sort(byCreated_)
    .map(b => Object.assign(b, { amount: gross_(b), extras: extras_(b), canEdit: true, needApproval: !isAdmin }));
  const expenses = mExps.filter(e => e.date === date).sort(byCreated_)
    .map(e => {
      const c = cats[e.categoryId] || { name: 'ไม่ระบุหมวด', color: '#b8bfbb' };
      return Object.assign(e, { categoryName: c.name, color: c.color, canEdit: true, needApproval: !isAdmin });
    });
  const payroll = mPays.filter(x => x.date === date).sort(byCreated_);

  const days = buildDays_(month, date, mBills, mExps, mPays, mSums);
  const row = days[days.length - 1];
  const s = Object.assign({}, row, cashSummary_(bills, expenses, payroll));

  const dc = readAll_('DailyCash').find(x => x.id === date);
  const cashFloat = dc ? dc.cashFloat : (Number(getSetting_('cashFloat')) || 0);
  s.cashFloat = cashFloat;
  s.floatCustom = !!dc;
  s.cashNote = dc ? dc.note : '';
  s.cashUpdated = dc ? dc.updatedBy + ' · ' + dc.updatedAt : '';
  s.floatRemain = round2_(cashFloat - s.cashOut);
  s.drawerTotal = round2_(cashFloat + s.cashIn - s.cashOut);
  s.countedCash = dc && dc.countedCash !== '' ? Number(dc.countedCash) : null;
  s.cashDiff = s.countedCash === null ? null : round2_(s.countedCash - s.drawerTotal);

  const sum = mSums.find(x => x.date === date) || null;
  return {
    date: date, today: today, bills: bills, expenses: expenses, payroll: payroll, summary: s,
    daySummary: sum ? Object.assign(sum, { needApproval: !isAdmin }) : null,
    addNeedApproval: !isAdmin && date !== today,
    incomeTypes: readAll_('IncomeTypes').sort(bySort_),
  };
}

/** ยอด "ค่าอาหารและเครื่องดื่ม" ของบิล (บิลเก่าที่แยก food/drink ใช้ผลรวม) */
function gross_(b) {
  return b.amount || round2_(b.food + b.drink);
}

/** รายรับเพิ่มเติมของบิล {incomeTypeId: จำนวนเงิน} */
function extras_(b) {
  if (b.extras && typeof b.extras === 'object') return b.extras;
  try { const o = JSON.parse(b.extras || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function extrasTotal_(ex) {
  return round2_(Object.keys(ex).reduce((a, k) => a + (Number(ex[k]) || 0), 0));
}

/** เงินสด/โอน เข้า-ออก ของชุดรายการ */
function cashSummary_(bills, exps, pays) {
  const s = { cashIn: 0, transferIn: 0, cashOut: 0, transferOut: 0 };
  bills.forEach(b => { if (b.payment === 'เงินสด') s.cashIn += b.total; else s.transferIn += b.total; });
  exps.concat(pays).forEach(e => { if (e.payment === 'เงินสด') s.cashOut += e.amount; else s.transferOut += e.amount; });
  Object.keys(s).forEach(k => { s[k] = round2_(s[k]); });
  return s;
}

/**
 * แถวรายวันของเดือน (ถึงวันที่ upTo ถ้าระบุ)
 * - ถ้ามี "สรุปรายวัน": ใช้ยอดอาหาร/เครื่องดื่ม/ส่วนลด จากสรุป + ค่าบัตรคอนเสิร์ตจากบิล
 * - ถ้ายังไม่สรุป: ใช้ยอดรวมจากบิล (summarized = false)
 * - ยอดยกมา = ยอดสุทธิของวันก่อน (หรือค่าที่กรอกเอง) ; ยอดสุทธิ = ยอดยกมา + กำไรวันนี้
 */
function buildDays_(month, upTo, bills, exps, pays, sums) {
  const parts = month.split('-').map(Number);
  const nDays = new Date(parts[0], parts[1], 0).getDate();
  const B = {}, E = {}, S = {};
  bills.forEach(b => { (B[b.date] = B[b.date] || []).push(b); });
  exps.concat(pays).forEach(e => { E[e.date] = (E[e.date] || 0) + e.amount; });
  sums.forEach(x => { S[x.date] = x; });
  const rows = [];
  let cum = 0;
  for (let d = 1; d <= nDays; d++) {
    const date = month + '-' + ('0' + d).slice(-2);
    if (upTo && date > upTo) break;
    const list = B[date] || [];
    const r = { date: date, billCount: list.length, billsGross: 0, concert: 0, billDiscount: 0, billsTotal: 0, extras: {}, extrasTotal: 0 };
    list.forEach(b => {
      r.billsGross += gross_(b); r.concert += b.concert; r.billDiscount += b.discount; r.billsTotal += b.total;
      const ex = extras_(b);
      Object.keys(ex).forEach(k => { r.extras[k] = round2_((r.extras[k] || 0) + (Number(ex[k]) || 0)); });
    });
    r.extrasTotal = extrasTotal_(r.extras);
    const s = S[date];
    r.summarized = !!s;
    if (s) {
      r.food = s.food; r.drink = s.drink; r.discount = s.discount;
      r.sales = s.food + s.drink - s.discount + r.concert + r.extrasTotal;
    } else {
      r.food = 0; r.drink = 0; r.discount = r.billDiscount;
      r.sales = r.billsTotal;
    }
    r.expense = E[date] || 0;
    r.profit = r.sales - r.expense;
    const ov = s && String(s.carryOverride).trim() !== '' && isFinite(Number(s.carryOverride)) ? Number(s.carryOverride) : null;
    r.carryAuto = round2_(cum);
    r.carryOverridden = ov !== null;
    r.carry = ov !== null ? ov : cum;
    r.net = r.carry + r.profit;
    cum = r.net;
    ['billsGross', 'concert', 'billDiscount', 'billsTotal', 'food', 'drink', 'discount', 'sales', 'expense', 'profit', 'carry', 'net']
      .forEach(k => { r[k] = round2_(r[k]); });
    rows.push(r);
  }
  return rows;
}

function saveDaySummary_(user, p) {
  const x = p.summary || {};
  const date = checkDate_(x.date);
  const food = num_(x.food), drink = num_(x.drink), discount = num_(x.discount);
  if ([food, drink, discount].some(n => n < 0)) throw new Error('จำนวนเงินต้องไม่ติดลบ');
  if (discount > food + drink) throw new Error('ส่วนลดมากกว่ายอดขาย');
  const carryRaw = String(x.carryOverride == null ? '' : x.carryOverride).replace(/,/g, '').trim();
  if (carryRaw !== '' && !isFinite(Number(carryRaw))) throw new Error('ยอดยกมาไม่ถูกต้อง');
  const cur = readAll_('DaySummary').find(s => s.id === date) || null;
  const apv = approvalFor_(user, p, !!cur, date);
  const data = {
    id: date, date: date, food: food, drink: drink, discount: discount,
    carryOverride: carryRaw === '' ? '' : String(round2_(Number(carryRaw))),
    note: String(x.note || '').trim(), updatedBy: user.username, updatedAt: nowStr_(),
  };
  const rec = cur ? update_('DaySummary', date, data) : insert_('DaySummary', data);
  audit_(user, cur ? 'update' : 'create', 'daysum', cur, rec, apv);
  return true;
}

function deleteDaySummary_(user, p) {
  const date = checkDate_(p.date);
  const cur = readAll_('DaySummary').find(s => s.id === date);
  if (!cur) throw new Error('ไม่พบสรุปของวันนี้');
  const apv = approvalFor_(user, p, true, date);
  remove_('DaySummary', date);
  audit_(user, 'delete', 'daysum', cur, null, apv);
  return true;
}


/**
 * สิทธิ์การแก้ไข:
 * - admin: เพิ่ม/แก้/ลบได้ทุกวัน
 * - พนักงาน: เพิ่มรายการของ "วันนี้" ได้เลย
 *   แต่การแก้ไข/ลบรายการที่บันทึกแล้ว หรือเพิ่มรายการย้อนหลัง ต้องใช้รหัสผ่านผู้ดูแลระบบ + เหตุผล
 * ทุกการเปลี่ยนแปลงถูกบันทึกลง DB_Audit
 */
function approvalFor_(user, p, isEdit, date) {
  const reason = String((p.approval || {}).reason || '').trim();
  if (user.role === 'admin') return { approvedBy: '', reason: reason };
  if (date > today_()) throw new Error('ไม่สามารถบันทึกล่วงหน้าได้');
  if (!isEdit && date === today_()) return { approvedBy: '', reason: '' };
  return requireApproval_(user, p.approval);
}

function requireApproval_(user, approval) {
  if (!approval || !approval.password) throw new Error('APPROVAL_REQUIRED');
  const reason = String(approval.reason || '').trim();
  if (!reason) throw new Error('กรุณาระบุเหตุผลการแก้ไข');
  const cache = CacheService.getScriptCache();
  const key = 'apv_' + user.id;
  const fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw new Error('ใส่รหัสผู้ดูแลระบบผิดหลายครั้ง กรุณารอ 5 นาที');
  const pw = String(approval.password);
  const admin = readAll_('Users').find(u => u.role === 'admin' && u.active && hash_(pw, u.salt) === u.passwordHash);
  if (!admin) {
    cache.put(key, String(fails + 1), 300);
    throw new Error('รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง');
  }
  cache.remove(key);
  return { approvedBy: admin.username, reason: reason };
}

const AUDIT_FIELDS = {
  bill: ['date', 'tableNo', 'amount', 'food', 'drink', 'concert', 'extras', 'discount', 'total', 'payment', 'note', 'createdBy'],
  daysum: ['date', 'food', 'drink', 'discount', 'carryOverride', 'note'],
  payrun: ['date', 'group', 'periodStart', 'periodEnd', 'status', 'count', 'net', 'note'],
  expense: ['date', 'categoryId', 'item', 'amount', 'payment', 'note', 'createdBy'],
  cash: ['date', 'cashFloat', 'countedCash', 'note'],
};

function audit_(user, action, entity, before, after, apv) {
  const pick = o => {
    if (!o) return '';
    const out = {};
    AUDIT_FIELDS[entity].forEach(k => { out[k] = o[k]; });
    return JSON.stringify(out);
  };
  const rec = after || before;
  insert_('Audit', {
    id: uid_(), at: nowStr_(), username: user.username, approvedBy: apv.approvedBy || '',
    action: action, entity: entity, recordId: rec.id, recordDate: rec.date,
    before: pick(before), after: pick(after), reason: apv.reason || '',
  });
}

function saveBill_(user, p) {
  const b = p.bill || {};
  let date = checkDate_(b.date);
  const amount = num_(b.amount), concert = num_(b.concert), discount = num_(b.discount);
  const types = {};
  readAll_('IncomeTypes').forEach(t => { types[t.id] = t; });
  const extras = {};
  Object.keys(b.extras || {}).forEach(k => {
    const v = num_(b.extras[k]);
    if (v < 0) throw new Error('จำนวนเงินต้องไม่ติดลบ');
    if (v && !types[k]) throw new Error('ไม่พบหัวข้อรายรับที่เลือก');
    if (v) extras[k] = v;
  });
  const extraSum = extrasTotal_(extras);
  if ([amount, concert, discount].some(n => n < 0)) throw new Error('จำนวนเงินต้องไม่ติดลบ');
  if (amount + concert + extraSum <= 0) throw new Error('กรุณากรอกยอดรายรับอย่างน้อย 1 ช่อง');
  if (discount > amount + concert + extraSum) throw new Error('ส่วนลดมากกว่ายอดขาย');
  const now = nowStr_();
  const data = {
    date: date,
    tableNo: String(b.tableNo || '').trim(),
    amount: amount, food: 0, drink: 0, concert: concert, discount: discount,
    extras: Object.keys(extras).length ? JSON.stringify(extras) : '',
    total: round2_(amount + concert + extraSum - discount),
    payment: PAYMENTS.indexOf(b.payment) >= 0 ? b.payment : PAYMENTS[0],
    note: String(b.note || '').trim(),
    updatedAt: now,
  };
  if (b.id) {
    const cur = getById_('Bills', b.id);
    if (!cur) throw new Error('ไม่พบบิลนี้');
    data.date = cur.date;
    const apv = approvalFor_(user, p, true, cur.date);
    const after = update_('Bills', b.id, data);
    audit_(user, 'update', 'bill', cur, after, apv);
    return after;
  }
  const apv = approvalFor_(user, p, false, date);
  const rec = insert_('Bills', Object.assign({ id: uid_(), createdBy: user.username, createdAt: now }, data));
  audit_(user, 'create', 'bill', null, rec, apv);
  return rec;
}

function deleteBill_(user, p) {
  const cur = getById_('Bills', p.id);
  if (!cur) throw new Error('ไม่พบบิลนี้');
  const apv = approvalFor_(user, p, true, cur.date);
  remove_('Bills', p.id);
  audit_(user, 'delete', 'bill', cur, null, apv);
  return true;
}

function saveExpense_(user, p) {
  const e = p.expense || {};
  const date = checkDate_(e.date);
  const cat = readAll_('Categories').find(c => c.id === e.categoryId);
  if (!cat) throw new Error('กรุณาเลือกหมวดรายจ่าย');
  const amount = num_(e.amount);
  if (amount <= 0) throw new Error('กรุณากรอกจำนวนเงิน');
  const now = nowStr_();
  const data = {
    date: date,
    categoryId: cat.id,
    item: String(e.item || '').trim() || cat.name,
    amount: amount,
    payment: PAYMENTS.indexOf(e.payment) >= 0 ? e.payment : PAYMENTS[0],
    note: String(e.note || '').trim(),
    updatedAt: now,
  };
  if (e.id) {
    const cur = getById_('Expenses', e.id);
    if (!cur) throw new Error('ไม่พบรายการนี้');
    data.date = cur.date;
    const apv = approvalFor_(user, p, true, cur.date);
    const after = update_('Expenses', e.id, data);
    audit_(user, 'update', 'expense', cur, after, apv);
    return after;
  }
  const apv = approvalFor_(user, p, false, date);
  const rec = insert_('Expenses', Object.assign({ id: uid_(), createdBy: user.username, createdAt: now }, data));
  audit_(user, 'create', 'expense', null, rec, apv);
  return rec;
}

function deleteExpense_(user, p) {
  const cur = getById_('Expenses', p.id);
  if (!cur) throw new Error('ไม่พบรายการนี้');
  const apv = approvalFor_(user, p, true, cur.date);
  remove_('Expenses', p.id);
  audit_(user, 'delete', 'expense', cur, null, apv);
  return true;
}

/** admin กำหนดเงินทอนตั้งต้นของวัน และบันทึกเงินสดที่นับได้จริงในลิ้นชัก */
function saveDailyCash_(user, p) {
  const date = checkDate_(p.date);
  const cashFloat = num_(p.cashFloat);
  if (cashFloat < 0) throw new Error('เงินทอนตั้งต้นต้องไม่ติดลบ');
  const countedRaw = String(p.countedCash == null ? '' : p.countedCash).replace(/,/g, '').trim();
  if (countedRaw !== '' && (!isFinite(Number(countedRaw)) || Number(countedRaw) < 0)) throw new Error('เงินสดที่นับได้ไม่ถูกต้อง');
  const data = {
    id: date, date: date, cashFloat: cashFloat,
    countedCash: countedRaw === '' ? '' : String(round2_(Number(countedRaw))),
    note: String(p.note || '').trim(), updatedBy: user.username, updatedAt: nowStr_(),
  };
  const cur = readAll_('DailyCash').find(x => x.id === date) || null;
  const rec = cur ? update_('DailyCash', date, data) : insert_('DailyCash', data);
  audit_(user, cur ? 'update' : 'create', 'cash', cur, rec, { approvedBy: '', reason: '' });
  return true;
}

function listAudit_(user, p) {
  const month = checkMonth_(p.month || today_().slice(0, 7));
  const cats = catMap_();
  const rows = readAll_('Audit').filter(a => String(a.at).slice(0, 7) === month)
    .sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : 0)
    .slice(0, 1000);
  return { month: month, rows: rows, categories: Object.keys(cats).map(k => ({ id: k, name: cats[k].name })) };
}

/* ===================== Monthly dashboard ===================== */

function getMonth_(user, p) {
  const month = checkMonth_(p.month || today_().slice(0, 7));
  const inMonth = r => String(r.date).slice(0, 7) === month;

  const bills = readAll_('Bills').filter(inMonth);
  const exps = readAll_('Expenses').filter(inMonth);
  const pays = payouts_(d => String(d).slice(0, 7) === month);
  const sums = readAll_('DaySummary').filter(inMonth);
  const cats = readAll_('Categories').sort(bySort_);

  const daily = buildDays_(month, null, bills, exps, pays, sums);
  const t = { food: 0, drink: 0, discount: 0, concert: 0, extrasTotal: 0, sales: 0, expense: 0, profit: 0, billCount: 0, pendingDays: 0 };
  const extras = {};
  daily.forEach(r => {
    ['food', 'drink', 'discount', 'concert', 'extrasTotal', 'sales', 'expense', 'profit', 'billCount'].forEach(k => { t[k] += r[k]; });
    Object.keys(r.extras).forEach(k => { extras[k] = round2_((extras[k] || 0) + r.extras[k]); });
    if (r.billCount && !r.summarized) t.pendingDays++;
  });
  Object.keys(t).forEach(k => { t[k] = round2_(t[k]); });
  t.extras = extras;
  // หัวข้อรายรับที่แสดงในรายงาน: ที่เปิดใช้งาน หรือมียอดในเดือนนี้
  const incomeTypes = readAll_('IncomeTypes').sort(bySort_).filter(x => x.active || extras[x.id]);
  const last = daily.filter(r => r.billCount || r.expense || r.summarized).pop();
  t.carryStart = daily.length ? daily[0].carry : 0;
  t.net = last ? last.net : t.carryStart;
  Object.assign(t, cashSummary_(bills, exps, pays));
  t.payroll = round2_(pays.reduce((a, x) => a + x.amount, 0));

  const catTotals = {};
  exps.forEach(e => { catTotals[e.categoryId] = (catTotals[e.categoryId] || 0) + e.amount; });
  const known = {};
  const byCategory = [];
  cats.forEach(c => {
    known[c.id] = true;
    if (!c.active && !catTotals[c.id]) return;
    byCategory.push({ id: c.id, name: c.name, color: c.color, group: c.group || c.name, costType: c.costType, amount: round2_(catTotals[c.id] || 0) });
  });
  const orphan = Object.keys(catTotals).filter(id => !known[id]).reduce((a, id) => a + catTotals[id], 0);
  if (orphan) byCategory.push({ id: '_none', name: 'ไม่ระบุหมวด', color: '#b8bfbb', group: 'อื่นๆ', costType: 'other', amount: round2_(orphan) });
  if (t.payroll) byCategory.push({ id: '_payroll', name: 'เงินเดือนพนักงาน', color: '#8e7cc3', group: 'ค่าแรงพนักงาน', costType: 'other', amount: t.payroll });

  const groupMap = {};
  const byGroup = [];
  byCategory.forEach(c => {
    if (!groupMap[c.group]) {
      groupMap[c.group] = { group: c.group, color: c.color, amount: 0 };
      byGroup.push(groupMap[c.group]);
    }
    groupMap[c.group].amount = round2_(groupMap[c.group].amount + c.amount);
  });

  const costOf = type => round2_(byCategory.filter(c => c.costType === type).reduce((a, c) => a + c.amount, 0));
  const profitBlock = (sales, cost) => ({
    sales: sales, cost: cost, profit: round2_(sales - cost),
    pct: sales ? round2_((sales - cost) / sales * 100) : 0,
  });

  return {
    month: month,
    daily: daily,
    totals: t,
    byCategory: byCategory,
    byGroup: byGroup,
    incomeTypes: incomeTypes,
    // ส่วนลดหักจากยอดอาหาร (แบบเดียวกับชีตเดิม)
    food: profitBlock(round2_(t.food - t.discount), costOf('food')),
    drink: profitBlock(t.drink, costOf('drink')),
  };
}


/* ===================== Categories ===================== */

function listCategories_() {
  return readAll_('Categories').sort(bySort_);
}

function saveCategory_(user, p) {
  const c = p.category || {};
  const name = String(c.name || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อหมวด');
  const all = readAll_('Categories');
  if (all.some(x => x.name === name && x.id !== c.id)) throw new Error('มีหมวดชื่อนี้แล้ว');
  const data = {
    name: name,
    group: String(c.group || '').trim() || name,
    costType: COST_TYPES.indexOf(c.costType) >= 0 ? c.costType : 'other',
    color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#9fb4bd',
    sort: c.sort === '' || c.sort == null ? all.length + 1 : num_(c.sort),
    active: c.active !== false && c.active !== 'false',
  };
  if (c.id) update_('Categories', c.id, data);
  else insert_('Categories', Object.assign({ id: uid_() }, data));
  return listCategories_();
}

function deleteCategory_(user, p) {
  const used = readAll_('Expenses').some(e => e.categoryId === p.id);
  if (used) update_('Categories', p.id, { active: false });
  else remove_('Categories', p.id);
  return { softDeleted: used, list: listCategories_() };
}

/* ===================== Income types (หัวข้อรายรับเพิ่มเติม) ===================== */

function listIncomeTypes_() {
  const used = incomeUsage_();
  return readAll_('IncomeTypes').sort(bySort_).map(x => Object.assign(x, { usedCount: used[x.id] || 0 }));
}

/** จำนวนบิลที่ใช้หัวข้อรายรับแต่ละหัวข้อ */
function incomeUsage_() {
  const used = {};
  readAll_('Bills').forEach(b => {
    const ex = extras_(b);
    Object.keys(ex).forEach(k => { if (Number(ex[k])) used[k] = (used[k] || 0) + 1; });
  });
  return used;
}

function saveIncomeType_(user, p) {
  const x = p.incomeType || {};
  const name = String(x.name || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อหัวข้อรายรับ');
  const reserved = ['ค่าอาหารและเครื่องดื่ม', 'ค่าอาหาร', 'ค่าเครื่องดื่ม', 'ค่าบัตรคอนเสิร์ต', 'ส่วนลด'];
  if (reserved.indexOf(name) >= 0) throw new Error('ชื่อนี้เป็นหัวข้อหลักของระบบอยู่แล้ว');
  const all = readAll_('IncomeTypes');
  if (all.some(t => t.name === name && t.id !== x.id)) throw new Error('มีหัวข้อรายรับชื่อนี้แล้ว');
  const data = {
    name: name,
    color: /^#[0-9a-fA-F]{6}$/.test(x.color || '') ? x.color : '#8fb9dd',
    sort: x.sort === '' || x.sort == null ? all.length + 1 : num_(x.sort),
    active: x.active !== false && x.active !== 'false',
  };
  if (x.id) update_('IncomeTypes', x.id, data);
  else insert_('IncomeTypes', Object.assign({ id: uid_() }, data));
  return listIncomeTypes_();
}

/** ลบได้เฉพาะหัวข้อที่ยังไม่มีบิลใช้ — ถ้ามีแล้วจะปิดใช้งานแทน เพื่อไม่ให้ข้อมูลเก่าเสีย */
function deleteIncomeType_(user, p) {
  const used = incomeUsage_()[p.id] || 0;
  if (used) update_('IncomeTypes', p.id, { active: false });
  else remove_('IncomeTypes', p.id);
  return { softDeleted: !!used, usedCount: used, list: listIncomeTypes_() };
}

/* ===================== Users ===================== */

function listUsers_() {
  return readAll_('Users').map(u => ({
    id: u.id, username: u.username, displayName: u.displayName, role: u.role, active: u.active, createdAt: u.createdAt,
  }));
}

function createUser_(u) {
  const salt = Utilities.getUuid();
  insert_('Users', {
    id: uid_(), username: u.username, passwordHash: hash_(u.password, salt), salt: salt,
    displayName: u.displayName, role: u.role, active: u.active, createdAt: nowStr_(),
  });
}

function saveUser_(user, p) {
  const u = p.user || {};
  const username = String(u.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ หรือ . ความยาว 3–30 ตัว');
  const role = u.role === 'admin' ? 'admin' : 'staff';
  const active = u.active !== false && u.active !== 'false';
  const displayName = String(u.displayName || '').trim() || username;
  const password = String(u.password || '');
  const all = readAll_('Users');
  if (all.some(x => x.username.toLowerCase() === username && x.id !== u.id)) throw new Error('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  if (password && password.length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');

  if (u.id) {
    if (u.id === user.id && (role !== 'admin' || !active)) throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
    const patch = { username: username, displayName: displayName, role: role, active: active };
    if (password) {
      patch.salt = Utilities.getUuid();
      patch.passwordHash = hash_(password, patch.salt);
    }
    update_('Users', u.id, patch);
  } else {
    if (!password) throw new Error('กรุณาตั้งรหัสผ่าน');
    createUser_({ username: username, displayName: displayName, role: role, active: active, password: password });
  }
  return listUsers_();
}

function deleteUser_(user, p) {
  if (p.id === user.id) throw new Error('ไม่สามารถลบบัญชีของตัวเองได้');
  const all = readAll_('Users');
  const target = all.find(x => x.id === p.id);
  if (!target) throw new Error('ไม่พบผู้ใช้');
  if (target.role === 'admin' && all.filter(x => x.role === 'admin' && x.active).length <= 1) {
    throw new Error('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน');
  }
  remove_('Users', p.id);
  return listUsers_();
}

/* ===================== Employees & payroll ===================== */

function listEmployees_() {
  return readAll_('Employees').sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'th'));
}

function saveEmployee_(user, p) {
  const e = p.employee || {};
  const name = String(e.name || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อพนักงาน');
  const data = {
    name: name,
    position: String(e.position || '').trim(),
    payType: e.payType === 'daily' ? 'daily' : 'monthly',
    rate: num_(e.rate),
    phone: String(e.phone || '').trim(),
    startDate: e.startDate ? checkDate_(e.startDate) : '',
    active: e.active !== false && e.active !== 'false',
    note: String(e.note || '').trim(),
    nickname: String(e.nickname || '').trim(),
    bank: String(e.bank || '').trim(),
    accountNo: String(e.accountNo || '').trim(),
  };
  if (data.rate < 0) throw new Error('อัตราค่าจ้างต้องไม่ติดลบ');
  if (e.id) update_('Employees', e.id, data);
  else insert_('Employees', Object.assign({ id: uid_() }, data));
  return listEmployees_();
}

function deleteEmployee_(user, p) {
  const used = readAll_('Payroll').some(x => x.employeeId === p.id);
  if (used) update_('Employees', p.id, { active: false });
  else remove_('Employees', p.id);
  return { softDeleted: used, list: listEmployees_() };
}

function listPayroll_(user, p) {
  const month = checkMonth_(p.month || today_().slice(0, 7));
  const entries = readAll_('Payroll').filter(x => String(x.date).slice(0, 7) === month)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : byCreated_(a, b));
  const employees = listEmployees_();
  const sum = {};
  entries.forEach(x => {
    const k = x.employeeId;
    if (!sum[k]) sum[k] = { employeeId: k, employeeName: x.employeeName, amount: 0, count: 0 };
    sum[k].amount = round2_(sum[k].amount + x.amount);
    sum[k].count++;
  });
  return {
    month: month,
    entries: entries,
    employees: employees,
    summary: Object.keys(sum).map(k => sum[k]).sort((a, b) => b.amount - a.amount),
    total: round2_(entries.reduce((a, x) => a + x.amount, 0)),
  };
}

function savePayroll_(user, p) {
  const x = p.entry || {};
  const date = checkDate_(x.date);
  const emp = readAll_('Employees').find(e => e.id === x.employeeId);
  if (!emp) throw new Error('กรุณาเลือกพนักงาน');
  const amount = num_(x.amount);
  if (amount <= 0) throw new Error('กรุณากรอกจำนวนเงิน');
  const data = {
    date: date,
    employeeId: emp.id,
    employeeName: emp.name,
    type: PAYROLL_TYPES.indexOf(x.type) >= 0 ? x.type : PAYROLL_TYPES[0],
    amount: amount,
    payment: PAYMENTS.indexOf(x.payment) >= 0 ? x.payment : PAYMENTS[0],
    note: String(x.note || '').trim(),
  };
  if (x.id) update_('Payroll', x.id, data);
  else insert_('Payroll', Object.assign({ id: uid_(), createdBy: user.username, createdAt: nowStr_() }, data));
  return listPayroll_(user, { month: date.slice(0, 7) });
}

function deletePayroll_(user, p) {
  remove_('Payroll', p.id);
  return listPayroll_(user, { month: p.month });
}

/* ===================== Pay runs (รอบจ่ายค่าแรง) ===================== */
/*
 * รอบจ่าย 1 รอบ = หัวเอกสาร (วันที่จ่าย, งวด) + รายการพนักงานแต่ละคน
 * รวมเงิน = ค่าแรง × จำนวนวัน ; ได้รับสุทธิ = รวมเงิน + รายการเพิ่ม − รายการหัก
 * รอบที่ "จ่ายแล้ว" นับเป็นรายจ่าย (ยอดสุทธิ) ในวันที่จ่าย
 * รายการหัก (เบิกล่วงหน้า) เติมให้อัตโนมัติจากการเบิกที่บันทึกไว้ในช่วงงวด
 */
const PAYRUN_STATUS = ['draft', 'paid'];

/** รายจ่ายเงินเดือนทั้งหมดในช่วงวันที่: รายการเบิก/จ่ายรายครั้ง + รอบจ่ายที่จ่ายแล้ว */
function payouts_(inRange) {
  const out = readAll_('Payroll').filter(x => inRange(x.date));
  const runs = {};
  readAll_('PayRuns').forEach(r => { if (r.status === 'paid' && inRange(r.payDate)) runs[r.id] = r; });
  if (Object.keys(runs).length) {
    readAll_('PayRunItems').forEach(i => {
      const r = runs[i.runId];
      if (!r || !i.net) return;
      out.push({
        id: i.id, date: r.payDate, employeeId: i.employeeId, employeeName: i.employeeName,
        type: 'ค่าแรงตามรอบจ่าย', amount: i.net, payment: i.payment, note: i.note,
        createdAt: r.paidAt || r.updatedAt,
      });
    });
  }
  return out;
}

function runTotals_(items) {
  const t = { count: 0, base: 0, addition: 0, deduction: 0, otherDeduction: 0, net: 0, cash: 0, transfer: 0 };
  items.forEach(i => {
    t.count++; t.base += i.base; t.addition += i.addition; t.deduction += i.deduction; t.otherDeduction += i.otherDeduction || 0; t.net += i.net;
    if (i.payment === 'เงินสด') t.cash += i.net; else t.transfer += i.net;
  });
  Object.keys(t).forEach(k => { t[k] = round2_(t[k]); });
  return t;
}

function makePayItem_(x, runId, sort, lenient, group) {
  const name = String(x.employeeName || '').trim();
  if (!name) throw new Error('แถวที่ ' + sort + ': กรุณากรอกชื่อพนักงาน');
  const rate = num_(x.rate), addition = num_(x.addition), deduction = num_(x.deduction), otherDeduction = num_(x.otherDeduction);
  const days = group === 'monthly' ? 1 : num_(x.days); // รายเดือน: เงินเดือน × 1
  if ([rate, days, addition, deduction, otherDeduction].some(n => n < 0)) throw new Error('แถวที่ ' + sort + ' (' + name + '): จำนวนต้องไม่ติดลบ');
  const base = round2_(rate * days);
  const net = round2_(base + addition - deduction - otherDeduction);
  if (net < 0 && !lenient) throw new Error('แถวที่ ' + sort + ' (' + name + '): ยอดหักมากกว่ารายได้');
  return {
    id: x.id || uid_(), runId: runId, sort: sort,
    employeeId: String(x.employeeId || ''), employeeName: name, position: String(x.position || '').trim(),
    rate: rate, days: days, base: base, addition: addition, deduction: deduction, otherDeduction: otherDeduction, net: net,
    bank: String(x.bank || '').trim(), accountNo: String(x.accountNo || '').trim(),
    payment: PAYMENTS.indexOf(x.payment) >= 0 ? x.payment : 'โอน',
    note: String(x.note || '').trim(),
  };
}

function runHeader_(p) {
  const payDate = checkDate_(p.payDate);
  const periodStart = p.periodStart ? checkDate_(p.periodStart) : '';
  const periodEnd = p.periodEnd ? checkDate_(p.periodEnd) : '';
  if (periodStart && periodEnd && periodStart > periodEnd) throw new Error('วันเริ่มงวดต้องไม่เกินวันสิ้นสุดงวด');
  return { payDate: payDate, periodStart: periodStart, periodEnd: periodEnd, note: String(p.note || '').trim() };
}

function auditRun_(user, action, before, after) {
  const pack = x => x ? Object.assign({}, x.run, { date: x.run.payDate, count: x.totals.count, net: x.totals.net }) : null;
  audit_(user, action, 'payrun', pack(before), pack(after), { approvedBy: '', reason: '' });
}

/** ยอดเบิกล่วงหน้าแยกตามพนักงาน ในช่วงงวดของรอบ (ไม่มีงวด = เดือนของวันที่จ่าย) */
function advancesFor_(h) {
  const adv = {};
  readAll_('Payroll').forEach(x => {
    if (x.type !== 'เบิกล่วงหน้า') return;
    if (h.periodStart && x.date < h.periodStart) return;
    if (h.periodEnd && x.date > h.periodEnd) return;
    if (!h.periodStart && !h.periodEnd && x.date.slice(0, 7) !== h.payDate.slice(0, 7)) return;
    adv[x.employeeId] = adv[x.employeeId] || { amount: 0, count: 0 };
    adv[x.employeeId].amount = round2_(adv[x.employeeId].amount + x.amount);
    adv[x.employeeId].count++;
  });
  return adv;
}

function listPayRuns_() {
  const by = {};
  readAll_('PayRunItems').forEach(i => { (by[i.runId] = by[i.runId] || []).push(i); });
  return readAll_('PayRuns')
    .map(r => Object.assign(r, { totals: runTotals_(by[r.id] || []) }))
    .sort((a, b) => a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : (a.createdAt < b.createdAt ? 1 : -1));
}

function getPayRun_(user, p) {
  const run = getById_('PayRuns', p.id);
  if (!run) throw new Error('ไม่พบรอบจ่ายนี้');
  const items = readAll_('PayRunItems').filter(i => i.runId === run.id).sort((a, b) => a.sort - b.sort);
  return { run: run, items: items, totals: runTotals_(items), employees: listEmployees_(), advances: advancesFor_(run) };
}

function createPayRun_(user, p) {
  const h = runHeader_(p);
  const group = p.group === 'monthly' ? 'monthly' : 'daily';
  const id = uid_();
  // มีรายการส่งมาจากตาราง → ตรวจยอดครบ ; ไม่มี → สร้างจากรายชื่อพนักงาน
  const items = Array.isArray(p.items)
    ? p.items.map((x, i) => makePayItem_(x, id, i + 1, false, group))
    : draftItems_(group, h, id);
  if (!items.length) throw new Error('ยังไม่มีรายการพนักงานในรอบนี้');
  const now = nowStr_();
  insert_('PayRuns', Object.assign({ id: id, group: group, status: 'draft', paidAt: '', createdBy: user.username, createdAt: now, updatedAt: now }, h));
  bulkInsert_('PayRunItems', items);
  const after = getPayRun_(user, { id: id });
  auditRun_(user, 'create', null, after);
  return after;
}

/** รายการเริ่มต้นของรอบ: พนักงานที่ทำงานอยู่ตามประเภท + หักเบิกล่วงหน้าในงวด */
function draftItems_(group, h, runId) {
  const adv = advancesFor_(h);
  const emps = readAll_('Employees')
    .filter(e => e.active && (e.payType === 'monthly' ? 'monthly' : 'daily') === group)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  return emps.map((e, i) => makePayItem_({
    employeeId: e.id, employeeName: e.name + (e.nickname ? ' (' + e.nickname + ')' : ''), position: e.position,
    rate: e.rate, days: group === 'monthly' ? 1 : 0, addition: 0, otherDeduction: 0,
    deduction: adv[e.id] ? round2_(adv[e.id].amount) : 0,
    bank: e.bank, accountNo: e.accountNo, payment: e.accountNo ? 'โอน' : 'เงินสด',
    note: adv[e.id] ? 'หักเบิก ' + adv[e.id].count + ' ครั้ง' : '',
  }, runId || '', i + 1, true, group)); // ยังไม่กรอกวัน → ไม่ตรวจยอดติดลบ
}

/** ตารางรอบจ่ายใหม่ (ยังไม่บันทึก) สำหรับแสดงทันที */
function draftPayRun_(user, p) {
  const h = runHeader_(p);
  const group = p.group === 'monthly' ? 'monthly' : 'daily';
  const items = draftItems_(group, h, '');
  return {
    run: Object.assign({ id: '', group: group, status: 'draft', paidAt: '' }, h),
    items: items, totals: runTotals_(items), employees: listEmployees_(), advances: advancesFor_(h),
  };
}

function savePayRun_(user, p) {
  const before = getPayRun_(user, { id: (p.run || {}).id });
  const h = runHeader_(p.run || {});
  const items = (p.items || []).map((x, i) => makePayItem_(x, before.run.id, i + 1, false, before.run.group));
  replaceRows_('PayRunItems', i => i.runId !== before.run.id, items);
  update_('PayRuns', before.run.id, Object.assign(h, { updatedAt: nowStr_() }));
  const after = getPayRun_(user, { id: before.run.id });
  auditRun_(user, 'update', before, after);
  return after;
}

function setPayRunStatus_(user, p) {
  const before = getPayRun_(user, { id: p.id });
  const status = PAYRUN_STATUS.indexOf(p.status) >= 0 ? p.status : 'draft';
  if (status === 'paid') {
    if (!before.items.length) throw new Error('ยังไม่มีรายการพนักงานในรอบนี้');
    const bad = before.items.find(i => i.net < 0);
    if (bad) throw new Error(bad.employeeName + ': ยอดหักมากกว่ารายได้');
  }
  update_('PayRuns', p.id, { status: status, paidAt: status === 'paid' ? nowStr_() : '', updatedAt: nowStr_() });
  const after = getPayRun_(user, { id: p.id });
  auditRun_(user, 'update', before, after);
  return after;
}

function deletePayRun_(user, p) {
  const before = getPayRun_(user, { id: p.id });
  replaceRows_('PayRunItems', i => i.runId !== p.id, []);
  remove_('PayRuns', p.id);
  auditRun_(user, 'delete', before, null);
  return listPayRuns_();
}

/** เขียนหลายแถวต่อท้ายในครั้งเดียว (ไม่ตรวจยอดติดลบ) */
function bulkInsert_(name, rows) {
  if (!rows.length) return;
  const sh = sheet_(name);
  const h = TABLES[name];
  const start = sh.getLastRow() + 1;
  const need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
  const fmts = formats_(name);
  sh.getRange(start, 1, rows.length, h.length)
    .setNumberFormats(rows.map(() => fmts))
    .setValues(rows.map(o => h.map(k => val_(k, o[k]))));
}

/** เขียนตารางใหม่ทั้งหมด: เก็บแถวที่ keep() = true แล้วต่อด้วย newRows */
function replaceRows_(name, keep, newRows) {
  const sh = sheet_(name);
  const h = TABLES[name];
  const rows = readAll_(name).filter(keep).concat(newRows);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, h.length).clearContent();
  if (!rows.length) return;
  if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 200);
  const fmts = formats_(name);
  sh.getRange(2, 1, rows.length, h.length)
    .setNumberFormats(rows.map(() => fmts))
    .setValues(rows.map(o => h.map(k => val_(k, o[k]))));
}

/* ===================== Sheet helpers ===================== */

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(PREFIX + name);
  if (!sh) throw new Error('ยังไม่ได้ติดตั้งฐานข้อมูล กรุณารันฟังก์ชัน setup()');
  return sh;
}

function formats_(name) {
  return TABLES[name].map(h => NUMERIC.indexOf(h) >= 0 ? '#,##0.00' : BOOLEAN.indexOf(h) >= 0 ? 'General' : '@');
}

function ensureSetup_(force) {
  const props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('SETUP_DONE') === SETUP_VERSION) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = ss_();
    Object.keys(TABLES).forEach(name => {
      const headers = TABLES[name];
      const existing = ss.getSheetByName(PREFIX + name);
      if (existing) {
        // เพิ่มหัวคอลัมน์ใหม่ที่ยังไม่มี (กรณีอัปเดตเวอร์ชัน)
        const cur = existing.getRange(1, 1, 1, headers.length).getValues()[0];
        const fmts = formats_(name);
        headers.forEach((h, i) => {
          if (cur[i] === '' || cur[i] == null) {
            existing.getRange(1, i + 1, existing.getMaxRows(), 1).setNumberFormat(fmts[i]);
            existing.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#dfe9e2');
          }
        });
        return;
      }
      const sh = ss.insertSheet(PREFIX + name);
      formats_(name).forEach((f, i) => sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat(f));
      sh.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#dfe9e2').setFontColor('#2e3a34');
      sh.setFrozenRows(1);
    });
    if (readAll_('Categories').length === 0) {
      DEFAULT_CATEGORIES.forEach((c, i) => insert_('Categories', {
        id: uid_(), name: c[0], group: c[1], costType: c[2], color: c[3], sort: i + 1, active: true,
      }));
    }
    if (readAll_('Users').length === 0) {
      createUser_({ username: 'admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', active: true, password: 'admin1234' });
    }
    const keys = readAll_('Settings').map(s => s.key);
    if (keys.indexOf('shopName') < 0) insert_('Settings', { key: 'shopName', value: 'ร้านรินเบียร์' });
    if (keys.indexOf('cashFloat') < 0) insert_('Settings', { key: 'cashFloat', value: '5000' });
    SpreadsheetApp.flush();
    props.setProperty('SETUP_DONE', SETUP_VERSION);
  } finally {
    lock.releaseLock();
  }
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = TABLES[name];
  const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const out = [];
  values.forEach(r => {
    if (r[0] === '' || r[0] === null) return;
    const o = {};
    headers.forEach((h, j) => { o[h] = cell_(h, r[j]); });
    out.push(o);
  });
  return out;
}

function cell_(h, v) {
  if (NUMERIC.indexOf(h) >= 0) return Number(v) || 0;
  if (BOOLEAN.indexOf(h) >= 0) return v === true || String(v).toUpperCase() === 'TRUE';
  if (v instanceof Date) {
    if (h === 'date' || h === 'startDate') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  }
  const s = v == null ? '' : String(v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function val_(h, v) {
  if (NUMERIC.indexOf(h) >= 0) return round2_(Number(v) || 0);
  if (BOOLEAN.indexOf(h) >= 0) return v === true || String(v).toUpperCase() === 'TRUE';
  let s = v == null ? '' : String(v);
  if (NO_SANITIZE.indexOf(h) < 0 && /^[=+\-@]/.test(s)) s = "'" + s; // กันสูตร
  return s;
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function writeRow_(sh, name, row, obj) {
  const h = TABLES[name];
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  sh.getRange(row, 1, 1, h.length).setNumberFormats([formats_(name)]).setValues([h.map(k => val_(k, obj[k]))]);
}

function insert_(name, obj) {
  const sh = sheet_(name);
  writeRow_(sh, name, sh.getLastRow() + 1, obj);
  return obj;
}

function update_(name, id, patch) {
  const sh = sheet_(name);
  const row = findRow_(sh, id);
  if (row < 0) throw new Error('ไม่พบข้อมูล');
  const h = TABLES[name];
  const cur = sh.getRange(row, 1, 1, h.length).getValues()[0];
  const obj = {};
  h.forEach((k, j) => { obj[k] = cell_(k, cur[j]); });
  Object.assign(obj, patch);
  writeRow_(sh, name, row, obj);
  return obj;
}

function remove_(name, id) {
  const sh = sheet_(name);
  const row = findRow_(sh, id);
  if (row < 0) throw new Error('ไม่พบข้อมูล');
  sh.deleteRow(row);
}

function getById_(name, id) {
  return readAll_(name).find(o => String(o.id) === String(id)) || null;
}

function catMap_() {
  const m = {};
  readAll_('Categories').forEach(c => { m[c.id] = c; });
  return m;
}

/* ===================== Utils ===================== */

function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}
function num_(v) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? round2_(n) : 0;
}
function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function checkDate_(d) {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  return s;
}
function checkMonth_(m) {
  const s = String(m || '');
  if (!/^\d{4}-\d{2}$/.test(s)) throw new Error('รูปแบบเดือนไม่ถูกต้อง');
  return s;
}
function bySort_(a, b) {
  return (a.sort - b.sort) || a.name.localeCompare(b.name, 'th');
}
function byCreated_(a, b) {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
function clean_(data) {
  return JSON.parse(JSON.stringify(data));
}
