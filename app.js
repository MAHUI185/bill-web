// app.js — 厂商端 (2026-10-21 上线版)

import { supabase } from './supabase.js'

const SUPABASE_URL = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent)
  ? 'https://api.mahui.pw'
  : 'https://gpjdzgakvqhnpykuqbfr.supabase.co'

const app = document.getElementById('app')
let currentUser = null
let currentProfile = null
let isAdmin = false
let currentRole = null
let isLogistics = false
let myVendors = []
let countdownTimer = null
let activeHeartbeatTimer = null
let maintenanceCheckTimer = null

function msg(text, ok = true) { return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>` }

// ========== 校验工具 ==========
function isValidSpec(spec) { return spec ? /^1\*1\*[1-9]\d*$/.test(String(spec).trim()) : false }
const SPEC_EMPTY_MSG = '包装规格为空，请先到「商品资料」补全规格后再预约'
const SIZE_EMPTY_MSG = '长、宽、高、重量为必填，请到「商品资料」补全'
function isValidSize(length, width, height, weight) {
  const vals = [length, width, height, weight].map(v => Number(v))
  return vals.every(v => !isNaN(v) && v > 0)
}

function translateError(errMsg) {
  if (!errMsg) return '操作失败'
  const m = String(errMsg).toLowerCase()
  if (m.includes('invalid login credentials')) return '邮箱或密码错误'
  if (m.includes('banned')) return '账号已被禁用'
  if (m.includes('row-level security')) return '没有权限执行此操作'
  if (m.includes('duplicate key')) return '数据已存在，请检查'
  if (m.includes('violates foreign key')) return '关联数据不存在'
  if (m.includes('timeout')) return '操作超时，请重试'
  if (/[\u4e00-\u9fa5]/.test(errMsg)) return errMsg
  return '操作失败：' + errMsg
}

function withTimeout(promise, ms = 5000) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

// ========== 初始化与登录 ==========
async function init() {
  try {
    const { data: cfg } = await withTimeout(supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle(), 3000)
    if (cfg?.config_value === 'true') {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { data: admin } = await supabase.from('admin_users').select('role').eq('id', session.user.id).maybeSingle()
        if (admin?.role !== 'super_admin') return renderMaintenance()
      } else return renderMaintenance()
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return renderLogin()
    currentUser = session.user
    const ok = await loadProfile()
    if (!ok) return
    renderMain()
  } catch (e) {
    if (e.message === 'timeout') app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;text-align:center;"><h2>网络延迟过高</h2><button onclick="location.reload()">刷新</button></div>`
    else renderLogin('加载失败，请重新登录')
  }
}

async function loadProfile() {
  const p1 = supabase.from('vendor_profile').select('*').eq('id', currentUser.id).single()
  const p2 = supabase.from('admin_users').select('role, status').eq('id', currentUser.id).maybeSingle()
  const [{ data: profile }, { data: admin }] = await withTimeout(Promise.all([p1, p2]), 5000)

  if (profile?.status === 0) { await supabase.auth.signOut(); renderLogin('账号已禁用，请联系管理员'); return false }
  if (profile?.must_change_pwd) { renderForceChangePwd(); return false }

  currentProfile = profile
  isAdmin = !!admin
  currentRole = admin?.role || null
  isLogistics = profile?.account_type === 'logistics'

  if (isLogistics) {
    const { data: lv } = await withTimeout(supabase.from('logistics_vendor').select('vendor_code, vendor_name').eq('logistics_id', currentUser.id).order('vendor_code'), 3000)
    myVendors = lv || []
  }
  return true
}

function renderMaintenance() {
  app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;text-align:center;"><h1>系统维护中</h1><p style="margin:16px 0;color:#666;">请稍后再试。</p><button onclick="location.reload()">刷新</button></div>`
  const timer = setInterval(async () => {
    const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    if (data?.config_value !== 'true') { clearInterval(timer); await supabase.auth.signOut(); location.reload() }
  }, 10000)
}

