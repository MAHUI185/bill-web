// app.js — 厂商端 (2026-10-22 正式上线版)

import { supabase } from './supabase.js'

// 动态判断请求地址：手机/平板走代理，电脑直连
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
function isValidSpec(spec) {
  if (!spec) return false
  return /^1\*1\*[1-9]\d*$/.test(String(spec).trim())
}
const SPEC_EMPTY_MSG = '包装规格为空，请先到「商品资料」补全规格后再预约'
const SIZE_EMPTY_MSG = '长、宽、高、重量为必填，请到「商品资料」补全'
function isValidSize(length, width, height, weight) {
  const vals = [length, width, height, weight].map(v => Number(v))
  return vals.every(v => !isNaN(v) && v > 0)
}

function translateError(errMsg) {
  if (!errMsg) return '操作失败'
  const m = String(errMsg).toLowerCase()
  if (m.includes('new password should be different') || m.includes('same password')) return '新密码不能与旧密码相同'
  if (m.includes('password should be at least')) return '密码长度不足（至少 6 位）'
  if (m.includes('invalid login credentials')) return '邮箱或密码错误'
  if (m.includes('email not confirmed')) return '邮箱未确认'
  if (m.includes('user not found')) return '用户不存在'
  if (m.includes('email rate limit') || m.includes('for security purposes')) return '操作过于频繁，请稍后再试'
  if (m.includes('weak password')) return '密码太弱，请用更复杂的密码'
  if (m.includes('user already registered')) return '该用户已存在'
  if (m.includes('banned')) return '账号已被禁用'
  if (m.includes('row-level security')) return '没有权限执行此操作'
  if (m.includes('duplicate key') && m.includes('product_master')) return '该商品编码已存在'
  if (m.includes('duplicate key') && m.includes('warehouse')) return '该仓库代码已存在'
  if (m.includes('duplicate key') && m.includes('store_config')) return '该门店代码已存在'
  if (m.includes('duplicate key') && m.includes('location_config')) return '该仓位代码已存在'
  if (m.includes('duplicate key') && m.includes('logistics_mode')) return '该物流方式代码已存在'
  if (m.includes('duplicate key') && m.includes('location_warehouse_map')) return '该仓位映射已存在'
  if (m.includes('duplicate key') && m.includes('vendor_profile')) return '该厂编已存在'
  if (m.includes('duplicate key') && m.includes('admin_users')) return '该管理员已存在'
  if (m.includes('duplicate key') && m.includes('deadline_config')) return '该提报时间段已存在'
  if (m.includes('duplicate key') && m.includes('holiday_config')) return '该节假日已存在'
  if (m.includes('duplicate key')) return '数据已存在，请检查'
  if (m.includes('violates foreign key')) return '关联数据不存在，无法操作'
  if (m.includes('violates not-null')) return '必填字段不能为空'
  if (m.includes('check constraint')) return '数据格式不合法'
  if (m.includes('invalid input syntax for type uuid')) return 'ID 格式错误'
  if (m.includes('invalid input syntax for type date')) return '日期格式错误'
  if (m.includes('invalid input syntax for type integer') || m.includes('invalid input syntax for type numeric')) return '数字格式错误'
  if (m.includes('timeout') || m.includes('timed out')) return '操作超时，请重试'
  if (m.includes('connection')) return '网络连接失败，请检查网络'
  if (m.includes('jwt') && m.includes('expired')) return '登录已过期，请重新登录'
  if (m.includes('failed to fetch') || m.includes('networkerror')) return '网络连接失败，请检查网络'
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
    if (e.message === 'timeout') {
      app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;text-align:center;"><h2>网络延迟过高</h2><p style="margin:16px 0;color:#666;">加载超时，请刷新页面重试。</p><button onclick="location.reload()">刷新</button></div>`
    } else {
      console.error(e)
      renderLogin('加载失败，请重新登录')
    }
  }
}

