// app.js — 多仓完全体版 (2026-11-03)
import { supabase } from './supabase.js'

const SUPABASE_URL = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent) ? 'https://api.mahui.pw' : 'https://gpjdzakvqhnpykuqbfr.supabase.co'
const app = document.getElementById('app')
let currentUser = null, currentProfile = null, isAdmin = false, currentRole = null, isLogistics = false, myVendors = []
let countdownTimer = null, activeHeartbeatTimer = null, maintenanceCheckTimer = null

function msg(text, ok = true) { return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>` }
function isValidSpec(spec) { return spec && /^1\*1\*[1-9]\d*$/.test(String(spec).trim()) }
const SPEC_EMPTY_MSG = '包装规格为空，请先到「商品资料」补全'
const SIZE_EMPTY_MSG = '长、宽、高、重量为必填，请到「商品资料」补全'
function isValidSize(l, w, h, wt) { return [l, w, h, wt].map(Number).every(v => !isNaN(v) && v > 0) }
function isProductInvalid(p) {
  if (!p) return true
  const isSpecValid = p.spec && /^1\*1\*[1-9]\d*$/.test(String(p.spec).trim())
  const isSizeValid = p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0
  const isCodeValid = p.product_code && /^\d+$/.test(String(p.product_code).trim())
  const isNameValid = p.product_name && p.product_name.trim() !== ''
  return !(isSpecValid && isSizeValid && isCodeValid && isNameValid)
}

function translateError(errMsg) {
  if (!errMsg) return '操作失败'
  const m = String(errMsg).toLowerCase()
  if (m.includes('invalid login credentials')) return '邮箱或密码错误'
  if (m.includes('banned')) return '账号已被禁用'
  if (m.includes('row-level security')) return '没有权限执行此操作'
  if (m.includes('duplicate key')) return '数据已存在，请检查'
  if (m.includes('violates not-null')) return '必填字段不能为空'
  if (m.includes('failed to fetch') || m.includes('networkerror')) return '网络连接失败'
  if (/[\u4e00-\u9fa5]/.test(errMsg)) return errMsg
  return '操作失败：' + errMsg
}

async function init() {
  renderLogin()
  try {
    const { data: cfg } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    if (cfg?.config_value === 'true') {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { data: admin } = await supabase.from('admin_users').select('role').eq('id', session.user.id).maybeSingle()
        if (admin?.role !== 'super_admin') return renderMaintenance()
      } else return renderMaintenance()
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    currentUser = session.user
    const ok = await loadProfile()
    if (ok) renderMain()
  } catch (e) { renderLogin('加载失败，请重新登录') }
}

async function loadProfile() {
  const [{ data: profile }, { data: admin }] = await Promise.all([
    supabase.from('vendor_profile').select('*').eq('id', currentUser.id).single(),
    supabase.from('admin_users').select('role, status').eq('id', currentUser.id).maybeSingle()
  ])
  if (profile?.status === 0) { await supabase.auth.signOut(); renderLogin('账号已禁用'); return false }
  if (profile?.must_change_pwd) { renderForceChangePwd(); return false }
  currentProfile = profile
  isAdmin = !!admin || profile?.account_type === 'admin' || (profile?.vendor_code || '').startsWith('ADMIN_')
  currentRole = admin?.role || (isAdmin ? 'admin' : null)
  isLogistics = profile?.account_type === 'logistics'
  if (isLogistics) {
    const { data: lv } = await supabase.from('logistics_vendor').select('vendor_code, vendor_name').eq('logistics_id', currentUser.id).order('vendor_code')
    myVendors = lv || []
  }
  return true
}

function renderMaintenance() { app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;text-align:center;"><h1>系统维护中</h1><button onclick="location.reload()">刷新</button></div>` }

function renderLogin(errMsg = '') {
  app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;"><h1>厂商留库预约系统</h1><div id="login-msg">${errMsg ? msg(errMsg, false) : ''}</div><input id="email" placeholder="账号" /><input id="password" type="password" placeholder="密码" /><button id="btn-login" style="width:100%;">登录</button><button class="secondary" id="btn-goto-change" style="width:100%;margin-top:8px;">修改密码</button></div>`
  document.getElementById('btn-login').onclick = async () => {
    const btn = document.getElementById('btn-login'); let email = document.getElementById('email').value.trim(); const password = document.getElementById('password').value
    if (!email || !password) return document.getElementById('login-msg').innerHTML = msg('请输入账号密码', false)
    if (!email.includes('@')) {
      if (/^\d+$/.test(email)) email += email.startsWith('999') ? '@logistics.local' : '@vendor.local'
      else if (/^[a-zA-Z0-9_]+$/.test(email)) email += '@admin.local'
      else return document.getElementById('login-msg').innerHTML = msg('账号格式错误', false)
    }
    btn.disabled = true; btn.innerText = '登录中...'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { document.getElementById('login-msg').innerHTML = msg(translateError(error.message), false); btn.disabled = false; btn.innerText = '登录'; return }
    try { const { data: { user } } = await supabase.auth.getUser(); if (user) supabase.from('login_log').insert({ vendor_id: user.id, user_agent: navigator.userAgent }).then() } catch (e) {}
    btn.innerText = '加载中...'; await init()
  }
  document.getElementById('btn-goto-change').onclick = () => renderChangePwd()
}

function renderChangePwd() {
  app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;"><h1>修改密码</h1><div id="cp-msg"></div><input id="cp-email" placeholder="账号" /><input id="cp-old" type="password" placeholder="旧密码" /><input id="cp-new" type="password" placeholder="新密码" /><input id="cp-new2" type="password" placeholder="确认新密码" /><button id="btn-cp-submit" style="width:100%;">提交</button><button class="secondary" id="btn-cp-back" style="width:100%;margin-top:8px;">返回</button></div>`
  document.getElementById('btn-cp-back').onclick = () => renderLogin()
  document.getElementById('btn-cp-submit').onclick = async () => {
    const msgEl = document.getElementById('cp-msg'); let email = document.getElementById('cp-email').value.trim(); const oldPwd = document.getElementById('cp-old').value; const newPwd = document.getElementById('cp-new').value; const newPwd2 = document.getElementById('cp-new2').value
    if (!email || !oldPwd || !newPwd || !newPwd2) return msgEl.innerHTML = msg('全必填', false)
    if (!email.includes('@')) { if (/^\d+$/.test(email)) email += email.startsWith('999') ? '@logistics.local' : '@vendor.local'; else if (/^[a-zA-Z0-9_]+$/.test(email)) email += '@admin.local'; else return msgEl.innerHTML = msg('格式错', false) }
    if (newPwd.length < 6) return msgEl.innerHTML = msg('新密码短', false)
    if (newPwd !== newPwd2) return msgEl.innerHTML = msg('不一致', false)
    msgEl.innerHTML = msg('处理中...', true)
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: oldPwd })
    if (signErr) return msgEl.innerHTML = msg('旧密码错', false)
    const { error: updErr } = await supabase.auth.updateUser({ password: newPwd })
    if (updErr) return msgEl.innerHTML = msg(translateError(updErr.message), false)
    await supabase.auth.signOut(); msgEl.innerHTML = msg('成功', true); setTimeout(() => renderLogin('重新登录'), 1500)
  }
}