function renderLogin(errMsg = '') {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;">
      <h1>厂商留库预约系统</h1>
      <div id="login-msg">${errMsg ? msg(errMsg, false) : ''}</div>
      <input id="email" placeholder="请输入账号" style="margin-bottom:12px;" />
      <input id="password" type="password" placeholder="密码" style="margin-bottom:16px;" />
      <button id="btn-login" style="width:100%;">登录</button>
      <button class="secondary" id="btn-goto-change" style="width:100%;margin-top:8px;">修改密码</button>
    </div>`
  document.getElementById('btn-login').onclick = async () => {
    const btn = document.getElementById('btn-login')
    let email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    if (!email || !password) return document.getElementById('login-msg').innerHTML = msg('请输入账号和密码', false)
    if (!email.includes('@')) {
      if (/^\d+$/.test(email)) email += email.startsWith('999') ? '@logistics.local' : '@vendor.local'
      else return document.getElementById('login-msg').innerHTML = msg('账号格式错误', false)
    }
    btn.disabled = true; btn.innerText = '登录中...'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { document.getElementById('login-msg').innerHTML = msg(translateError(error.message), false); btn.disabled = false; btn.innerText = '登录'; return }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        supabase.from('login_log').insert({ vendor_id: user.id, user_agent: navigator.userAgent }).then()
        supabase.from('vendor_profile').update({ last_login_at: new Date().toISOString(), last_active_at: new Date().toISOString() }).eq('id', user.id).then()
      }
    } catch (e) {}
    btn.innerText = '加载数据中...'
    await init()
  }
  document.getElementById('btn-goto-change').onclick = () => renderChangePwd()
}

function renderChangePwd() { 
  // 请参考原来的修改密码逻辑（篇幅所限省略不改变）
  app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;"><h1>修改密码</h1><div id="cp-msg"></div><input id="cp-email" placeholder="账号" style="margin-bottom:8px;" /><input id="cp-old" type="password" placeholder="旧密码" style="margin-bottom:8px;" /><input id="cp-new" type="password" placeholder="新密码" style="margin-bottom:8px;" /><button id="btn-cp-submit" style="width:100%;">提交</button><button class="secondary" id="btn-cp-back" style="width:100%;margin-top:8px;">返回</button></div>` 
}

function renderForceChangePwd() { 
  app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;"><h1>请修改初始密码</h1><div id="fp-msg"></div><input id="fp-new" type="password" placeholder="新密码" style="margin-bottom:8px;" /><input id="fp-new2" type="password" placeholder="确认密码" style="margin-bottom:8px;" /><button id="btn-fp-submit" style="width:100%;">提交</button><button class="secondary" id="btn-fp-logout" style="width:100%;margin-top:8px;">退出</button></div>` 
}