async function loadProfile() {
  const p1 = supabase.from('vendor_profile').select('*').eq('id', currentUser.id).single()
  const p2 = supabase.from('admin_users').select('role, status').eq('id', currentUser.id).maybeSingle()
  const [{ data: profile }, { data: admin }] = await withTimeout(Promise.all([p1, p2]), 5000)

  if (profile?.status === 0) {
    await supabase.auth.signOut()
    renderLogin('账号已禁用，请联系管理员')
    return false
  }
  if (profile?.must_change_pwd) {
    renderForceChangePwd()
    return false
  }

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
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;text-align:center;">
      <h1>系统维护中</h1>
      <p style="margin:16px 0;color:#666;">系统正在部署更新，暂时无法操作数据，请稍后再试。</p>
      <button id="btn-retry">刷新</button>
    </div>`
  document.getElementById('btn-retry').onclick = () => location.reload()
  const timer = setInterval(async () => {
    const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    if (data?.config_value !== 'true') {
      clearInterval(timer)
      await supabase.auth.signOut()
      location.reload()
    }
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

    if (!email || !password) {
      document.getElementById('login-msg').innerHTML = msg('请输入账号和密码', false)
      return
    }

    if (email.includes('@')) {
      // 原样
    } else if (/^\d+$/.test(email)) {
      if (email.startsWith('999')) email += '@logistics.local'
      else email += '@vendor.local'
    } else {
      document.getElementById('login-msg').innerHTML = msg('账号格式错误', false)
      return
    }

    btn.disabled = true
    btn.innerText = '登录中...'

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      document.getElementById('login-msg').innerHTML = msg(
        translateError(error.message) === '邮箱或密码错误'
          ? '登录失败，账号可能已禁用或密码错误，请联系管理员'
          : translateError(error.message),
        false)
      btn.disabled = false
      btn.innerText = '登录'
      return
    }

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
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;">
      <h1>修改密码</h1>
      <div id="cp-msg"></div>
      <input id="cp-email" placeholder="请输入账号" style="margin-bottom:8px;" />
      <input id="cp-old" type="password" placeholder="旧密码" style="margin-bottom:8px;" />
      <input id="cp-new" type="password" placeholder="新密码（至少 6 位）" style="margin-bottom:8px;" />
      <input id="cp-new2" type="password" placeholder="确认新密码" style="margin-bottom:16px;" />
      <button id="btn-cp-submit" style="width:100%;">提交</button>
      <button class="secondary" id="btn-cp-back" style="width:100%;margin-top:8px;">返回登录</button>
    </div>`

  document.getElementById('btn-cp-back').onclick = () => renderLogin()

  document.getElementById('btn-cp-submit').onclick = async () => {
    const msgEl = document.getElementById('cp-msg')
    let email = document.getElementById('cp-email').value.trim()
    const oldPwd = document.getElementById('cp-old').value
    const newPwd = document.getElementById('cp-new').value
    const newPwd2 = document.getElementById('cp-new2').value

    if (!email || !oldPwd || !newPwd || !newPwd2) {
      msgEl.innerHTML = msg('所有字段为必填', false); return
    }

    if (email.includes('@')) {
      // 原样
    } else if (/^\d+$/.test(email)) {
      if (email.startsWith('999')) email += '@logistics.local'
      else email += '@vendor.local'
    } else {
      msgEl.innerHTML = msg('账号格式错误', false); return
    }

    if (newPwd.length < 6) {
      msgEl.innerHTML = msg('新密码至少 6 位', false); return
    }
    if (newPwd !== newPwd2) {
      msgEl.innerHTML = msg('两次输入的新密码不一致', false); return
    }

    msgEl.innerHTML = msg('处理中...', true)

    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: oldPwd })
    if (signErr) {
      msgEl.innerHTML = msg('旧密码错误，或账号已禁用', false); return
    }

    const { error: updErr } = await supabase.auth.updateUser({ password: newPwd })
    if (updErr) {
      msgEl.innerHTML = msg(translateError(updErr.message), false)
      await supabase.auth.signOut()
      return
    }

    await supabase.auth.signOut()
    msgEl.innerHTML = msg('密码已修改，请用新密码登录', true)
    setTimeout(() => renderLogin('密码已修改，请重新登录'), 1500)
  }
}