function renderForceChangePwd() {
  app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;"><h1>强改密码</h1><div id="fp-msg"></div><input id="fp-new" type="password" placeholder="新密码" /><input id="fp-new2" type="password" placeholder="确认" /><button id="btn-fp-submit" style="width:100%;">提交</button><button class="secondary" id="btn-fp-logout" style="width:100%;margin-top:8px;">退出</button></div>`
  document.getElementById('btn-fp-logout').onclick = async () => { await supabase.auth.signOut(); renderLogin() }
  document.getElementById('btn-fp-submit').onclick = async () => {
    const msgEl = document.getElementById('fp-msg'); const p1 = document.getElementById('fp-new').value; const p2 = document.getElementById('fp-new2').value
    if (!p1 || !p2) return msgEl.innerHTML = msg('全必填', false)
    if (p1.length < 6) return msgEl.innerHTML = msg('短', false)
    if (p1 !== p2) return msgEl.innerHTML = msg('不一致', false)
    msgEl.innerHTML = msg('处理中...', true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    if (error) return msgEl.innerHTML = msg(translateError(error.message), false)
    await supabase.from('vendor_profile').update({ must_change_pwd: false }).eq('id', currentUser.id)
    msgEl.innerHTML = msg('成功', true); setTimeout(async () => { const ok = await loadProfile(); if (ok) renderMain() }, 800)
  }
}

function renderMain() {
  const roleTag = isAdmin ? '（管理员）' : isLogistics ? '（物流商）' : ''
  app.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:12px;"><img src="./logo.png" style="height:45px;" onerror="this.style.display='none'" /><div><h1 style="margin-bottom:4px;">厂商留库预约系统</h1><p style="margin:0;">当前用户：${currentProfile?.vendor_name || currentUser.email} ${roleTag}</p></div></div>
      ${!isAdmin ? `<div id="main-countdown" style="display:none;flex:0 0 auto;"><div id="main-countdown-inner" style="display:inline-flex;align-items:center;gap:10px;padding:8px 24px;border-radius:24px;font-size:18px;font-weight:600;background:linear-gradient(135deg,#f6ffed 0%,#e6f4ff 100%);border:1px solid #b7eb8f;color:#389e0d;"><span style="font-size:14px;opacity:.85;">⏱</span><span id="main-countdown-text">--:--:--</span></div></div>` : ''}
      <button class="secondary" id="btn-logout" style="flex:0 0 auto;">退出登录</button>
    </div>
    <div class="nav" id="nav"></div><div id="view"></div>`
  document.getElementById('btn-logout').onclick = async () => { if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer); if (maintenanceCheckTimer) clearInterval(maintenanceCheckTimer); await supabase.auth.signOut(); init() }
  const nav = document.getElementById('nav')
  const tabs = isAdmin ? [['fill','管理填报'], ['admin','管理后台']] : [['fill','填报'],['my','我的单据'],['products','商品资料'],['qc','质检报告']]
  nav.innerHTML = tabs.map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('')
  nav.querySelectorAll('button').forEach(b => { b.onclick = () => { nav.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderView(b.dataset.k) } })
  nav.querySelector('button').classList.add('active'); renderView(tabs[0][0])

  if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer)
  activeHeartbeatTimer = setInterval(async () => { try { await supabase.from('vendor_profile').update({ last_active_at: new Date().toISOString() }).eq('id', currentUser.id) } catch (e) {} }, 3 * 60 * 1000)

  if (currentRole === 'super_admin') return
  if (maintenanceCheckTimer) clearInterval(maintenanceCheckTimer)
  maintenanceCheckTimer = setInterval(async () => {
    try {
      const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
      if (data?.config_value === 'true') { clearInterval(maintenanceCheckTimer); if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer); alert('系统维护中'); await supabase.auth.signOut(); location.reload() }
    } catch (e) {}
  }, 30000)
}

async function renderView(key) {
  const view = document.getElementById('view')
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  const cdEl = document.getElementById('main-countdown'); if (cdEl) cdEl.style.display = 'none'
  if (key === 'fill') return renderFill(view)
  if (key === 'my') return renderMy(view)
  if (key === 'products') return renderProducts(view)
  if (key === 'qc') return renderQC(view)
  if (key === 'admin') { try { const mod = await import('./admin.js'); await mod.renderAdmin(view, { supabase, currentUser, currentProfile, isAdmin, currentRole, msg, SUPABASE_URL, translateError }) } catch (e) { view.innerHTML = msg('后台加载失败', false) } }
}

function addOneDay(d) { if (!d) return null; const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10) }
function addDays(d, n) { if (!d) return null; const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
function todayBj() { const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
function getModeByType(billType) { if (billType === 'VMI入库' || billType.includes('济转西RT(入库)')) return 'UNIFY'; return 'LIKECROSS' }
function calcInFields(billType, supplierInput) { if (billType === 'VMI入库' || billType.includes('济转西RT(入库)')) return { vendor_code: supplierInput, owner_code: supplierInput }; if (billType === 'DSP入库' || billType.includes('济转西DSP(入库)')) return { vendor_code: supplierInput, owner_code: '8888' }; return { vendor_code: supplierInput, owner_code: '' } }
function calcOutFields(billType, supplierInput, defaultStore) { if (billType === 'VMI出库') return { owner_code: supplierInput, store_code: defaultStore || '' }; if (billType === 'DSP出库') return { owner_code: '8888', store_code: '' }; if (billType.startsWith('济转西RT')) return { owner_code: supplierInput, store_code: '8205' }; if (billType.startsWith('济转西DSP')) return { owner_code: '8888', store_code: '8205' }; return { owner_code: '', store_code: '' } }

async function loadDeadlineRange(vendorCode, warehouseCode) {
  const nowBj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const dow = nowBj.getDay(), dayType = (dow === 0 || dow === 6) ? 'weekend' : 'weekday'
  const tries = [{ v: vendorCode, w: warehouseCode, d: dayType }, { v: vendorCode, w: null, d: dayType }, { v: null, w: warehouseCode, d: dayType }, { v: null, w: null, d: dayType }, { v: null, w: null, d: 'all' }]
  for (const t of tries) {
    let q = supabase.from('deadline_config').select('config_value')
    q = t.v ? q.eq('vendor_code', t.v) : q.is('vendor_code', null)
    q = t.w ? q.eq('warehouse_code', t.w) : q.is('warehouse_code', null)
    const { data } = await q.eq('day_type', t.d).maybeSingle()
    if (data?.config_value) return { range: data.config_value, dayType }
  }
  return { range: dayType === 'weekend' ? '08:00-12:00' : '07:00-15:00', dayType }
}

function calcCountdown(range) {
  const [sStr, eStr] = range.split('-'); const [sh, sm] = sStr.split(':').map(Number); const [eh, em] = eStr.split(':').map(Number)
  const nowBj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const nowSec = nowBj.getHours() * 3600 + nowBj.getMinutes() * 60 + nowBj.getSeconds(), startSec = sh * 3600 + sm * 60, endSec = eh * 3600 + em * 60
  const fmt = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
  if (nowSec < startSec) return { text: `距开始还有 ${fmt(startSec - nowSec)}`, bg: 'linear-gradient(135deg,#fff7e6 0%,#fff1b8 100%)', border: '#ffd591', color: '#d46b08' }
  if (nowSec < endSec) return { text: `距截止还有 ${fmt(endSec - nowSec)}`, bg: 'linear-gradient(135deg,#f6ffed 0%,#e6f4ff 100%)', border: '#b7eb8f', color: '#389e0d' }
  return { text: '今日预约已截止', bg: 'linear-gradient(135deg,#fff2f0 0%,#ffccc7 100%)', border: '#ffa39e', color: '#cf1322' }
}

// ================= 填报页 (多仓版) =================
async function renderFill(view) {
  let selectedVendor = null, isAdminDelegate = isAdmin
  if (isAdminDelegate) {
    const { data: vps } = await supabase.from('vendor_profile').select('vendor_code, vendor_name').eq('account_type', 'vendor').order('vendor_code')
    if (!vps || !vps.length) return view.innerHTML = `<div class="card"><h2>代报单据</h2><p style="color:#cf1322;">暂无厂商</p></div>`
    myVendors = vps; selectedVendor = vps[0]
  } else if (isLogistics) {
    if (!myVendors.length) return view.innerHTML = `<div class="card"><h2>填报单据</h2><p style="color:#cf1322;">未配置厂商</p></div>`
    selectedVendor = myVendors[0]
  } else {
    selectedVendor = { vendor_code: currentProfile?.vendor_code || '', vendor_name: currentProfile?.vendor_name || '' }
  }

  let myVendorCode = selectedVendor.vendor_code
  let myWhs = [], currentWarehouseCode = '', locs = [], myStores = [], range = '07:00-15:00', defaultStoreCode = '', productList = []
  let inRows = [], outRows = []

  async function loadWarehouseContext(whCode) {
    currentWarehouseCode = whCode
    const { data: whInfo } = await supabase.from('warehouse').select('default_store_code').eq('warehouse_code', whCode).maybeSingle()
    defaultStoreCode = whInfo?.default_store_code || ''
    const { data: l } = await supabase.from('location_config').select('warehouse_code, location_code').eq('status', 1).eq('warehouse_code', whCode)
    locs = l || []
    const { data: s } = await supabase.from('store_config').select('warehouse_code, store_code, store_name').eq('status', 1)
    myStores = (s||[]).filter(x => !x.warehouse_code || x.warehouse_code === whCode)
    const { data: p } = await supabase.from('product_master').select('product_code, product_name, spec, length, width, height, weight').eq('default_vendor_code', myVendorCode).eq('warehouse_code', whCode).order('product_code')
    productList = p || []
    const res = await loadDeadlineRange(myVendorCode, whCode); range = res.range
    inRows = [newInRowForVendor(myVendorCode)]; outRows = [newOutRowForVendor(myVendorCode)]
  }

  async function loadVendorWarehouses() {
    let vpsId = currentUser.id
    if (isAdminDelegate || isLogistics) { const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', myVendorCode).maybeSingle(); if (vp) vpsId = vp.id }
    const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vpsId)
    myWhs = (vw||[]).map(x => x.warehouse_code)
    if (myWhs.length > 0) await loadWarehouseContext(myWhs[0])
  }
  await loadVendorWarehouses()

  function newInRowForVendor(vc) { const f = calcInFields('VMI入库', vc); return { source_no: '', bill_type: 'VMI入库', vendor_code: f.vendor_code, owner_code: f.owner_code, location_code: (locs[0]?.location_code || ''), product_code: '', spec: '', quantity: '', arrival_date: addDays(todayBj(), 1), product_name: '' } }
  function newOutRowForVendor(vc) { const f = calcOutFields('VMI出库', vc, defaultStoreCode); return { bill_type: 'VMI出库', source_no: '', owner_code: f.owner_code, store_code: f.store_code, location_code: (locs[0]?.location_code || ''), pick_date: addDays(todayBj(), 2), product_code: '', spec: '', quantity: '', product_name: '' } }
  function isInRowFilled(r) { return !!(r.product_code || r.spec || r.quantity) }
  function isOutRowFilled(r) { return !!(r.product_code || r.spec || r.quantity || r.source_no) }
  function findProduct(code) { return productList.find(p => p.product_code === code) }
  function productOptionsHtml() { return productList.map(p => `<option value="${p.product_code}">${p.product_code} - ${p.product_name||''} - ${p.spec||''}</option>`).join('') }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer)
    const wrap = document.getElementById('main-countdown'); if (!wrap) return; wrap.style.display = 'block'
    const tick = () => {
      const c = calcCountdown(range)
      const inner = document.getElementById('main-countdown-inner'), textEl = document.getElementById('main-countdown-text')
      if (inner) { inner.style.background = c.bg; inner.style.borderColor = c.border; inner.style.color = c.color }
      if (textEl) textEl.textContent = c.text
    }
    tick(); countdownTimer = setInterval(tick, 1000)
  }

  function render() {
    const whOpts = myWhs.map(w => `<option value="${w}" ${w===currentWarehouseCode?'selected':''}>${w}</option>`).join('')
    view.innerHTML = `
      <div class="card">
        <h2>${isAdminDelegate ? '管理员代报' : '填报单据'}</h2>
        <div class="row" style="margin-bottom:12px;">
          ${isLogistics || isAdminDelegate ? `<div style="position:relative; flex:1;"><label>代报厂商 *</label><input id="vendor-search-input" value="${myVendorCode}" autocomplete="off" /><div id="vendor-suggest-box" style="position:absolute; top:65px; left:0; right:0; background:#fff; border:1px solid #eee; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,.1); z-index:100; display:none; max-height:200px; overflow:auto;"></div></div>` : ''}
          <div style="flex:1;"><label>选择仓库 *</label><select id="wh-select">${whOpts}</select></div>
        </div>
        <div id="fill-msg"></div>
        <h3 style="margin:16px 0 8px;">入库单</h3>
        <div style="background:#f6ffed; border:1px dashed #b7eb8f; border-radius:4px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; color:#389e0d; margin-bottom:8px; font-weight:bold;">⚡ 批量录入（从 Excel 复制：货号 / 箱数）</div>
          <textarea id="in-paste-area" placeholder="在此粘贴..." style="width:100%; height:80px; padding:8px; margin-bottom:8px;"></textarea>
          <div style="display:flex; gap:8px;"><button type="button" class="secondary" id="btn-parse-in" style="background:#f6ffed; border-color:#52c41a; color:#389e0d;">添加到表格</button><button type="button" class="secondary" id="btn-clear-in-paste">清空</button></div>
        </div>
        <div style="overflow-x:auto;"><table style="white-space:nowrap;"><thead><tr><th>类型</th><th>供应商代码</th><th>货主代码</th><th>仓位</th><th>商品代码</th><th>规格</th><th>箱数</th><th>到货日期</th><th>操作</th></tr></thead><tbody id="in-body"></tbody></table></div>
        <button class="secondary small" id="btn-add-in" style="margin-top:8px;">+ 添加入库行</button>

        <h3 style="margin:24px 0 8px;">出库单</h3>
        <div style="background:#f0f5ff; border:1px dashed #91caff; border-radius:4px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; color:#1677ff; margin-bottom:8px; font-weight:bold;">⚡ 批量录入<br><span style="font-size:12px; font-weight:normal; color:#666;">复制 3 列默认 VMI；4 列自动识别 DSP。</span></div>
          <textarea id="out-paste-area" placeholder="在此粘贴..." style="width:100%; height:80px; padding:8px; margin-bottom:8px;"></textarea>
          <div style="display:flex; gap:8px;"><button type="button" class="secondary" id="btn-parse-out" style="background:#e6f4ff; border-color:#1677ff; color:#1677ff;">添加到表格</button><button type="button" class="secondary" id="btn-clear-paste">清空</button></div>
        </div>
        <div style="overflow-x:auto;"><table style="white-space:nowrap;"><thead><tr><th>类型</th><th>采购单号</th><th>货主代码</th><th>门店代码</th><th>仓位</th><th>配货日期</th><th>商品代码</th><th>规格</th><th>箱数</th><th>操作</th></tr></thead><tbody id="out-body"></tbody></table></div>
        <button class="secondary small" id="btn-add-out" style="margin-top:8px;">+ 添加出库行</button>
        <h3 style="margin:24px 0 8px;">预览</h3><div id="preview-box"></div>
        <div style="margin-top:16px;"><button id="btn-submit-all">提交预约</button><button class="secondary" id="btn-clear-all">清空</button></div>
      </div>`

    renderInTable(); renderOutTable(); renderPreview(); if (!isAdminDelegate) startCountdown()

    document.getElementById('wh-select').onchange = async (e) => {
      if (inRows.some(isInRowFilled) || outRows.some(isOutRowFilled)) { if (!confirm('切换仓库会清空当前已填写的内容，确定切换吗？')) { e.target.value = currentWarehouseCode; return } }
      const newWh = e.target.value; await loadWarehouseContext(newWh); render()
    }

    if (isLogistics || isAdminDelegate) {
      const sInput = document.getElementById('vendor-search-input'), sBox = document.getElementById('vendor-suggest-box')
      sInput.oninput = () => {
        const kw = sInput.value.trim().toLowerCase(); if (!kw) return sBox.style.display = 'none'
        const matches = myVendors.filter(v => v.vendor_code.toLowerCase().includes(kw) || (v.vendor_name||'').toLowerCase().includes(kw)).slice(0, 10)
        if (!matches.length) return sBox.style.display = 'none'
        sBox.innerHTML = matches.map(v => `<div data-pick="${v.vendor_code}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f5f5f5;">${v.vendor_code} - ${v.vendor_name}</div>`).join('')
        sBox.style.display = 'block'
        sBox.querySelectorAll('[data-pick]').forEach(el => {
          el.onmousedown = async (e) => {
            e.preventDefault(); const vc = el.dataset.pick; if (vc === myVendorCode) return sBox.style.display = 'none'
            if (inRows.some(isInRowFilled) || outRows.some(isOutRowFilled)) { if (!confirm('切换厂商会清空当前内容，确定吗？')) return }
            selectedVendor = myVendors.find(v => v.vendor_code === vc); myVendorCode = vc; sInput.value = vc; sBox.style.display = 'none'
            await loadVendorWarehouses(); render()
          }
        })
      }
      sInput.onblur = () => setTimeout(() => sBox.style.display = 'none', 200)
    }

    document.getElementById('btn-add-in').onclick = () => { inRows.push(newInRowForVendor(myVendorCode)); renderInTable(); renderPreview() }
    document.getElementById('btn-add-out').onclick = () => { outRows.push(newOutRowForVendor(myVendorCode)); renderOutTable(); renderPreview() }

    document.getElementById('btn-parse-in').onclick = () => {
      const txt = document.getElementById('in-paste-area').value.trim(); if (!txt) return
      const lines = txt.split(/\r?\n/).filter(l => l.trim()); let errors = [], parsed = new Map()
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean); if (cols.length < 2) { errors.push(`第${i+1}行列数不足`); continue }
        const code = cols[0], qty = Number(cols[cols.length - 1]); if (!/^\d+$/.test(code)) { errors.push(`第${i+1}行货号非数字`); continue }
        const p = findProduct(code); if (!p) { errors.push(`第${i+1}行不存在(${code})`); continue }
        if (isProductInvalid(p)) { errors.push(`第${i+1}行资料不全`); continue }
        if (parsed.has(code)) parsed.get(code).quantity += qty; else parsed.set(code, { product_code: code, product_name: p.product_name, spec: p.spec, quantity: qty })
      }
      if (errors.length) return alert(`❌ 失败：\n` + errors.slice(0, 5).join('\n'))
      let count = 0
      parsed.forEach(item => {
        const exist = inRows.find(r => r.bill_type === 'VMI入库' && r.product_code === item.product_code)
        if (exist) exist.quantity = Number(exist.quantity) + item.quantity
        else { const newRow = newInRowForVendor(myVendorCode); Object.assign(newRow, item); inRows.push(newRow); count++ }
      })
      document.getElementById('in-paste-area').value = ''; renderInTable(); renderPreview(); alert(`✅ 成功新增 ${count} 行`)
    }

    document.getElementById('btn-clear-in-paste').onclick = () => { document.getElementById('in-paste-area').value = '' }
    document.getElementById('btn-clear-paste').onclick = () => { document.getElementById('out-paste-area').value = '' }

    document.getElementById('btn-parse-out').onclick = () => {
      const txt = document.getElementById('out-paste-area').value.trim(); if (!txt) return
      const lines = txt.split(/\r?\n/).filter(l => l.trim()); let errors = [], parsed = new Map()
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean); if (cols.length < 3) { errors.push(`第${i+1}行列数不足`); continue }
        const rawNo = cols[0].split(' ')[0].trim(), code = cols[1], qty = Number(cols[2])
        if (!/^\d{9}$/.test(rawNo)) { errors.push(`第${i+1}行单号非9位`); continue }
        if (!/^\d+$/.test(code)) { errors.push(`第${i+1}行货号非数字`); continue }
        const p = findProduct(code); if (!p) { errors.push(`第${i+1}行货号不存在`); continue }
        if (isProductInvalid(p)) { errors.push(`第${i+1}行资料不全`); continue }
        let bType = 'VMI出库', store = ''
        if (cols.length >= 4) { bType = 'DSP出库'; const rawStore = cols[3]; const ms = myStores.find(s => s.store_code === rawStore || rawStore.includes(s.store_name) || rawStore.includes(s.store_code)); if (!ms) { errors.push(`第${i+1}行门店未找到`); continue }; store = ms.store_code }
        const key = `${rawNo}_${code}_${bType}_${store}`
        if (parsed.has(key)) parsed.get(key).quantity += qty; else parsed.set(key, { source_no: rawNo, product_code: code, product_name: p.product_name, spec: p.spec, quantity: qty, billType: bType, storeCode: store })
      }
      if (errors.length) return alert(`❌ 失败：\n` + errors.slice(0, 5).join('\n'))
      let count = 0
      parsed.forEach(item => {
        const exist = outRows.find(r => r.source_no === item.source_no && r.product_code === item.product_code && r.bill_type === item.billType && r.store_code === item.storeCode)
        if (exist) exist.quantity = Number(exist.quantity) + item.quantity
        else {
          const newRow = newOutRowForVendor(myVendorCode); Object.assign(newRow, { source_no: item.source_no, product_code: item.product_code, product_name: item.product_name, spec: item.spec, quantity: item.quantity, bill_type: item.billType })
          if (item.billType === 'DSP出库') { newRow.owner_code = '8888'; newRow.store_code = item.storeCode }
          outRows.push(newRow); count++
        }
      })
      document.getElementById('out-paste-area').value = ''; renderOutTable(); renderPreview(); alert(`✅ 成功新增 ${count} 行`)
    }

    document.getElementById('btn-clear-all').onclick = () => { if (!confirm('确定清空？')) return; inRows = [newInRowForVendor(myVendorCode)]; outRows = [newOutRowForVendor(myVendorCode)]; render() }

    document.getElementById('btn-submit-all').onclick = async () => {
      const msgEl = document.getElementById('fill-msg')
      if (!currentWarehouseCode) return msgEl.innerHTML = msg('请先选择仓库', false)
      const vIn = inRows.filter(isInRowFilled), vOut = outRows.filter(isOutRowFilled)
      if (!vIn.length && !vOut.length) return msgEl.innerHTML = msg('请填写单据', false)
      const errors = []
      inRows.forEach((r, i) => { if (!isInRowFilled(r)) return; if (!r.location_code) errors.push(`入库第${i+1}行缺仓位`); if (!r.quantity) errors.push(`入库第${i+1}行缺箱数`); if (!r.arrival_date) errors.push(`入库第${i+1}行缺到货日期`) })
      outRows.forEach((r, i) => { if (!isOutRowFilled(r)) return; if (r.bill_type === 'VMI出库' && !r.source_no) errors.push(`出库第${i+1}行缺单号`); if (!r.location_code) errors.push(`出库第${i+1}行缺仓位`); if (!r.quantity) errors.push(`出库第${i+1}行缺箱数`); if (!r.pick_date) errors.push(`出库第${i+1}行缺配货日期`); if (r.bill_type.includes('DSP') && !r.store_code) errors.push(`出库第${i+1}行缺门店`) })
      if (errors.length) return msgEl.innerHTML = `<div class="msg err">${errors.map(e => `<div>${e}</div>`).join('')}</div>`
      
      let vAuthId = currentUser.id
      if (isLogistics || isAdminDelegate) { const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', myVendorCode).maybeSingle(); vAuthId = vp?.id }
      const calcQty = (s, q) => !q ? 0 : (!s ? Number(q) : Number(q) * (Number(String(s).split('*').pop()) || 1))
      
      const iPayloads = vIn.map(r => ({ vendor_id: vAuthId, warehouse_code: currentWarehouseCode, bill_type: r.bill_type, source_no: r.source_no || null, vendor_code: r.vendor_code, owner_code: r.owner_code, location_code: r.location_code, logistics_mode: getModeByType(r.bill_type), product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity), price: 1, arrival_date: r.arrival_date, effective_date: addOneDay(r.arrival_date), whole_process: 'NO', product_remark: r.product_name || r.product_code || '无', submitter_type: isAdmin ? 'admin' : 'vendor' }))
      const oPayloads = vOut.map(r => ({ vendor_id: vAuthId, warehouse_code: currentWarehouseCode, bill_type: r.bill_type, source_no: r.source_no || null, inbound_order_no: r.source_no || null, owner_code: r.owner_code, store_code: r.store_code, location_code: r.location_code, logistics_mode: getModeByType(r.bill_type), pick_date: r.pick_date, effective_date: addOneDay(r.pick_date), product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity), price: 1, product_remark: r.product_name || r.product_code || '无', submitter_type: isAdmin ? 'admin' : 'vendor', vendor_code: myVendorCode }))
      
      msgEl.innerHTML = msg('提交中...', true)
      const { error } = await supabase.from('bill_order').insert([...iPayloads, ...oPayloads])
      if (error) return msgEl.innerHTML = msg(translateError(error.message), false)
      msgEl.innerHTML = msg(`预约成功！`, true)
      setTimeout(() => { inRows = [newInRowForVendor(myVendorCode)]; outRows = [newOutRowForVendor(myVendorCode)]; render() }, 800)
    }
  }

  function renderInTable() {
    const tbody = document.getElementById('in-body'); if (!tbody) return
    tbody.innerHTML = inRows.map((r, i) => {
      const autoS = (r.owner_code && r.arrival_date) ? r.owner_code + r.arrival_date.replace(/-/g, '') : ''; if (autoS) r.source_no = autoS
      return `<tr>
        <td><select data-i="${i}" data-f="bill_type" style="width:120px;margin:0;padding:4px;"><option value="VMI入库" ${r.bill_type==='VMI入库'?'selected':''}>VMI入库</option><option value="DSP入库" ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option><option value="济转西RT(入库)" ${r.bill_type==='济转西RT(入库)'?'selected':''}>济转西RT(入库)</option><option value="济转西DSP(入库)" ${r.bill_type==='济转西DSP(入库)'?'selected':''}>济转西DSP(入库)</option></select></td>
        <td><input data-i="${i}" data-f="vendor_code" value="${r.vendor_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
        <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
        <td><select data-i="${i}" data-f="location_code" style="width:70px;margin:0;padding:4px;">${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}</select></td>
        <td><input list="product-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:110px;margin:0;padding:4px;" /></td>
        <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:80px;margin:0;padding:4px;" /></td>
        <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:60px;margin:0;padding:4px;" /></td>
        <td><input type="date" data-i="${i}" data-f="arrival_date" value="${r.arrival_date}" ${isAdminDelegate ? '' : 'readonly'} style="width:110px;margin:0;padding:4px;${isAdminDelegate ? '' : 'background:#f5f5f5; pointer-events: none;'}" /></td>
        <td><button class="small danger" data-del-in="${i}" style="padding:4px 8px;">删除</button></td>
      </tr>`
    }).join('')
    let dl = document.getElementById('product-list'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'product-list'; document.body.appendChild(dl) }; dl.innerHTML = productOptionsHtml()

    tbody.querySelectorAll('input,select').forEach(el => {
      el.oninput = el.onchange = () => {
        const i = Number(el.dataset.i), f = el.dataset.f, r = inRows[i]
        if (f === 'product_code') { r.product_code = el.value; const p = findProduct(el.value); if (p) { if (isProductInvalid(p)) { alert(`资料不完善`); el.value = ''; r.product_code = ''; r.spec = ''; const sp = el.closest('tr').querySelector('[data-f="spec"]'); if (sp) sp.value = ''; return; } r.product_name = p.product_name || ''; r.spec = p.spec || ''; el.closest('tr').querySelector('[data-f="spec"]').value = r.spec } else { r.product_name = '' }; renderPreview(); return }
        if (f === 'bill_type') { r.bill_type = el.value; const f2 = calcInFields(r.bill_type, r.vendor_code); r.owner_code = f2.owner_code; r.source_no = (r.vendor_code && r.arrival_date) ? r.vendor_code + r.arrival_date.replace(/-/g, '') : ''; renderInTable(); renderPreview(); return }
        r[f] = el.value; if (f === 'vendor_code' || f === 'arrival_date') r.source_no = (r.owner_code && r.arrival_date) ? r.owner_code + r.arrival_date.replace(/-/g, '') : ''; renderPreview()
      }
    })
    tbody.querySelectorAll('[data-del-in]').forEach(b => { b.onclick = () => { const i = Number(b.dataset.delIn); if (inRows.length === 1) return; inRows.splice(i, 1); renderInTable(); renderPreview() } })
  }

  function renderOutTable() {
    const tbody = document.getElementById('out-body'); if (!tbody) return
    tbody.innerHTML = outRows.map((r, i) => `<tr>
      <td><select data-i="${i}" data-f="bill_type" style="width:140px;margin:0;padding:4px;"><option value="VMI出库" ${r.bill_type==='VMI出库'?'selected':''}>VMI出库</option><option value="DSP出库" ${r.bill_type==='DSP出库'?'selected':''}>DSP出库</option><option value="济转西RT(留库)" ${r.bill_type==='济转西RT(留库)'?'selected':''}>济转西RT(留库)</option><option value="济转西RT(越库)" ${r.bill_type==='济转西RT(越库)'?'selected':''}>济转西RT(越库)</option><option value="济转西DSP(留库)" ${r.bill_type==='济转西DSP(留库)'?'selected':''}>济转西DSP(留库)</option><option value="济转西DSP(越库)" ${r.bill_type==='济转西DSP(越库)'?'selected':''}>济转西DSP(越库)</option></select></td>
      <td><input data-i="${i}" data-f="source_no" value="${r.source_no || ''}" placeholder="单号" style="width:100px;margin:0;padding:4px;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td>${(r.bill_type === 'VMI出库' || r.bill_type.includes('济转西')) ? `<input data-i="${i}" data-f="store_code" value="${r.store_code}" readonly style="width:90px;margin:0;padding:4px;background:#f5f5f5;" />` : `<select data-i="${i}" data-f="store_code" style="width:110px;margin:0;padding:4px;"><option value="">请选择</option>${myStores.map(s => `<option value="${s.store_code}" ${r.store_code===s.store_code?'selected':''}>${s.store_code} - ${s.store_name||''}</option>`).join('')}</select>`}</td>
      <td><select data-i="${i}" data-f="location_code" style="width:70px;margin:0;padding:4px;">${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}</select></td>
      <td><input type="date" data-i="${i}" data-f="pick_date" value="${r.pick_date}" ${isAdminDelegate ? '' : 'readonly'} style="width:110px;margin:0;padding:4px;${isAdminDelegate ? '' : 'background:#f5f5f5; pointer-events: none;'}" /></td>
      <td><input list="product-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:110px;margin:0;padding:4px;" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:80px;margin:0;padding:4px;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:60px;margin:0;padding:4px;" /></td>
      <td><button class="small danger" data-del-out="${i}" style="padding:4px 8px;">删除</button></td>
    </tr>`).join('')

    tbody.querySelectorAll('input,select').forEach(el => {
      el.oninput = el.onchange = () => {
        const i = Number(el.dataset.i), f = el.dataset.f, r = outRows[i]
        if (f === 'product_code') { r.product_code = el.value; const p = findProduct(el.value); if (p) { if (isProductInvalid(p)) { alert(`资料不完善`); el.value = ''; r.product_code = ''; r.spec = ''; const sp = el.closest('tr').querySelector('[data-f="spec"]'); if (sp) sp.value = ''; return; } r.product_name = p.product_name || ''; r.spec = p.spec || ''; el.closest('tr').querySelector('[data-f="spec"]').value = r.spec } else { r.product_name = '' }; renderPreview(); return }
        if (f === 'bill_type') { r.bill_type = el.value; const f2 = calcOutFields(r.bill_type, myVendorCode, defaultStoreCode); r.owner_code = f2.owner_code; r.store_code = f2.store_code; renderOutTable(); renderPreview(); return }
        r[f] = el.value; renderPreview()
      }
    })
    tbody.querySelectorAll('[data-del-out]').forEach(b => { b.onclick = () => { const i = Number(b.dataset.delOut); if (outRows.length === 1) return; outRows.splice(i, 1); renderOutTable(); renderPreview() } })
  }

  function renderPreview() {
    const box = document.getElementById('preview-box'); if (!box) return
    const vIn = inRows.filter(r => r.product_code && r.quantity), vOut = outRows.filter(r => r.product_code && r.quantity)
    box.innerHTML = `<div style="margin-bottom:12px; overflow-x:auto;"><strong>入库 ${vIn.length} 条：</strong>${vIn.length === 0 ? '<span style="color:#999;">无</span>' : `<table style="margin-top:6px; white-space:nowrap;"><tr><th>类型</th><th>供应商</th><th>货主</th><th>仓位</th><th>商品</th><th>品名</th><th>规格</th><th>箱数</th><th>到货日</th></tr>${vIn.map(r => `<tr><td>${r.bill_type}</td><td>${r.vendor_code}</td><td>${r.owner_code}</td><td>${r.location_code}</td><td>${r.product_code}</td><td>${r.product_name||''}</td><td>${r.spec}</td><td>${r.quantity}</td><td>${r.arrival_date||'-'}</td></tr>`).join('')}</table>`}</div>
      <div style="overflow-x:auto;"><strong>出库 ${vOut.length} 条：</strong>${vOut.length === 0 ? '<span style="color:#999;">无</span>' : `<table style="margin-top:6px; white-space:nowrap;"><tr><th>类型</th><th>单号</th><th>货主</th><th>门店</th><th>仓位</th><th>配货日</th><th>商品</th><th>品名</th><th>规格</th><th>箱数</th></tr>${vOut.map(r => `<tr><td>${r.bill_type}</td><td>${r.source_no||'-'}</td><td>${r.owner_code}</td><td>${r.store_code}</td><td>${r.location_code}</td><td>${r.pick_date||'-'}</td><td>${r.product_code}</td><td>${r.product_name||''}</td><td>${r.spec}</td><td>${r.quantity}</td></tr>`).join('')}</table>`}</div>`
  }

  render()
}

// ================= 商品资料 (多仓强隔离版) =================
async function renderProducts(view) {
  if (isAdmin) return view.innerHTML = `<div class="card"><h2>商品资料</h2><p style="color:#999;">请到管理后台维护。</p></div>`
  let selectedVendorCode = isLogistics ? (myVendors[0]?.vendor_code || '') : (currentProfile?.vendor_code || '')
  let myWhs = [], currentWhCode = ''
  let list = []

  async function loadWhs(vCode) {
    let vpsId = currentUser.id
    if (isLogistics) { const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', vCode).maybeSingle(); if (vp) vpsId = vp.id }
    const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vpsId)
    myWhs = (vw || []).map(x => x.warehouse_code)
    if (myWhs.length > 0) currentWhCode = myWhs[0]
  }

  async function loadList(vCode, whCode) {
    const { data } = await supabase.from('product_master').select('*').eq('default_vendor_code', vCode).eq('warehouse_code', whCode).order('id', { ascending: false })
    list = data || []
  }

  await loadWhs(selectedVendorCode); await loadList(selectedVendorCode, currentWhCode)

  function renderAll() {
    const invalidCount = list.filter(r => isProductInvalid(r)).length
    let warnHtml = invalidCount > 0 ? `<div style="background:#fff2f0; border:1px solid #ffccc7; border-radius:8px; padding:16px; margin-bottom:16px;"><h3 style="color:#cf1322; margin:0 0 8px 0;">⚠️ 您有 ${invalidCount} 个商品资料不完善</h3><p style="color:#cf1322; font-size:13px; margin:0;">请点击下方的「编辑」进行修改！</p></div>` : ''

    view.innerHTML = `
      ${warnHtml}
      <div class="card">
        <div class="row">
          ${isLogistics ? `<div><label>选择厂商</label><select id="prod-vendor-select">${myVendors.map(v => `<option value="${v.vendor_code}" ${v.vendor_code===selectedVendorCode?'selected':''}>${v.vendor_code} - ${v.vendor_name}</option>`).join('')}</select></div>` : ''}
          <div><label>选择仓库 *</label><select id="prod-wh-select">${myWhs.map(w => `<option value="${w}" ${w===currentWhCode?'selected':''}>${w}</option>`).join('')}</select></div>
        </div>
      </div>
      <div class="card">
        <h2>新增商品</h2><div id="prod-msg"></div>
        <div class="row"><div><label>货号 *</label><input id="pd-code" /></div><div><label>品名 *</label><input id="pd-name" /></div><div><label>规格 * (1*1*X)</label><input id="pd-spec" placeholder="如 1*1*24" /></div></div>
        <div class="row"><div><label>长 (cm) *</label><input id="pd-length" type="number" step="0.01" min="0.01" /></div><div><label>宽 (cm) *</label><input id="pd-width" type="number" step="0.01" min="0.01" /></div><div><label>高 (cm) *</label><input id="pd-height" type="number" step="0.01" min="0.01" /></div><div><label>重量 (kg) *</label><input id="pd-weight" type="number" step="0.01" min="0.01" /></div></div>
        <p style="font-size:12px;color:#666;margin:8px 0;">将写入当前选中仓库：<strong>${currentWhCode}</strong></p>
        <button id="btn-pd-add">新增商品</button>
      </div>
      <div class="card">
        <h2>商品列表（${list.length}）</h2>
        <div class="scroll"><table><tr><th>货号</th><th>品名</th><th>规格</th><th>长×宽×高</th><th>重量</th><th>操作</th></tr>
          <tbody>${list.map(r => {
            const invalid = isProductInvalid(r), bg = invalid ? 'background:#fff1f0;' : ''
            return `<tr style="${bg}"><td>${r.product_code||''} ${invalid ? '<span style="color:#cf1322;font-size:11px;">(资料不全)</span>' : ''}</td><td>${r.product_name||'<span style="color:#cf1322;">缺失</span>'}</td><td>${r.spec||'<span style="color:#cf1322;">缺失</span>'}</td><td>${r.length ?? '0'}×${r.width ?? '0'}×${r.height ?? '0'} cm</td><td>${r.weight ?? '0'} kg</td><td><button class="small ${invalid ? '' : 'secondary'}" data-edit="${r.product_code}">编辑</button></td></tr>`
          }).join('') || '<tr><td colspan="6">无数据</td></tr>'}</tbody>
        </table></div>
      </div><div id="edit-product-panel"></div>`

    if (isLogistics) document.getElementById('prod-vendor-select').onchange = async (e) => { selectedVendorCode = e.target.value; await loadWhs(selectedVendorCode); await loadList(selectedVendorCode, currentWhCode); renderAll() }
    document.getElementById('prod-wh-select').onchange = async (e) => { currentWhCode = e.target.value; await loadList(selectedVendorCode, currentWhCode); renderAll() }

    document.getElementById('btn-pd-add').onclick = async () => {
      const msgEl = document.getElementById('prod-msg'), code = document.getElementById('pd-code').value.trim(), name = document.getElementById('pd-name').value.trim(), spec = document.getElementById('pd-spec').value.trim(), l = document.getElementById('pd-length').value.trim(), w = document.getElementById('pd-width').value.trim(), h = document.getElementById('pd-height').value.trim(), wt = document.getElementById('pd-weight').value.trim()
      if (!code || !name || !spec || !l || !w || !h || !wt) return msgEl.innerHTML = msg('所有字段必填', false)
      if (!/^\d+$/.test(code)) return msgEl.innerHTML = msg('货号必须纯数字', false)
      if (!isValidSpec(spec)) return msgEl.innerHTML = msg('规格格式错误', false)
      if (!isValidSize(l, w, h, wt)) return msgEl.innerHTML = msg('长宽高重量必须为正数', false)
      const { data: exist } = await supabase.from('product_master').select('id').eq('warehouse_code', currentWhCode).eq('default_vendor_code', selectedVendorCode).eq('product_code', code).maybeSingle()
      if (exist) return msgEl.innerHTML = msg(`货号 ${code} 在仓库 ${currentWhCode} 下已存在`, false)
      const { error } = await supabase.from('product_master').insert([{ warehouse_code: currentWhCode, product_code: code, product_name: name, spec, length: Number(l), width: Number(w), height: Number(h), weight: Number(wt), default_vendor_code: selectedVendorCode, default_owner_code: selectedVendorCode }])
      if (error) return msgEl.innerHTML = msg(translateError(error.message), false)
      msgEl.innerHTML = msg(`新增成功！`, true); setTimeout(async () => { await loadList(selectedVendorCode, currentWhCode); renderAll() }, 600)
    }

    view.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => {
        const code = btn.dataset.edit, first = list.find(r => r.product_code === code); if (!first) return
        const panel = document.getElementById('edit-product-panel')
        panel.innerHTML = `<div class="card"><h2>编辑商品：${code}</h2><div id="pedit-msg"></div>
          <div class="row"><div><label>品名 *</label><input id="pe-name" value="${first.product_name||''}" /></div><div><label>规格 *</label><input id="pe-spec" value="${first.spec||''}" /></div></div>
          <div class="row"><div><label>长(cm) *</label><input id="pe-length" type="number" step="0.01" value="${first.length||''}" /></div><div><label>宽(cm) *</label><input id="pe-width" type="number" step="0.01" value="${first.width||''}" /></div><div><label>高(cm) *</label><input id="pe-height" type="number" step="0.01" value="${first.height||''}" /></div><div><label>重量(kg) *</label><input id="pe-weight" type="number" step="0.01" value="${first.weight||''}" /></div></div>
          <button id="btn-pe-save">保存</button><button class="secondary" id="btn-pe-cancel">取消</button></div>`
        document.getElementById('btn-pe-cancel').onclick = () => panel.innerHTML = ''
        document.getElementById('btn-pe-save').onclick = async () => {
          const msgEl = document.getElementById('pedit-msg'), n = document.getElementById('pe-name').value.trim(), s = document.getElementById('pe-spec').value.trim(), l = document.getElementById('pe-length').value.trim(), w = document.getElementById('pe-width').value.trim(), h = document.getElementById('pe-height').value.trim(), wt = document.getElementById('pe-weight').value.trim()
          if (!n || !s || !l || !w || !h || !wt) return msgEl.innerHTML = msg('必填字段不能为空', false)
          if (!isValidSpec(s)) return msgEl.innerHTML = msg('规格格式错误', false)
          const { error } = await supabase.from('product_master').update({ product_name: n, spec: s, length: Number(l), width: Number(w), height: Number(h), weight: Number(wt) }).eq('id', first.id)
          if (error) return msgEl.innerHTML = msg(translateError(error.message), false)
          msgEl.innerHTML = msg('已保存', true); setTimeout(async () => { await loadList(selectedVendorCode, currentWhCode); renderAll() }, 600)
        }
      }
    })
  }
  renderAll()
}

// ================= 我的单据 =================
async function renderMy(view) {
  let currentPage = 0; const pageSize = 20; let keyword = ''
  view.innerHTML = `<div class="card"><h2>${isLogistics ? '单据' : '我的单据'}</h2><div class="row" style="margin-bottom:12px;"><input id="my-search" placeholder="输入单号/商品代码查询" style="flex:1;margin:0;" /><button id="btn-my-search" class="secondary" style="flex:0 0 80px;">查询</button></div><div class="scroll" style="max-height:600px;"><table><tr><th>ID</th><th>仓库</th><th>类型</th><th>商品</th><th>数量</th><th>已导出</th><th>时间</th><th>操作</th></tr><tbody id="my-body"></tbody></table></div><div id="my-pagination" style="display:flex;justify-content:flex-end;margin-top:12px;gap:12px;"></div></div>`
  const loadData = async (page = 0) => {
    currentPage = page; const tbody = document.getElementById('my-body'); if (!tbody) return; tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">加载中...</td></tr>'
    let q = supabase.from('bill_order').select('*', { count: 'exact' })
    if (isLogistics) { const codes = myVendors.map(v => v.vendor_code); if (!codes.length) return tbody.innerHTML = '<tr><td colspan="8">未配厂商</td></tr>'; q = q.in('vendor_code', codes) } else q = q.eq('vendor_id', currentUser.id)
    if (keyword) q = q.or(`source_no.ilike.%${keyword}%,product_code.ilike.%${keyword}%`)
    const from = currentPage * pageSize, to = from + pageSize - 1; q = q.order('id', { ascending: false }).range(from, to)
    const { data, error, count } = await q; if (error) return tbody.innerHTML = `<tr><td colspan="8">失败</td></tr>`
    tbody.innerHTML = (data||[]).map(b => `<tr><td>${b.id}</td><td>${b.warehouse_code}</td><td>${b.bill_type}</td><td>${b.product_code}</td><td>${b.quantity}</td><td>${b.exported ? '是' : '否'}</td><td>${new Date(b.created_at).toLocaleString()}</td><td>${b.exported ? `<button class="small secondary" disabled>已导出</button>` : `<button class="small danger" data-del="${b.id}">删除</button>`}</td></tr>`).join('') || '<tr><td colspan="8" style="text-align:center;">暂无</td></tr>'
    const total = Math.ceil((count||0)/pageSize), pg = document.getElementById('my-pagination')
    pg.innerHTML = `<span>共 ${count||0} 条</span><button class="secondary small" id="p-prev" ${page===0?'disabled':''}>上一页</button><button class="secondary small" id="p-next" ${page>=total-1?'disabled':''}>下一页</button>`
    document.getElementById('p-prev').onclick = () => { if (page > 0) loadData(page-1) }; document.getElementById('p-next').onclick = () => { if (page < total-1) loadData(page+1) }
    view.querySelectorAll('[data-del]').forEach(btn => { btn.onclick = async () => { if (!confirm('确定删除？')) return; const { error } = await supabase.from('bill_order').delete().eq('id', btn.dataset.del); if (error) return alert('失败'); loadData(currentPage) } })
  }
  document.getElementById('btn-my-search').onclick = () => { keyword = document.getElementById('my-search').value.trim(); loadData(0) }
  loadData(0)
}

// ================= 质检报告 (多仓隔离版) =================
async function renderQC(view) {
  let mySelectedVendorId = null, mySelectedVendorCode = null, mySelectedVendorName = null
  let myWhs = [], currentWhCode = ''

  if (isLogistics) {
    if (!myVendors.length) return view.innerHTML = `<div class="card"><h2>质检报告</h2><p style="color:#cf1322;">当前物流商未配置负责厂商。</p></div>`
    const codes = myVendors.map(v => v.vendor_code)
    const { data: vps } = await supabase.from('vendor_profile').select('id, vendor_code, vendor_name').in('vendor_code', codes)
    myVendors = myVendors.map(mv => ({ ...mv, id: vps.find(v => v.vendor_code === mv.vendor_code)?.id })).filter(v => v.id)
    if (!myVendors.length) return view.innerHTML = `<div class="card"><h2>质检报告</h2><p style="color:#cf1322;">厂商档案异常。</p></div>`
    mySelectedVendorId = myVendors[0].id; mySelectedVendorCode = myVendors[0].vendor_code; mySelectedVendorName = myVendors[0].vendor_name
  } else {
    mySelectedVendorId = currentUser.id; mySelectedVendorCode = currentProfile?.vendor_code || ''; mySelectedVendorName = currentProfile?.vendor_name || ''
  }

  async function loadVendorWhs(vId) {
    const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vId)
    myWhs = (vw || []).map(x => x.warehouse_code)
    if (myWhs.length > 0) currentWhCode = myWhs[0]
  }
  await loadVendorWhs(mySelectedVendorId)

  let reports = []
  async function loadReports() {
    let q = supabase.from('qc_report').select('*').order('id', { ascending: false })
    if (isLogistics) q = q.in('vendor_code', myVendors.map(v => v.vendor_code))
    else q = q.eq('vendor_id', currentUser.id)
    const { data } = await q; reports = data || []
  }
  await loadReports()

  function renderAll() {
    view.innerHTML = `
      <div class="card">
        <h2>上传质检报告</h2>
        <div class="row" style="margin-bottom:12px;">
          ${isLogistics ? `<div style="flex:1;"><label>代传厂商 *</label><select id="qc-vendor-select">${myVendors.map(v => `<option value="${v.vendor_code}" data-id="${v.id}" data-name="${v.vendor_name}">${v.vendor_code} - ${v.vendor_name}</option>`).join('')}</select></div>` : ''}
          <div style="flex:1;"><label>对应仓库 *</label><select id="qc-wh-select">${myWhs.map(w => `<option value="${w}" ${w===currentWhCode?'selected':''}>${w}</option>`).join('')}</select></div>
        </div>
        <div id="qc-msg"></div>
        <p style="font-size:13px;color:#666;margin-bottom:12px;">规则：仅 PDF；支持多选；单次 ≤ 10MB。<br><span style="color:#cf1322;">* 再次上传将自动覆盖该厂商该仓库今天的旧报告。</span></p>
        <div class="row"><div style="flex:1;"><input type="file" id="qc-file" accept=".pdf,application/pdf" multiple /></div><button id="btn-qc-upload" style="flex:0 0 100px;margin-top:24px;">上传</button></div>
      </div>
      <div class="card">
        <h2>已上传报告（${reports.length}）</h2>
        <div class="scroll"><table><tr><th>上传时间</th><th>仓库</th><th>厂编</th><th>文件名</th><th>操作</th></tr>
          ${reports.map(r => `<tr><td>${new Date(new Date(r.created_at).getTime()+8*3600*1000).toISOString().replace('T',' ').slice(0,19)}</td><td>${r.warehouse_code||'-'}</td><td>${r.vendor_code}</td><td>${r.report_name}</td><td><a href="${r.file_url}" target="_blank" class="small secondary" style="text-decoration:none;padding:4px 10px;margin-right:8px;">预览</a><button class="small danger" data-del-id="${r.id}" data-path="${r.file_path}">删除</button></td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;">暂无</td></tr>'}
        </table></div>
      </div>`

    if (isLogistics) document.getElementById('qc-vendor-select').onchange = async (e) => {
      const opt = e.target.options[e.target.selectedIndex]; mySelectedVendorCode = opt.value; mySelectedVendorId = opt.dataset.id; mySelectedVendorName = opt.dataset.name
      await loadVendorWhs(mySelectedVendorId); await loadReports(); renderAll()
    }
    document.getElementById('qc-wh-select').onchange = (e) => { currentWhCode = e.target.value }

    document.getElementById('btn-qc-upload').onclick = async () => {
      const msgEl = document.getElementById('qc-msg'), files = Array.from(document.getElementById('qc-file').files)
      if (!files.length) return msgEl.innerHTML = msg('请选择文件', false)
      if (!currentWhCode) return msgEl.innerHTML = msg('请选择仓库', false)
      let total = 0; for (const f of files) { if (!f.name.toLowerCase().endsWith('.pdf')) return msgEl.innerHTML = msg(`[${f.name}] 不是 PDF`, false); total += f.size }
      if (total > 10*1024*1024) return msgEl.innerHTML = msg('总大小超过 10MB', false)
      
      const btn = document.getElementById('btn-qc-upload'); btn.disabled = true; btn.innerText = '处理中...'
      try {
        const targetId = mySelectedVendorId, targetCode = mySelectedVendorCode, targetName = mySelectedVendorName.replace(/[\/\\:*?"<>|]/g, '')
        const fileInfos = files.map((file, index) => { const ext = file.name.split('.').pop(); const custom = file.name.replace(/\.[^/.]+$/, "").replace(/[\/\\:*?"<>|]/g, ''); return { file, fileName: `qc/${targetCode}_${targetName}_${custom}_${Date.now()}_${index}.${ext}`, originalName: file.name } })
        
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`https://api.mahui.pw/functions/v1/upload-qc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ fileNames: fileInfos.map(f => f.fileName) }) })
        if (!res.ok) throw new Error('获取凭证失败'); const { urls } = await res.json()
        
        await Promise.all(fileInfos.map(async (info, i) => { const ur = await fetch(urls[i].uploadUrl, { method: 'PUT', body: info.file }); if (!ur.ok) throw new Error(`[${info.originalName}] 上传失败`) }))
        
        const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).toISOString().slice(0, 10)
        const todayStartIso = new Date(todayStr + 'T00:00:00+08:00').toISOString()
        
        // 精确到厂商 + 仓库进行覆盖
        const { data: oldReports } = await supabase.from('qc_report').select('id, file_path').eq('vendor_id', targetId).eq('warehouse_code', currentWhCode).gte('created_at', todayStartIso)
        if (oldReports && oldReports.length > 0) {
          await Promise.all(oldReports.map(async (old) => { try { await fetch(`https://api.mahui.pw/functions/v1/delete-qc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ filePath: old.file_path }) }) } catch (e) {} }))
          await supabase.from('qc_report').delete().in('id', oldReports.map(r => r.id))
        }
        
        const dbRows = fileInfos.map((info, i) => ({ vendor_id: targetId, vendor_code: targetCode, warehouse_code: currentWhCode, report_name: `${targetCode}_${targetName}_${info.originalName.replace(/[\/\\:*?"<>|]/g, '')}`, file_path: info.fileName, file_url: urls[i].fileUrl, file_size: info.file.size }))
        const { error: dbErr } = await supabase.from('qc_report').insert(dbRows); if (dbErr) throw dbErr
        
        msgEl.innerHTML = msg('上传成功', true); setTimeout(async () => { await loadReports(); renderAll() }, 1000)
      } catch (err) { msgEl.innerHTML = msg(err.message || '失败', false); btn.disabled = false; btn.innerText = '上传' }
    }

    view.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('确定删除？')) return
        btn.disabled = true; btn.innerText = '...'
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const res = await fetch(`https://api.mahui.pw/functions/v1/delete-qc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }, body: JSON.stringify({ filePath: btn.dataset.path }) })
          if (!res.ok) throw new Error('R2 删除失败')
          await supabase.from('qc_report').delete().eq('id', btn.dataset.delId)
          await loadReports(); renderAll()
        } catch (err) { alert('删除失败'); btn.disabled = false; btn.innerText = '删除' }
      }
    })
  }
  renderAll()
}

init()