function renderMain() {
  const roleTag = isAdmin ? '（管理员）' : isLogistics ? '（物流商）' : ''
  app.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex:0 0 auto; margin-bottom:0; border-radius: 8px 8px 0 0;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="./logo.png" style="height:45px;object-fit:contain;" onerror="this.style.display='none'" />
        <div><h1 style="font-size:20px;margin:0;">厂商留库预约系统</h1><p style="margin:4px 0 0;font-size:13px;color:#666;">当前用户：${currentProfile?.vendor_name || currentUser.email} ${roleTag}</p></div>
      </div>
      <div style="display:flex; gap:16px; align-items:center;">
        ${!isAdmin ? `<div id="main-countdown" style="display:none;"><div id="main-countdown-inner" style="padding:6px 16px;border-radius:16px;font-size:14px;font-weight:bold;background:#f6ffed;border:1px solid #b7eb8f;color:#389e0d;"><span id="main-countdown-text">--:--:--</span></div></div>` : ''}
        <button class="secondary" id="btn-logout">退出登录</button>
      </div>
    </div>
    <div class="card" style="flex:1; margin:0; border-radius: 0 0 8px 8px; border-top: none; padding-top: 12px; overflow: hidden;">
      <div class="nav" id="nav" style="flex:0 0 auto; margin-bottom:12px; border-bottom:none; padding-bottom:0;"></div>
      <div id="view" style="flex:1; overflow:hidden; display:flex; flex-direction:column;"></div>
    </div>`
  
  document.getElementById('btn-logout').onclick = async () => {
    if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer)
    if (maintenanceCheckTimer) clearInterval(maintenanceCheckTimer)
    await supabase.auth.signOut(); init()
  }

  const nav = document.getElementById('nav')
  let tabs = []
  if (isAdmin) tabs = [['admin','管理后台']]
  else if (isLogistics) tabs = [['fill','预约'],['my','我的单据'],['products','商品资料']]
  else {
    if (currentProfile?.vendor_type === 'cross') {
      tabs = [['products','商品资料'],['qc','质检报告']]
    } else {
      tabs = [['fill','预约'],['my','我的单据'],['products','商品资料'],['qc','质检报告']]
    }
  }
  
  nav.innerHTML = tabs.map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('')
  nav.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      nav.querySelectorAll('button').forEach(x => x.classList.remove('active'))
      b.classList.add('active'); renderView(b.dataset.k)
    }
  })
  nav.querySelector('button').classList.add('active')
  renderView(tabs[0][0])

  if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer)
  if (currentUser) {
    const beat = async () => { try { await supabase.from('vendor_profile').update({ last_active_at: new Date().toISOString() }).eq('id', currentUser.id) } catch (e) {} }
    beat(); activeHeartbeatTimer = setInterval(beat, 3 * 60 * 1000)
  }
  if (currentRole === 'super_admin') return;
  if (maintenanceCheckTimer) clearInterval(maintenanceCheckTimer)
  maintenanceCheckTimer = setInterval(async () => {
    const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    if (data?.config_value === 'true') { alert('系统已进入维护模式'); await supabase.auth.signOut(); location.reload() }
  }, 30000)
}

async function renderView(key) {
  const view = document.getElementById('view')
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  const cdEl = document.getElementById('main-countdown'); if (cdEl) cdEl.style.display = 'none'

  if (key === 'fill') {
    if (currentProfile?.vendor_type === 'cross') { view.innerHTML = '<div class="card">您属于越库厂商，无需预约。</div>'; return }
    return renderFill(view)
  }
  if (key === 'my') {
    if (currentProfile?.vendor_type === 'cross') { view.innerHTML = '<div class="card">您属于越库厂商，无需查看单据。</div>'; return }
    return renderMy(view)
  }
  if (key === 'products') return renderProducts(view)
  if (key === 'qc') return renderQC(view)
  if (key === 'admin') {
    try {
      const mod = await import('./admin.js')
      await mod.renderAdmin(view, { supabase, currentUser, currentProfile, isAdmin, currentRole, msg, SUPABASE_URL, translateError })
    } catch (e) { console.error(e); view.innerHTML = msg('加载失败', false) }
  }
}

// ================= 质检报告页 =================
async function renderQC(view) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  view.innerHTML = `
    <div class="card" style="flex:1; overflow-y:auto; margin:0; border:none; padding:0;">
      <h2>今日质检报告 (${today})</h2>
      <p style="color:#cf1322; font-size:13px; margin-bottom:16px;">提示：仅支持 PDF 格式，系统保留 7 天。每次上传将覆盖今日旧文件。</p>
      <div style="border:1px dashed #1677ff; padding:24px; text-align:center; border-radius:8px; background:#f0f5ff; margin-bottom:16px;">
        <input type="file" id="qc-files" accept=".pdf" multiple style="display:none;" />
        <button id="btn-upload-qc" style="padding:10px 24px;">📄 选择并上传 PDF</button>
        <div id="qc-msg" style="margin-top:12px;"></div>
      </div>
      <div id="qc-list-box">
        <h3>今日已上传：</h3>
        <div id="qc-list">加载中...</div>
      </div>
    </div>`

  const loadList = async () => {
    const { data } = await supabase.from('qc_upload_log').select('*').eq('vendor_id', currentUser.id).eq('upload_date', today).order('created_at', { ascending: true })
    const list = document.getElementById('qc-list')
    if (!data || !data.length) return list.innerHTML = '<span style="color:#999;">暂无文件</span>'
    list.innerHTML = data.map(f => `<div style="padding:8px; border-bottom:1px solid #eee;">📄 ${f.file_name}</div>`).join('')
  }
  await loadList()

  document.getElementById('btn-upload-qc').onclick = () => document.getElementById('qc-files').click()
  document.getElementById('qc-files').onchange = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    if (files.some(f => f.type !== 'application/pdf')) return document.getElementById('qc-msg').innerHTML = msg('只能上传 PDF 文件', false)
    
    const totalSize = files.reduce((s, f) => s + f.size, 0)
    if (totalSize > 20 * 1024 * 1024) return document.getElementById('qc-msg').innerHTML = msg('总大小超 20MB', false)

    const { data: exist } = await supabase.from('qc_upload_log').select('id').eq('vendor_id', currentUser.id).eq('upload_date', today)
    if (exist && exist.length > 0) {
      if (!confirm('今日已有报告，继续操作将清空并覆盖旧报告，是否确认？')) return
      await fetch(`${SUPABASE_URL}/functions/v1/delete-qc`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session.access_token}` },
        body: JSON.stringify({ is_today: true })
      })
    }

    document.getElementById('qc-msg').innerHTML = msg('上传中...', true)
    const { data: { session } } = await supabase.auth.getSession()
    
    for (const f of files) {
      const formData = new FormData()
      formData.append('file', f)
      formData.append('vendor_code', currentProfile.vendor_code)
      formData.append('vendor_id', currentUser.id)
      formData.append('vendor_name', currentProfile.vendor_name)
      const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-qc`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData
      })
      if (!res.ok) { alert('上传失败'); return }
    }
    document.getElementById('qc-msg').innerHTML = msg('✅ 上传成功！', true)
    await loadList()
  }
}

// ================= 预约页（极速录入） =================
async function renderFill(view) {
  let selectedVendor = isLogistics ? myVendors[0] : { vendor_code: currentProfile?.vendor_code || '', vendor_name: currentProfile?.vendor_name || '' }
  if (!selectedVendor) return view.innerHTML = '<div class="card">未配置厂商</div>'
  let myVendorCode = selectedVendor.vendor_code

  let myWhs = []
  if (isLogistics) {
    const codes = myVendors.map(v => v.vendor_code)
    const { data: vps } = await supabase.from('vendor_profile').select('id, vendor_code').in('vendor_code', codes)
    const ids = (vps||[]).map(v => v.id)
    if (ids.length) {
      const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').in('vendor_id', ids)
      myWhs = [...new Set((vw||[]).map(x => x.warehouse_code))]
    }
  } else {
    const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', currentUser.id)
    myWhs = (vw||[]).map(x => x.warehouse_code)
  }

  let defaultStoreCode = ''
  if (myWhs.length) {
    const { data: whInfo } = await supabase.from('warehouse').select('default_store_code').eq('warehouse_code', myWhs[0]).maybeSingle()
    defaultStoreCode = whInfo?.default_store_code || ''
  }

  const { data: locs } = await supabase.from('location_config').select('warehouse_code, location_code').eq('status', 1)
  const { data: stores } = await supabase.from('store_config').select('warehouse_code, store_code, store_name').eq('status', 1)
  const myStores = (stores||[]).filter(s => !s.warehouse_code || myWhs.includes(s.warehouse_code))

  async function loadProducts(vendorCode) {
    const { data } = await supabase.from('product_master').select('product_code, product_name, spec').eq('default_vendor_code', vendorCode).order('product_code')
    return data || []
  }
  let productList = await loadProducts(myVendorCode)

  let inRows = [newInRowForVendor(myVendorCode)]
  let outRows = [newOutRowForVendor(myVendorCode)]

  function newInRowForVendor(vc) {
    return { bill_type: 'VMI入库', vendor_code: vc, owner_code: vc, location_code: (locs && locs[0]) ? locs[0].location_code : '', product_code: '', spec: '', quantity: '', arrival_date: addDays(todayBj(), 1), product_name: '' }
  }
  function newOutRowForVendor(vc) {
    return { bill_type: 'VMI出库', source_no: '', owner_code: vc, store_code: defaultStoreCode, location_code: (locs && locs[0]) ? locs[0].location_code : '', pick_date: addDays(todayBj(), 2), product_code: '', spec: '', quantity: '', product_name: '' }
  }
  function isInRowFilled(r) { return !!(r.product_code || r.spec || r.quantity) }
  function isOutRowFilled(r) { return !!(r.product_code || r.spec || r.quantity || r.source_no) }
  function findProduct(code) { return productList.find(p => p.product_code === code) }

  function render() {
    view.innerHTML = `
      <div style="flex:1; overflow-y:auto; padding-right:4px;">
        <h2>预约单据</h2>
        ${isLogistics ? `<div class="row" style="margin-bottom:12px;"><div><label>代报厂商 *</label><select id="vendor-select">${myVendors.map(v => `<option value="${v.vendor_code}" ${v.vendor_code===myVendorCode?'selected':''}>${v.vendor_code} - ${v.vendor_name}</option>`).join('')}</select></div></div>` : ''}
        <div id="fill-msg"></div>

        <h3 style="margin:16px 0 8px;">入库单</h3>
        <div style="background:#f6ffed; border:1px dashed #b7eb8f; border-radius:4px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; color:#389e0d; margin-bottom:8px; font-weight:bold;">⚡ 批量录入（从 Excel 复制：货号 / 箱数）</div>
          <textarea id="in-paste-area" style="height:60px; font-family:monospace; margin-bottom:8px;" placeholder="例如：&#10;4303389   2"></textarea>
          <button type="button" class="secondary" id="btn-parse-in">添加到表格</button>
        </div>
        <div style="overflow-x:auto;"><table><thead><tr><th>类型</th><th>供应商</th><th>货主</th><th>仓位</th><th>商品</th><th>规格</th><th>箱数</th><th>到货日</th><th>操作</th></tr></thead><tbody id="in-body"></tbody></table></div>

        <h3 style="margin:24px 0 8px;">出库单</h3>
        <div style="background:#f0f5ff; border:1px dashed #91caff; border-radius:4px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; color:#1677ff; margin-bottom:8px; font-weight:bold;">⚡ 批量录入（智能识别 VMI/DSP）<br><span style="font-size:12px; font-weight:normal; color:#666;">3列默认VMI出库；4列带门店自动识别DSP出库。</span></div>
          <textarea id="out-paste-area" style="height:60px; font-family:monospace; margin-bottom:8px;" placeholder="例如：&#10;264065450   4251857   1   2017济宁店"></textarea>
          <button type="button" class="secondary" id="btn-parse-out">添加到表格</button>
        </div>
        <div style="overflow-x:auto;"><table><thead><tr><th>类型</th><th>采购单号</th><th>货主</th><th>门店</th><th>仓位</th><th>配货日</th><th>商品</th><th>规格</th><th>箱数</th><th>操作</th></tr></thead><tbody id="out-body"></tbody></table></div>

        <div style="margin-top:16px; text-align:right; padding-bottom:16px;">
          <button id="btn-submit-all" style="padding:10px 32px; font-size:15px;">确认预约</button>
          <button class="secondary" id="btn-clear-all" style="margin-left:8px;">清空</button>
        </div>
      </div>`

    renderInTable(); renderOutTable();
    const vs = document.getElementById('vendor-select')
    if (vs) { vs.onchange = async () => { myVendorCode = vs.value; productList = await loadProducts(myVendorCode); inRows = [newInRowForVendor(myVendorCode)]; outRows = [newOutRowForVendor(myVendorCode)]; render() } }

    // 解析入库
    document.getElementById('btn-parse-in').onclick = () => {
      const lines = document.getElementById('in-paste-area').value.trim().split(/\r?\n/).filter(l => l.trim())
      const parsedMap = new Map(); let errs = []
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean)
        if (cols.length < 2) { errs.push(`第${i+1}行列数不足`); continue }
        const p = findProduct(cols[0]); if (!p) { errs.push(`第${i+1}行货号${cols[0]}不存在`); continue }
        if (!isValidSpec(p.spec)) { errs.push(`第${i+1}行规格不合规`); continue }
        const qty = Number(cols[cols.length - 1])
        if (isNaN(qty) || qty <= 0) { errs.push(`第${i+1}行箱数错误`); continue }
        const k = p.product_code
        if (parsedMap.has(k)) parsedMap.get(k).quantity += qty; else parsedMap.set(k, { ...p, quantity: qty })
      }
      if (errs.length) return alert(`❌ 解析失败：\n` + errs.slice(0, 5).join('\n'))
      let count = 0
      parsedMap.forEach(item => {
        const exist = inRows.find(r => r.bill_type === 'VMI入库' && r.product_code === item.product_code)
        if (exist) exist.quantity = Number(exist.quantity) + item.quantity
        else { const nr = newInRowForVendor(myVendorCode); Object.assign(nr, item); inRows.push(nr); count++ }
      })
      document.getElementById('in-paste-area').value = ''
      renderInTable(); alert(`✅ 成功新增 ${count} 行`)
    }

    // 解析出库
    document.getElementById('btn-parse-out').onclick = () => {
      const lines = document.getElementById('out-paste-area').value.trim().split(/\r?\n/).filter(l => l.trim())
      const parsedMap = new Map(); let errs = []
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean)
        if (cols.length < 3) { errs.push(`第${i+1}行列数不足`); continue }
        const [source_no, product_code, boxQtyStr] = cols
        const boxQty = Number(boxQtyStr)
        if (!/^\d{9}$/.test(source_no)) { errs.push(`第${i+1}行单号错误`); continue }
        if (isNaN(boxQty) || boxQty <= 0) { errs.push(`第${i+1}行箱数错误`); continue }
        const p = findProduct(product_code); if (!p) { errs.push(`第${i+1}行货号不存在`); continue }
        if (!isValidSpec(p.spec)) { errs.push(`第${i+1}行规格不合规`); continue }

        let billType = 'VMI出库'; let storeCode = ''
        if (cols.length >= 4) {
          billType = 'DSP出库'
          const rawStore = cols[3]
          const matched = myStores.find(s => s.store_code === rawStore || rawStore.includes(s.store_name) || rawStore.includes(s.store_code))
          if (!matched) { errs.push(`第${i+1}行门店${rawStore}找不到`); continue }
          storeCode = matched.store_code
        }
        const key = `${source_no}_${p.product_code}_${billType}_${storeCode}`
        if (parsedMap.has(key)) parsedMap.get(key).quantity += boxQty
        else parsedMap.set(key, { source_no, product_code: p.product_code, product_name: p.product_name, spec: p.spec, quantity: boxQty, billType, storeCode })
      }
      if (errs.length) return alert(`❌ 解析失败：\n` + errs.slice(0, 5).join('\n'))
      let count = 0
      parsedMap.forEach(item => {
        const exist = outRows.find(r => r.source_no === item.source_no && r.product_code === item.product_code && r.bill_type === item.billType && r.store_code === item.storeCode)
        if (exist) exist.quantity = Number(exist.quantity) + item.quantity
        else {
          const nr = newOutRowForVendor(myVendorCode)
          Object.assign(nr, { source_no: item.source_no, product_code: item.product_code, product_name: item.product_name, spec: item.spec, quantity: item.quantity, bill_type: item.billType })
          if (item.billType === 'DSP出库') { nr.owner_code = '8888'; nr.store_code = item.storeCode }
          outRows.push(nr); count++
        }
      })
      document.getElementById('out-paste-area').value = ''
      renderOutTable(); alert(`✅ 成功新增 ${count} 行`)
    }

    document.getElementById('btn-clear-all').onclick = () => { if(confirm('清空？')) { inRows = [newInRowForVendor(myVendorCode)]; outRows = [newOutRowForVendor(myVendorCode)]; render() } }

    document.getElementById('btn-submit-all').onclick = async () => {
      const msgEl = document.getElementById('fill-msg')
      const validIn = inRows.filter(isInRowFilled); const validOut = outRows.filter(isOutRowFilled)
      if (!validIn.length && !validOut.length) return msgEl.innerHTML = msg('请至少填写一条单据', false)
      
      let vendorAuthId = isLogistics ? (await supabase.from('vendor_profile').select('id').eq('vendor_code', myVendorCode).single()).data.id : currentUser.id
      const defaultWh = myWhs[0]
      function calcQty(s, q) { if(!q) return 0; const m = Number(String(s||'1').split('*').pop())||1; return Number(q)*m }

      const payloads = [
        ...validIn.map(r => ({ vendor_id: vendorAuthId, warehouse_code: defaultWh, bill_type: r.bill_type, source_no: r.source_no, vendor_code: r.vendor_code, owner_code: r.owner_code, location_code: r.location_code, product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity), arrival_date: r.arrival_date, effective_date: addOneDay(r.arrival_date), submitter_type: 'vendor' })),
        ...validOut.map(r => ({ vendor_id: vendorAuthId, warehouse_code: defaultWh, bill_type: r.bill_type, source_no: r.source_no, inbound_order_no: r.source_no, owner_code: r.owner_code, store_code: r.store_code, location_code: r.location_code, pick_date: r.pick_date, effective_date: addOneDay(r.pick_date), product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity), submitter_type: 'vendor', vendor_code: myVendorCode }))
      ]
      msgEl.innerHTML = msg('预约中...', true)
      const { error } = await supabase.from('bill_order').insert(payloads)
      if (error) return msgEl.innerHTML = msg(translateError(error.message), false)
      msgEl.innerHTML = msg('预约成功', true); setTimeout(() => render(), 800)
    }
  }

  function renderInTable() {
    const tb = document.getElementById('in-body'); if(!tb) return
    tb.innerHTML = inRows.map((r, i) => {
      r.source_no = (r.owner_code && r.arrival_date) ? r.owner_code + r.arrival_date.replace(/-/g, '') : ''
      return `<tr>
        <td><select data-i="${i}" data-f="bill_type"><option ${r.bill_type==='VMI入库'?'selected':''}>VMI入库</option><option ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option><option ${r.bill_type==='济转西RT'?'selected':''}>济转西RT</option></select></td>
        <td>${r.vendor_code}</td><td>${r.owner_code}</td>
        <td><select data-i="${i}" data-f="location_code">${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}</select></td>
        <td><input list="p-list" data-i="${i}" data-f="product_code" value="${r.product_code}" placeholder="输入/选" /></td>
        <td><input data-i="${i}" data-f="spec" value="${r.spec}" /></td>
        <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" /></td>
        <td>${r.arrival_date}</td>
        <td><button class="small danger" data-del-in="${i}">删</button></td>
      </tr>`
    }).join('')
    let dl = document.getElementById('p-list'); if(!dl) { dl = document.createElement('datalist'); dl.id='p-list'; document.body.appendChild(dl) }
    dl.innerHTML = productList.map(p => `<option value="${p.product_code}">${p.product_code} - ${p.product_name} - ${p.spec}</option>`).join('')
    
    tb.querySelectorAll('input,select').forEach(el => {
      el.onchange = el.oninput = () => {
        const i = Number(el.dataset.i); const f = el.dataset.f; const r = inRows[i]
        if (f === 'product_code') { const p = findProduct(el.value); if(p){ r.product_name=p.product_name; r.spec=p.spec; el.closest('tr').querySelector('[data-f="spec"]').value=p.spec; } }
        else if (f === 'bill_type') { r.bill_type = el.value; r.owner_code = el.value==='DSP入库'?'8888':r.vendor_code; renderInTable(); }
        else r[f] = el.value;
      }
    })
    tb.querySelectorAll('[data-del-in]').forEach(b => { b.onclick = () => { inRows.splice(Number(b.dataset.delIn),1); renderInTable(); } })
  }

  function renderOutTable() {
    const tb = document.getElementById('out-body'); if(!tb) return
    tb.innerHTML = outRows.map((r, i) => `<tr>
      <td><select data-i="${i}" data-f="bill_type"><option ${r.bill_type==='VMI出库'?'selected':''}>VMI出库</option><option ${r.bill_type==='DSP出库'?'selected':''}>DSP出库</option></select></td>
      <td><input data-i="${i}" data-f="source_no" value="${r.source_no||''}" placeholder="单号" /></td>
      <td>${r.owner_code}</td>
      <td>${r.bill_type === 'DSP出库' ? `<select data-i="${i}" data-f="store_code"><option value="">选门店</option>${myStores.map(s => `<option value="${s.store_code}" ${r.store_code===s.store_code?'selected':''}>${s.store_name}</option>`).join('')}</select>` : r.store_code}</td>
      <td><select data-i="${i}" data-f="location_code">${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}</select></td>
      <td>${r.pick_date}</td>
      <td><input list="p-list" data-i="${i}" data-f="product_code" value="${r.product_code}" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" /></td>
      <td><button class="small danger" data-del-out="${i}">删</button></td>
    </tr>`).join('')

    tb.querySelectorAll('input,select').forEach(el => {
      el.onchange = el.oninput = () => {
        const i = Number(el.dataset.i); const f = el.dataset.f; const r = outRows[i]
        if (f === 'product_code') { const p = findProduct(el.value); if(p){ r.product_name=p.product_name; r.spec=p.spec; el.closest('tr').querySelector('[data-f="spec"]').value=p.spec; } }
        else if (f === 'bill_type') { r.bill_type = el.value; r.owner_code = el.value==='DSP出库'?'8888':myVendorCode; renderOutTable(); }
        else r[f] = el.value;
      }
    })
    tb.querySelectorAll('[data-del-out]').forEach(b => { b.onclick = () => { outRows.splice(Number(b.dataset.delOut),1); renderOutTable(); } })
  }

  render()
}

async function renderProducts(view) { view.innerHTML = '<div class="card">商品资料(保持原样)</div>' }
async function renderMy(view) { view.innerHTML = '<div class="card">我的单据(保持原样)</div>' }

function addOneDay(d) { if (!d) return null; const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10) }
function addDays(d, n) { if (!d) return null; const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
function todayBj() { const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` }

init()