function renderForceChangePwd() {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;">
      <h1>请修改初始密码</h1>
      <p style="color:#d46b08;margin-bottom:12px;">首次登录，请修改密码后再使用系统。</p>
      <div id="fp-msg"></div>
      <input id="fp-new" type="password" placeholder="新密码（至少 6 位）" style="margin-bottom:8px;" />
      <input id="fp-new2" type="password" placeholder="确认新密码" style="margin-bottom:16px;" />
      <button id="btn-fp-submit" style="width:100%;">提交</button>
      <button class="secondary" id="btn-fp-logout" style="width:100%;margin-top:8px;">退出登录</button>
    </div>`

  document.getElementById('btn-fp-logout').onclick = async () => {
    await supabase.auth.signOut()
    renderLogin()
  }

  document.getElementById('btn-fp-submit').onclick = async () => {
    const msgEl = document.getElementById('fp-msg')
    const p1 = document.getElementById('fp-new').value
    const p2 = document.getElementById('fp-new2').value

    if (!p1 || !p2) { msgEl.innerHTML = msg('请填写新密码', false); return }
    if (p1.length < 6) { msgEl.innerHTML = msg('新密码至少 6 位', false); return }
    if (p1 !== p2) { msgEl.innerHTML = msg('两次输入不一致', false); return }

    msgEl.innerHTML = msg('处理中...', true)

    const { error } = await supabase.auth.updateUser({ password: p1 })
    if (error) {
      msgEl.innerHTML = msg(translateError(error.message), false); return
    }

    const { error: updErr } = await supabase.from('vendor_profile').update({ must_change_pwd: false }).eq('id', currentUser.id)
    if (updErr) {
      msgEl.innerHTML = msg(translateError(updErr.message), false)
      return
    }

    msgEl.innerHTML = msg('密码已修改，正在进入系统...', true)
    setTimeout(async () => {
      const ok = await loadProfile()
      if (ok) renderMain()
    }, 800)
  }
}

// ================= 头部导航与全局布局 =================
function renderMain() {
  const roleTag = isAdmin ? '（管理员）' : isLogistics ? '（物流商）' : ''
  app.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:16px; flex:0 0 auto;">
      <div style="display:flex; align-items:center; gap:12px;">
        <img src="./logo.png" style="height:45px; width:auto; object-fit:contain;" onerror="this.style.display='none'" />
        <div>
          <h1 style="margin:0 0 4px 0; font-size: 24px;">厂商留库预约系统</h1>
          <p style="margin:0; color:#666; font-size:13px;">当前用户：${currentProfile?.vendor_name || currentUser.email} ${roleTag}</p>
        </div>
      </div>
      
      <div style="display:flex; align-items:center; gap:16px; flex:0 0 auto;">
        ${!isAdmin ? `
          <div id="main-countdown" style="display:none;">
            <div id="main-countdown-inner" style="padding:6px 16px; border-radius:16px; font-size:14px; font-weight:bold; background:#f6ffed; border:1px solid #b7eb8f; color:#389e0d;">
              <span id="main-countdown-text">--:--:--</span>
            </div>
          </div>
        ` : ''}
        <button class="secondary" id="btn-logout">退出登录</button>
      </div>
    </div>
    
    <div class="nav" id="nav" style="flex:0 0 auto;"></div>
    <div id="view" style="flex:1; overflow:hidden; display:flex; flex-direction:column;"></div>`
  
  document.getElementById('btn-logout').onclick = async () => {
    if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer)
    if (maintenanceCheckTimer) clearInterval(maintenanceCheckTimer)
    await supabase.auth.signOut()
    init()
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
      b.classList.add('active')
      renderView(b.dataset.k)
    }
  })
  nav.querySelector('button').classList.add('active')
  renderView(tabs[0][0])

  if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer)
  if (currentUser) {
    const beat = async () => { try { await supabase.from('vendor_profile').update({ last_active_at: new Date().toISOString() }).eq('id', currentUser.id) } catch (e) {} }
    beat()
    activeHeartbeatTimer = setInterval(beat, 3 * 60 * 1000)
  }
  
  if (currentRole === 'super_admin') return
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
        <td>
          <select data-i="${i}" data-f="bill_type" style="margin:0;padding:4px;">
            <option ${r.bill_type==='VMI入库'?'selected':''}>VMI入库</option>
            <option ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option>
            <option ${r.bill_type==='济转西RT'?'selected':''}>济转西RT</option>
            <option ${r.bill_type==='济转西DSP'?'selected':''}>济转西DSP</option>
          </select>
        </td>
        <td>${r.vendor_code}</td><td>${r.owner_code}</td>
        <td><select data-i="${i}" data-f="location_code" style="margin:0;padding:4px;">${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}</select></td>
        <td><input list="p-list" data-i="${i}" data-f="product_code" value="${r.product_code}" placeholder="输入/选" style="margin:0;padding:4px;" /></td>
        <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="margin:0;padding:4px;" /></td>
        <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="margin:0;padding:4px;" /></td>
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
      <td>
        <select data-i="${i}" data-f="bill_type" style="margin:0;padding:4px;">
          <option ${r.bill_type==='VMI出库'?'selected':''}>VMI出库</option>
          <option ${r.bill_type==='DSP出库'?'selected':''}>DSP出库</option>
          <option ${r.bill_type==='济转西RT'?'selected':''}>济转西RT</option>
          <option ${r.bill_type==='济转西DSP'?'selected':''}>济转西DSP</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="source_no" value="${r.source_no||''}" placeholder="单号" style="margin:0;padding:4px;" /></td>
      <td>${r.owner_code}</td>
      <td>${r.bill_type === 'DSP出库' ? `<select data-i="${i}" data-f="store_code" style="margin:0;padding:4px;"><option value="">选门店</option>${myStores.map(s => `<option value="${s.store_code}" ${r.store_code===s.store_code?'selected':''}>${s.store_name}</option>`).join('')}</select>` : r.store_code}</td>
      <td><select data-i="${i}" data-f="location_code" style="margin:0;padding:4px;">${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}</select></td>
      <td>${r.pick_date}</td>
      <td><input list="p-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="margin:0;padding:4px;" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="margin:0;padding:4px;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="margin:0;padding:4px;" /></td>
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

// ================= 商品资料 =================
async function renderProducts(view) {
  if (isAdmin) {
    view.innerHTML = `<div class="card"><h2>商品资料</h2><p style="color:#999;">管理员请到管理后台的商品主数据里维护。</p></div>`
    return
  }

  let selectedVendorCode

  if (isLogistics) {
    if (!myVendors.length) {
      view.innerHTML = `<div class="card"><h2>商品资料</h2><p style="color:#cf1322;">当前物流商未配置负责厂商，请联系管理员。</p></div>`
      return
    }
    selectedVendorCode = myVendors[0].vendor_code
  } else {
    selectedVendorCode = currentProfile?.vendor_code || ''
  }

  async function loadWhs(vendorCode) {
    const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', vendorCode).maybeSingle()
    if (!vp) return []
    const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vp.id)
    return (vw || []).map(x => x.warehouse_code)
  }

  async function loadList(vendorCode) {
    const { data } = await supabase.from('product_master').select('*').eq('default_vendor_code', vendorCode).order('id', { ascending: false })
    return data || []
  }

  let myWhs = await loadWhs(selectedVendorCode)
  let list = await loadList(selectedVendorCode)

  function renderAll() {
    const merged = {}
    ;(list || []).forEach(r => {
      const k = r.product_code
      if (!merged[k]) {
        merged[k] = { ...r, warehouses: [r.warehouse_code] }
      } else {
        merged[k].warehouses.push(r.warehouse_code)
      }
    })
    const mergedList = Object.values(merged)

    view.innerHTML = `
      ${isLogistics ? `
        <div class="card">
          <div class="row">
            <div>
              <label>选择厂商</label>
              <select id="prod-vendor-select">
                ${myVendors.map(v => `<option value="${v.vendor_code}" ${v.vendor_code===selectedVendorCode?'selected':''}>${v.vendor_code}${v.vendor_name?' - '+v.vendor_name:''}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>` : ''}
      <div class="card">
        <h2>新增商品</h2>
        <div id="prod-msg"></div>
        <div class="row">
          <div><label>商品编码 *</label><input id="pd-code" /></div>
          <div><label>品名 *</label><input id="pd-name" /></div>
          <div><label>规格 * (1*1*X)</label><input id="pd-spec" placeholder="如 1*1*24" /></div>
        </div>
        <div class="row">
          <div><label>长 (cm) *</label><input id="pd-length" type="number" step="0.01" min="0.01" placeholder="长 (cm)" /></div>
          <div><label>宽 (cm) *</label><input id="pd-width"  type="number" step="0.01" min="0.01" placeholder="宽 (cm)" /></div>
          <div><label>高 (cm) *</label><input id="pd-height" type="number" step="0.01" min="0.01" placeholder="高 (cm)" /></div>
          <div><label>重量 (kg) *</label><input id="pd-weight" type="number" step="0.01" min="0.01" placeholder="重量 (kg)" /></div>
        </div>
        <p style="font-size:12px;color:#666;margin:8px 0;">授权仓库：${myWhs.join(', ') || '无'}（新增时会写入全部授权仓库）</p>
        <button id="btn-pd-add">新增商品</button>
      </div>
      <div class="card">
        <h2>商品列表（${mergedList.length}）</h2>
        <div class="scroll">
          <table>
            <tr><th>商品编码</th><th>品名</th><th>规格</th><th>长×宽×高</th><th>重量</th><th>仓库</th><th>操作</th></tr>
            <tbody>
              ${mergedList.map(r => `<tr>
                <td>${r.product_code||''}</td>
                <td>${r.product_name||''}</td>
                <td>${r.spec||''}</td>
                <td>${r.length ?? ''}×${r.width ?? ''}×${r.height ?? ''} cm</td>
                <td>${r.weight ?? ''} kg</td>
                <td style="font-size:12px;">${r.warehouses.join(', ')}</td>
                <td><button class="small secondary" data-edit="${r.product_code}">编辑</button></td>
              </tr>`).join('') || '<tr><td colspan="7">无数据</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div id="edit-product-panel"></div>`

    const vs = document.getElementById('prod-vendor-select')
    if (vs) {
      vs.onchange = async () => {
        selectedVendorCode = vs.value
        myWhs = await loadWhs(selectedVendorCode)
        list = await loadList(selectedVendorCode)
        renderAll()
      }
    }

    document.getElementById('btn-pd-add').onclick = async () => {
      const msgEl = document.getElementById('prod-msg')
      const code   = document.getElementById('pd-code').value.trim()
      const name   = document.getElementById('pd-name').value.trim()
      const spec   = document.getElementById('pd-spec').value.trim()
      const length = document.getElementById('pd-length').value.trim()
      const width  = document.getElementById('pd-width').value.trim()
      const height = document.getElementById('pd-height').value.trim()
      const weight = document.getElementById('pd-weight').value.trim()

      if (!code || !name) {
        msgEl.innerHTML = msg('商品编码、品名为必填', false); return
      }
      if (!spec) {
        msgEl.innerHTML = msg('包装规格为必填', false); return
      }
      if (!isValidSpec(spec)) {
        msgEl.innerHTML = msg('包装规格格式错误，必须是 1*1*X（X 为正整数，如 1*1*24）', false); return
      }
      if (!length || !width || !height || !weight) {
        msgEl.innerHTML = msg(SIZE_EMPTY_MSG, false); return
      }
      if (!isValidSize(length, width, height, weight)) {
        msgEl.innerHTML = msg('长、宽、高、重量必须为正数', false); return
      }
      if (!myWhs.length) {
        msgEl.innerHTML = msg('没有授权仓库，请联系管理员', false); return
      }

      for (const wh of myWhs) {
        const { data: exist } = await supabase.from('product_master')
          .select('id')
          .eq('warehouse_code', wh)
          .eq('default_vendor_code', selectedVendorCode)
          .eq('product_code', code)
          .maybeSingle()
        if (exist) {
          msgEl.innerHTML = msg(`商品编码 ${code} 在仓库 ${wh} 下已存在，无法新增`, false)
          return
        }
      }

      const rows = myWhs.map(wh => ({
        warehouse_code: wh,
        product_code: code,
        product_name: name,
        spec,
        length: Number(length),
        width:  Number(width),
        height: Number(height),
        weight: Number(weight),
        default_vendor_code: selectedVendorCode,
        default_owner_code: selectedVendorCode
      }))

      const { error } = await supabase.from('product_master').insert(rows)
      if (error) {
        msgEl.innerHTML = msg(translateError(error.message), false)
        return
      }
      msgEl.innerHTML = msg(`新增成功（写入 ${rows.length} 个仓库）`, true)
      setTimeout(async () => {
        list = await loadList(selectedVendorCode)
        renderAll()
      }, 600)
    }

    view.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => {
        const code = btn.dataset.edit
        const recs = (list || []).filter(r => r.product_code === code)
        if (!recs.length) return
        const first = recs[0]
        const panel = document.getElementById('edit-product-panel')
        panel.innerHTML = `
          <div class="card">
            <h2>编辑商品：${code}</h2>
            <div id="pedit-msg"></div>
            <div class="row">
              <div><label>品名 *</label><input id="pe-name" value="${first.product_name||''}" /></div>
              <div><label>规格 * (1*1*X)</label><input id="pe-spec" value="${first.spec||''}" /></div>
            </div>
            <div class="row">
              <div><label>长 (cm) *</label><input id="pe-length" type="number" step="0.01" min="0.01" value="${first.length ?? ''}" /></div>
              <div><label>宽 (cm) *</label><input id="pe-width"  type="number" step="0.01" min="0.01" value="${first.width ?? ''}" /></div>
              <div><label>高 (cm) *</label><input id="pe-height" type="number" step="0.01" min="0.01" value="${first.height ?? ''}" /></div>
              <div><label>重量 (kg) *</label><input id="pe-weight" type="number" step="0.01" min="0.01" value="${first.weight ?? ''}" /></div>
            </div>
            <p style="font-size:12px;color:#666;margin:8px 0;">将同时更新 ${recs.length} 条记录（仓库：${recs.map(r=>r.warehouse_code).join(', ')}）</p>
            <button id="btn-pe-save">保存</button>
            <button class="secondary" id="btn-pe-cancel">取消</button>
          </div>`

        document.getElementById('btn-pe-cancel').onclick = () => panel.innerHTML = ''

        document.getElementById('btn-pe-save').onclick = async () => {
          const msgEl = document.getElementById('pedit-msg')
          const name   = document.getElementById('pe-name').value.trim()
          const spec   = document.getElementById('pe-spec').value.trim()
          const length = document.getElementById('pe-length').value.trim()
          const width  = document.getElementById('pe-width').value.trim()
          const height = document.getElementById('pe-height').value.trim()
          const weight = document.getElementById('pe-weight').value.trim()

          if (!name) { msgEl.innerHTML = msg('品名为必填', false); return }
          if (!spec) { msgEl.innerHTML = msg('包装规格为必填', false); return }
          if (!isValidSpec(spec)) {
            msgEl.innerHTML = msg('包装规格格式错误，必须是 1*1*X（X 为正整数，如 1*1*24）', false); return
          }
          if (!length || !width || !height || !weight) {
            msgEl.innerHTML = msg(SIZE_EMPTY_MSG, false); return
          }
          if (!isValidSize(length, width, height, weight)) {
            msgEl.innerHTML = msg('长、宽、高、重量必须为正数', false); return
          }

          const patch = {
            product_name: name,
            spec,
            length: Number(length),
            width:  Number(width),
            height: Number(height),
            weight: Number(weight)
          }
          const ids = recs.map(r => r.id)
          const { error } = await supabase.from('product_master')
            .update(patch).in('id', ids)
          if (error) {
            msgEl.innerHTML = msg(translateError(error.message), false)
            return
          }
          msgEl.innerHTML = msg('已保存', true)
          setTimeout(async () => {
            list = await loadList(selectedVendorCode)
            renderAll()
          }, 600)
        }
      }
    })
  }

  renderAll()
}

// ================= 我的单据 =================
async function renderMy(view) {
  let q = supabase.from('bill_order').select('*').order('id', { ascending: false }).limit(200)

  if (isLogistics) {
    const codes = myVendors.map(v => v.vendor_code)
    if (!codes.length) { view.innerHTML = `<div class="card"><h2>我的单据</h2><p style="color:#cf1322;">未配置负责厂商。</p></div>`; return }
    q = q.in('vendor_code', codes)
  } else {
    q = q.eq('vendor_id', currentUser.id)
  }

  const { data } = await q

  view.innerHTML = `
    <div class="card" style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
      <h2>${isLogistics ? '我负责厂商的单据' : '我的单据'}</h2>
      <div id="my-msg"></div>
      <div class="scroll" style="flex:1; overflow-y:auto; border:1px solid #ebeef5; border-radius:4px;">
        <table>
          <tr><th>ID</th><th>厂编</th><th>类型</th><th>商品</th><th>数量</th><th>仓库</th><th>已导出</th><th>时间</th></tr>
          ${(data||[]).map(b => `<tr>
            <td>${b.id}</td>
            <td>${b.vendor_code||''}</td>
            <td>${b.bill_type}</td>
            <td>${b.product_code}</td>
            <td>${b.quantity}</td>
            <td>${b.warehouse_code}</td>
            <td>${b.exported ? '是' : '否'}</td>
            <td>${new Date(b.created_at).toLocaleString()}</td>
          </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无单据</td></tr>'}
        </table>
      </div>
    </div>`
}

// ================= 工具函数 =================
function addOneDay(d) {
  if (!d) return null
  const dt = new Date(d + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

function addDays(d, n) {
  if (!d) return null
  const dt = new Date(d + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function todayBj() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getModeByType(billType) {
  if (billType === 'VMI入库') return 'UNIFY'
  if (billType === 'DSP入库') return 'LIKECROSS'
  if (billType === 'VMI出库') return 'LIKECROSS'
  if (billType === 'DSP出库') return 'LIKECROSS'
  if (billType === '济转西RT') return 'LIKECROSS'
  if (billType === '济转西DSP') return 'LIKECROSS'
  return 'UNIFY'
}

async function loadDeadlineRange(vendorCode, warehouseCode) {
  const nowBj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const dow = nowBj.getDay()
  const dayType = (dow === 0 || dow === 6) ? 'weekend' : 'weekday'

  const tries = [
    { vendor: vendorCode, wh: warehouseCode, day: dayType },
    { vendor: vendorCode, wh: null, day: dayType },
    { vendor: null, wh: warehouseCode, day: dayType },
    { vendor: null, wh: null, day: dayType },
    { vendor: null, wh: null, day: 'all' }
  ]

  for (const t of tries) {
    let q = supabase.from('deadline_config').select('config_value')
    q = t.vendor ? q.eq('vendor_code', t.vendor) : q.is('vendor_code', null)
    q = t.wh ? q.eq('warehouse_code', t.wh) : q.is('warehouse_code', null)
    q = q.eq('day_type', t.day)
    const { data } = await q.maybeSingle()
    if (data?.config_value) return { range: data.config_value, dayType }
  }
  return { range: dayType === 'weekend' ? '08:00-12:00' : '07:00-15:00', dayType }
}

function calcCountdown(range) {
  const [startStr, endStr] = range.split('-')
  const [sh, sm] = startStr.split(':').map(Number)
  const [eh, em] = endStr.split(':').map(Number)

  const nowBj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const nowSec = nowBj.getHours() * 3600 + nowBj.getMinutes() * 60 + nowBj.getSeconds()
  const startSec = sh * 3600 + sm * 60
  const endSec = eh * 3600 + em * 60

  function fmt(sec) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  if (nowSec < startSec) return { text: `距开始还有 ${fmt(startSec - nowSec)}`, bg: 'linear-gradient(135deg,#fff7e6 0%,#fff1b8 100%)', border: '#ffd591', color: '#d46b08' }
  if (nowSec < endSec) return { text: `距截止还有 ${fmt(endSec - nowSec)}`, bg: 'linear-gradient(135deg,#f6ffed 0%,#e6f4ff 100%)', border: '#b7eb8f', color: '#389e0d' }
  return { text: '今日预约已截止', bg: 'linear-gradient(135deg,#fff2f0 0%,#ffccc7 100%)', border: '#ffa39e', color: '#cf1322' }
}

function startCountdown(containerId, range) {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  const wrap = document.getElementById('main-countdown')
  if (!wrap) return
  wrap.style.display = 'block'

  function tick() {
    const c = calcCountdown(range)
    const inner = document.getElementById('main-countdown-inner')
    const textEl = document.getElementById('main-countdown-text')
    if (inner) { inner.style.background = c.bg; inner.style.borderColor = c.border; inner.style.color = c.color }
    if (textEl) textEl.textContent = c.text
  }
  tick()
  countdownTimer = setInterval(tick, 1000)
}

// 在渲染填报页或质检页时，如果是留库厂商，启动倒计时
async function initCountdown() {
  if (isAdmin || currentProfile?.vendor_type === 'cross') return
  let code = currentProfile?.vendor_code || ''
  let wh = ''
  const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', currentUser.id).limit(1)
  if (vw && vw.length) wh = vw[0].warehouse_code
  const { range } = await loadDeadlineRange(code, wh)
  startCountdown('main-countdown', range)
}

// 将倒计时启动逻辑加入 init 中
const originalRenderMain = renderMain
renderMain = function() {
  originalRenderMain()
  initCountdown()
}

init()