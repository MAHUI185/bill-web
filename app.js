// app.js — 主逻辑（2026-11-07：新增「我的对账」，支持厂商/物流商查看+确认）
// 其他业务（提报、单据导出、质检、公告等）保持 2026-11-05 版本完全不变

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

// ★ 全局请求容错机制：优先走代理，失败或超时自动切直连
async function safeFetch(path, options = {}) {
  const primaryUrl = `https://api.mahui.pw${path}`
  const fallbackUrl = `https://gpjdzgakvqhnpykuqbfr.supabase.co${path}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000) // 5秒超时强制降级

  try {
    const res = await fetch(primaryUrl, { ...options, signal: controller.signal })
    clearTimeout(timeoutId)
    if (res.status === 502 || res.status === 504) throw new Error('Gateway Error')
    return res
  } catch (err) {
    clearTimeout(timeoutId)
    console.warn(`代理请求失败，自动切换直连: ${err.message}`)
    return await fetch(fallbackUrl, options)
  }
}

function msg(text, ok = true) {
  return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>`
}

// ========== 校验工具 ==========
function isValidSpec(spec) {
  if (!spec) return false
  return /^1\*1\*[1-9]\d*$/.test(String(spec).trim())
}
const SPEC_EMPTY_MSG = '包装规格为空，请先到「商品资料」补全规格后再提报'
const SIZE_EMPTY_MSG = '长、宽、高、重量为必填，请到「商品资料」补全'

function isValidSize(length, width, height, weight) {
  const vals = [length, width, height, weight].map(v => Number(v))
  return vals.every(v => !isNaN(v) && v > 0)
}

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
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}

// ========== 启动与路由 ==========
async function init() {
  renderLogin()

  try {
    const { data: cfg } = await withTimeout(
      supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    , 3000)
    
    if (cfg?.config_value === 'true') {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { data: admin } = await supabase.from('admin_users').select('role').eq('id', session.user.id).maybeSingle()
        if (admin?.role !== 'super_admin') {
          return renderMaintenance() 
        }
      } else {
        return renderMaintenance() 
      }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return 
    currentUser = session.user
    const ok = await loadProfile()
    if (!ok) return
    renderMain()
  } catch (e) {
    if (e.message === 'timeout') {
      app.innerHTML = `<div class="card" style="max-width:400px;margin:80px auto;text-align:center;">
        <h2>网络延迟过高</h2>
        <p style="margin:16px 0;color:#666;">加载超时，请刷新页面重试。</p>
        <button onclick="location.reload()">刷新</button>
      </div>`
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
  isAdmin = !!admin || profile?.account_type === 'admin' || (profile?.vendor_code || '').startsWith('ADMIN_')
  currentRole = admin?.role || (isAdmin ? 'admin' : null)
  isLogistics = profile?.account_type === 'logistics'

  if (isLogistics) {
    const { data: lv } = await withTimeout(
      supabase.from('logistics_vendor')
        .select('vendor_code, vendor_name')
        .eq('logistics_id', currentUser.id)
        .order('vendor_code')
    , 3000)
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
    const { data } = await supabase.from('system_config')
      .select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
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
      <input id="email" placeholder="请输入账号" />
      <input id="password" type="password" placeholder="密码" />
      <button id="btn-login" style="width:100%;">登录</button>
      <button class="secondary" id="btn-goto-change" style="width:100%;margin-top:8px;">修改密码</button>
    </div>`

  document.getElementById('btn-login').onclick = async () => {
    const btn = document.getElementById('btn-login')
    let email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value

    if (!email || !password) {
      document.getElementById('login-msg').innerHTML = msg('请输入账号和密码', false); return
    }

    if (email.includes('@')) {
      // 原样
    } else if (/^\d+$/.test(email)) {
      if (email.startsWith('999')) email += '@logistics.local'
      else email += '@vendor.local'
    } else if (/^[a-zA-Z0-9_]+$/.test(email)) {
      email += '@admin.local'
    } else {
      document.getElementById('login-msg').innerHTML = msg('账号格式错误', false); return
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
      btn.disabled = false; btn.innerText = '登录'; return
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
      <input id="cp-email" placeholder="请输入账号" />
      <input id="cp-old" type="password" placeholder="旧密码" />
      <input id="cp-new" type="password" placeholder="新密码（至少 6 位）" />
      <input id="cp-new2" type="password" placeholder="确认新密码" />
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

    if (!email || !oldPwd || !newPwd || !newPwd2) { msgEl.innerHTML = msg('所有字段为必填', false); return }

    if (email.includes('@')) {
      // 原样
    } else if (/^\d+$/.test(email)) {
      if (email.startsWith('999')) email += '@logistics.local'
      else email += '@vendor.local'
    } else if (/^[a-zA-Z0-9_]+$/.test(email)) {
      email += '@admin.local'
    } else {
      msgEl.innerHTML = msg('账号格式错误', false); return
    }

    if (newPwd.length < 6) { msgEl.innerHTML = msg('新密码至少 6 位', false); return }
    if (newPwd !== newPwd2) { msgEl.innerHTML = msg('两次输入的新密码不一致', false); return }

    msgEl.innerHTML = msg('处理中...', true)

    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: oldPwd })
    if (signErr) { msgEl.innerHTML = msg('旧密码错误，或账号已禁用', false); return }

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
      <input id="fp-new" type="password" placeholder="新密码（至少 6 位）" />
      <input id="fp-new2" type="password" placeholder="确认新密码" />
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
    if (error) { msgEl.innerHTML = msg(translateError(error.message), false); return }

    const { error: updErr } = await supabase.from('vendor_profile')
      .update({ must_change_pwd: false })
      .eq('id', currentUser.id)
    if (updErr) { msgEl.innerHTML = msg(translateError(updErr.message), false); return }

    msgEl.innerHTML = msg('密码已修改，正在进入系统...', true)
    setTimeout(async () => {
      const ok = await loadProfile()
      if (ok) renderMain()
    }, 800)
  }
}

function renderMain() {
  const roleTag = isAdmin ? '（管理员）' : isLogistics ? '（物流商）' : ''
  app.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:12px;">
        <img src="./logo.png" style="height:45px;width:auto;object-fit:contain;" onerror="this.style.display='none'" />
        <div>
          <h1 style="margin-bottom:4px;">厂商留库预约系统</h1>
          <p style="margin:0;">当前用户：${currentProfile?.vendor_name || currentUser.email} ${roleTag}</p>
        </div>
      </div>
      ${!isAdmin ? `
        <div id="main-countdown" style="display:none;flex:0 0 auto;">
          <div id="main-countdown-inner" style="display:inline-flex;align-items:center;gap:10px;
               padding:8px 24px;border-radius:24px;font-size:18px;font-weight:600;
               background:linear-gradient(135deg,#f6ffed 0%,#e6f4ff 100%);
               border:1px solid #b7eb8f;color:#389e0d;">
            <span style="font-size:14px;opacity:.85;">⏱</span>
            <span id="main-countdown-text">--:--:--</span>
          </div>
        </div>
      ` : ''}
      <button class="secondary" id="btn-logout" style="flex:0 0 auto;">退出登录</button>
    </div>
    <div class="nav" id="nav"></div>
    <div id="view"></div>`
    
  document.getElementById('btn-logout').onclick = async () => {
    if (activeHeartbeatTimer) { clearInterval(activeHeartbeatTimer); activeHeartbeatTimer = null }
    if (maintenanceCheckTimer) { clearInterval(maintenanceCheckTimer); maintenanceCheckTimer = null }
    await supabase.auth.signOut()
    init()
  }
  const nav = document.getElementById('nav')
  
  // ★ 新增：厂商和物流商共用「我的对账」入口
  const tabs = isAdmin 
    ? [['fill','管理填报'], ['admin','管理后台']] 
    : [['fill','填报'],['my','我的单据'],['products','商品资料'],['qc','质检报告'],['billing','我的对账']]
  
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

  if (activeHeartbeatTimer) { clearInterval(activeHeartbeatTimer); activeHeartbeatTimer = null }
  if (currentUser) {
    const beat = async () => {
      try {
        await supabase.from('vendor_profile').update({ last_active_at: new Date().toISOString() }).eq('id', currentUser.id)
      } catch (e) {}
    }
    beat()
    activeHeartbeatTimer = setInterval(beat, 3 * 60 * 1000)
  }

  // ★ 公告弹窗检查 (仅厂商和物流商)
  if (!isAdmin) {
    checkAnnouncements()
  }

  if (currentRole === 'super_admin') return; 

  if (maintenanceCheckTimer) { clearInterval(maintenanceCheckTimer); maintenanceCheckTimer = null }
  maintenanceCheckTimer = setInterval(async () => {
    try {
      const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
      if (data?.config_value === 'true') {
        clearInterval(maintenanceCheckTimer)
        if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer)
        alert('系统已进入维护模式，当前登录已失效，请稍后再试。')
        await supabase.auth.signOut()
        location.reload()
      }
    } catch (e) {}
  }, 30000)
}

async function renderView(key) {
  const view = document.getElementById('view')
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
  const cdEl = document.getElementById('main-countdown')
  if (cdEl) cdEl.style.display = 'none'

  if (key === 'fill') return renderFill(view)
  if (key === 'my') return renderMy(view)
  if (key === 'products') return renderProducts(view)
  if (key === 'qc') return renderQC(view)
  // ★ 新增：我的对账路由
  if (key === 'billing') return renderBilling(view)
  if (key === 'admin') {
    try {
      const mod = await import('./admin.js')
      await mod.renderAdmin(view, {
        supabase, currentUser, currentProfile, isAdmin, currentRole,
        msg, SUPABASE_URL, translateError
      })
    } catch (e) {
      console.error('管理后台加载失败', e)
      view.innerHTML = msg('管理后台加载失败', false)
    }
  }
}

// ========== 时间与业务计算工具 ==========
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
  if (billType === 'VMI入库' || billType.includes('济转西RT(入库)')) return 'UNIFY'
  if (billType === 'DSP入库' || billType.includes('济转西DSP(入库)')) return 'LIKECROSS'
  return 'LIKECROSS'
}

function calcInFields(billType, supplierInput) {
  if (billType === 'VMI入库' || billType.includes('济转西RT(入库)')) {
    return { vendor_code: supplierInput, owner_code: supplierInput }
  }
  if (billType === 'DSP入库' || billType.includes('济转西DSP(入库)')) {
    return { vendor_code: supplierInput, owner_code: '8888' }
  }
  return { vendor_code: supplierInput, owner_code: '' }
}

// ★ 核心修改：济转西DSP出库货主代码改为厂商编码
function calcOutFields(billType, supplierInput, defaultStore) {
  if (billType === 'VMI出库') {
    return { owner_code: supplierInput, store_code: defaultStore || '' }
  }
  
  if (billType === 'DSP出库') {
    return { owner_code: '8888', store_code: '' }
  }
  
  if (billType === '济转西RT(留库)') {
    return { owner_code: supplierInput, store_code: '8205' }
  }
  if (billType === '济转西RT(越库)') {
    return { owner_code: supplierInput, store_code: '8205' }
  }
  
  if (billType === '济转西DSP(留库)') {
    return { owner_code: supplierInput, store_code: '8205' }
  }
  if (billType === '济转西DSP(越库)') {
    return { owner_code: supplierInput, store_code: '8205' }
  }
  
  return { owner_code: '', store_code: '' }
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

// ================= 填报 =================
async function renderFill(view) {
  let selectedVendor = null
  let isAdminDelegate = isAdmin 

  if (isAdminDelegate) {
    const { data: vps } = await supabase.from('vendor_profile').select('vendor_code, vendor_name').eq('account_type', 'vendor').order('vendor_code')
    if (!vps || !vps.length) {
      view.innerHTML = `<div class="card"><h2>代报单据</h2><p style="color:#cf1322;">系统中暂无厂商，请先创建厂商。</p></div>`
      return
    }
    myVendors = vps
    selectedVendor = vps[0]
  } else if (isLogistics) {
    if (!myVendors.length) {
      view.innerHTML = `<div class="card"><h2>填报单据</h2><p style="color:#cf1322;">当前物流商未配置负责厂商，请联系管理员。</p></div>`
      return
    }
    selectedVendor = myVendors[0]
  } else {
    selectedVendor = { vendor_code: currentProfile?.vendor_code || '', vendor_name: currentProfile?.vendor_name || '' }
  }

  let myVendorCode = selectedVendor.vendor_code

  // ★ 核心修复：增加管理员兜底
  let myWhs = []
  if (isAdminDelegate || isLogistics) {
    const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', myVendorCode).maybeSingle()
    if (vp) {
      const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vp.id)
      myWhs = (vw||[]).map(x => x.warehouse_code)
    }
    // 如果是管理员代报，且数据库 RLS 拦截导致查不到仓库，强行兜底给 2608
    if (isAdminDelegate && myWhs.length === 0) {
      myWhs = ['2608']
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

  const { range } = await loadDeadlineRange(myVendorCode, myWhs[0] || null)

  let locs = []
  const { data: locData } = await supabase.from('location_config')
    .select('warehouse_code, location_code')
    .eq('status', 1)
    .in('warehouse_code', myWhs.length ? myWhs : ['__none__'])
  locs = locData || []

  let myStores = []
  const { data: stores } = await supabase.from('store_config').select('warehouse_code, store_code, store_name').eq('status', 1)
  myStores = (stores||[]).filter(s => !s.warehouse_code || myWhs.includes(s.warehouse_code))

  async function loadProducts(vendorCode) {
    const { data } = await supabase.from('product_master').select('product_code, product_name, spec, length, width, height, weight').eq('default_vendor_code', vendorCode).order('product_code')
    return data || []
  }
  let productList = await loadProducts(myVendorCode)

  let inRows = [newInRowForVendor(myVendorCode)]
  let outRows = [newOutRowForVendor(myVendorCode)]

  function newInRowForVendor(vc) {
    const f = calcInFields('VMI入库', vc)
    return {
      source_no: '', bill_type: 'VMI入库',
      vendor_code: f.vendor_code, owner_code: f.owner_code,
      location_code: (locs && locs[0]) ? locs[0].location_code : '',
      product_code: '', spec: '', quantity: '',
      arrival_date: addDays(todayBj(), 1),
      product_name: ''
    }
  }
  function newOutRowForVendor(vc) {
    const f = calcOutFields('VMI出库', vc, defaultStoreCode)
    return {
      bill_type: 'VMI出库',
      source_no: '',
      owner_code: f.owner_code,
      store_code: f.store_code,
      location_code: (locs && locs[0]) ? locs[0].location_code : '',
      pick_date: addDays(todayBj(), 2),
      product_code: '', spec: '', quantity: '',
      product_name: ''
    }
  }

  function isInRowFilled(r) { return !!(r.product_code || r.spec || r.quantity) }
  function isOutRowFilled(r) { return !!(r.product_code || r.spec || r.quantity || r.source_no) }

  function productOptionsHtml() {
    return productList.map(p => `<option value="${p.product_code}">${p.product_code} - ${p.product_name||''} - ${p.spec||''}</option>`).join('')
  }

  function findProduct(code) { return productList.find(p => p.product_code === code) }

  function startCountdown() {
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

  function render() {
    view.innerHTML = `
      <div class="card">
        <h2>${isAdminDelegate ? '管理员代报' : '填报单据'}</h2>
        ${isLogistics || isAdminDelegate ? `
          <div class="row" style="margin-bottom:12px;">
            <div style="position:relative;">
              <label>代报厂商 *</label>
              <input id="vendor-search-input" placeholder="输入厂编或名称搜索，如 208654" value="${myVendorCode}" autocomplete="off" />
              <div id="vendor-suggest-box" style="position:absolute; top: 65px; left: 0; right: 0; background:#fff; border:1px solid #eee; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,.1); z-index:100; display:none; max-height:200px; overflow:auto;"></div>
            </div>
          </div>` : ''}
        <div id="fill-msg"></div>

        <h3 style="margin:16px 0 8px;">入库单</h3>
        
        <div style="background:#f6ffed; border:1px dashed #b7eb8f; border-radius:4px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; color:#389e0d; margin-bottom:8px; font-weight:bold;">
            ⚡ 批量录入（从 Excel 复制：货号 / 箱数）
          </div>
          <textarea id="in-paste-area" placeholder="在此粘贴，支持多行。例如：&#10;4303389   2&#10;4303387   3" style="width:100%; height:80px; padding:8px; border:1px solid #ccc; border-radius:4px; font-family:monospace; margin-bottom:8px;"></textarea>
          <div style="display:flex; gap:8px;">
            <button type="button" class="secondary" id="btn-parse-in" style="background:#f6ffed; border-color:#52c41a; color:#389e0d;">添加到下方表格</button>
            <button type="button" class="secondary" id="btn-clear-in-paste" style="background:#fff; color:#666;">清空</button>
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table style="white-space:nowrap;">
            <thead>
              <tr>
                <th>类型</th><th>供应商代码</th><th>货主代码</th>
                <th>仓位</th><th>商品代码</th><th>规格</th>
                <th>箱数</th><th>到仓日期</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="in-body"></tbody>
          </table>
        </div>
        <button class="secondary small" id="btn-add-in" style="margin-top:8px;">+ 添加入库行</button>

        <h3 style="margin:24px 0 8px;">出库单</h3>
        <p style="font-size:12px;color:#d46b08;margin-bottom:8px;">注意：预约「DSP出库」「济转西DSP(越库)」前，必须已经预约过同货主、同商品的「DSP入库」单据。</p>
        
        <div style="background:#f0f5ff; border:1px dashed #91caff; border-radius:4px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; color:#1677ff; margin-bottom:8px; font-weight:bold;">
            ⚡ 批量录入（智能识别 VMI/DSP）<br>
            <span style="font-size:12px; font-weight:normal; color:#666;">复制 3 列(单号/货号/箱数)将默认 VMI 出库；复制 4 列(单号/货号/箱数/门店)将自动识别为 DSP 出库。</span>
          </div>
          <textarea id="out-paste-area" placeholder="在此粘贴，支持多行。例如：&#10;VMI: 262881558   4303389   2&#10;DSP: 264065450   4251857   1   2017济宁店" style="width:100%; height:80px; padding:8px; border:1px solid #ccc; border-radius:4px; font-family:monospace; margin-bottom:8px;"></textarea>
          <div style="display:flex; gap:8px;">
            <button type="button" class="secondary" id="btn-parse-out" style="background:#e6f4ff; border-color:#1677ff; color:#1677ff;">添加到下方表格</button>
            <button type="button" class="secondary" id="btn-clear-paste" style="background:#fff; color:#666;">清空</button>
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table style="white-space:nowrap;">
            <thead>
              <tr>
                <th>类型</th><th>采购单号</th><th>货主代码</th><th>门店代码</th>
                <th>仓位</th><th>到店日期</th>
                <th>商品代码</th><th>规格</th><th>箱数</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="out-body"></tbody>
          </table>
        </div>
        <button class="secondary small" id="btn-add-out" style="margin-top:8px;">+ 添加出库行</button>

        <h3 style="margin:24px 0 8px;">预览</h3>
        <div id="preview-box"></div>

        <div style="margin-top:16px;">
          <button id="btn-submit-all">提交预约</button>
          <button class="secondary" id="btn-clear-all">清空</button>
        </div>
      </div>`

    renderInTable()
    renderOutTable()
    renderPreview()
    if (!isAdminDelegate) startCountdown()

    if (isLogistics || isAdminDelegate) {
      const searchInput = document.getElementById('vendor-search-input')
      const suggestBox = document.getElementById('vendor-suggest-box')

      searchInput.oninput = () => {
        const kw = searchInput.value.trim().toLowerCase()
        if (!kw) { suggestBox.style.display = 'none'; return }

        const matches = myVendors.filter(v => 
          v.vendor_code.toLowerCase().includes(kw) || 
          (v.vendor_name || '').toLowerCase().includes(kw)
        ).slice(0, 10)

        if (!matches.length) {
          suggestBox.innerHTML = '<div style="padding:8px;color:#999;font-size:12px;">未找到匹配厂商</div>'
          suggestBox.style.display = 'block'
          return
        }

        suggestBox.innerHTML = matches.map(v => `
          <div data-pick="${v.vendor_code}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5;"
               onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='#fff'">
            <strong style="color:#1677ff;">${v.vendor_code}</strong> - ${v.vendor_name}
          </div>
        `).join('')
        suggestBox.style.display = 'block'

        suggestBox.querySelectorAll('[data-pick]').forEach(el => {
          el.onmousedown = async (e) => {
            e.preventDefault()
            const vc = el.dataset.pick
            
            if (vc === myVendorCode) {
              searchInput.value = vc
              suggestBox.style.display = 'none'
              return
            }

            const hasData = inRows.some(isInRowFilled) || outRows.some(isOutRowFilled)
            if (hasData && !confirm('切换厂商会清空当前已填写的内容，确定切换吗？')) {
              searchInput.value = myVendorCode
              suggestBox.style.display = 'none'
              return
            }

            selectedVendor = myVendors.find(v => v.vendor_code === vc)
            myVendorCode = vc
            searchInput.value = vc
            suggestBox.style.display = 'none'

            productList = await loadProducts(vc)
            
            const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', vc).maybeSingle()
            if (vp) {
              const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vp.id)
              myWhs = (vw||[]).map(x => x.warehouse_code)
              // ★ 管理员兜底
              if (isAdminDelegate && myWhs.length === 0) myWhs = ['2608']
              
              if (myWhs.length) {
                const { data: whInfo } = await supabase.from('warehouse').select('default_store_code').eq('warehouse_code', myWhs[0]).maybeSingle()
                defaultStoreCode = whInfo?.default_store_code || ''
              } else {
                defaultStoreCode = ''
              }
            }
            
            // ★ 刷新 locs 和 myStores
            const { data: locData } = await supabase.from('location_config')
              .select('warehouse_code, location_code')
              .eq('status', 1)
              .in('warehouse_code', myWhs.length ? myWhs : ['__none__'])
            locs = locData || []

            const { data: stores } = await supabase.from('store_config').select('warehouse_code, store_code, store_name').eq('status', 1)
            myStores = (stores||[]).filter(s => !s.warehouse_code || myWhs.includes(s.warehouse_code))

            inRows = [newInRowForVendor(vc)]
            outRows = [newOutRowForVendor(vc)]
            render()
          }
        })
      }

      searchInput.onblur = () => {
        setTimeout(() => { suggestBox.style.display = 'none' }, 200)
      }
    }

    const btnAddIn = document.getElementById('btn-add-in')
    if (btnAddIn) btnAddIn.onclick = () => { inRows.push(newInRowForVendor(myVendorCode)); renderInTable(); renderPreview() }

    const btnAddOut = document.getElementById('btn-add-out')
    if (btnAddOut) btnAddOut.onclick = () => { outRows.push(newOutRowForVendor(myVendorCode)); renderOutTable(); renderPreview() }
    
    // 入库解析
    document.getElementById('btn-parse-in').onclick = () => {
      const txt = document.getElementById('in-paste-area').value.trim()
      if (!txt) return alert('请先粘贴数据')

      const lines = txt.split(/\r?\n/).filter(l => l.trim())
      const parsedMap = new Map()
      let errorMsgs = []
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const cols = line.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean)
        
        if (cols.length < 2) { errorMsgs.push(`第 ${i+1} 行：列数不足（需包含 货号/箱数）`); continue }

        const product_code = cols[0]
        const boxQtyStr = cols[cols.length - 1]
        const boxQty = Number(boxQtyStr)

        if (!/^\d+$/.test(product_code)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 必须是纯数字`); continue }
        if (isNaN(boxQty) || boxQty <= 0) { errorMsgs.push(`第 ${i+1} 行：箱数 [${boxQtyStr}] 必须是大于 0 的数字`); continue }

        const p = findProduct(product_code)
        if (!p) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 在商品库不存在`); continue }
        
        if (isProductInvalid(p)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 资料不完善（缺长宽高或规格不正确），请先去补充`); continue }
        if (!isValidSpec(p.spec)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 规格不合规`); continue }

        if (parsedMap.has(product_code)) {
          parsedMap.get(product_code).quantity += boxQty
        } else {
          parsedMap.set(product_code, { product_code, product_name: p.product_name, spec: p.spec, quantity: boxQty })
        }
      }

      if (errorMsgs.length > 0) return alert(`❌ 解析失败：\n` + errorMsgs.slice(0, 5).join('\n'))

      let addedCount = 0
      parsedMap.forEach(item => {
        const existRow = inRows.find(r => r.bill_type === 'VMI入库' && r.product_code === item.product_code)
        if (existRow) existRow.quantity = Number(existRow.quantity) + item.quantity
        else {
          const newRow = newInRowForVendor(myVendorCode)
          Object.assign(newRow, item)
          inRows.push(newRow)
          addedCount++
        }
      })

      document.getElementById('in-paste-area').value = ''
      renderInTable(); renderPreview()
      alert(`✅ 解析成功！新增 ${addedCount} 行。`)
    }

    document.getElementById('btn-clear-in-paste').onclick = () => { document.getElementById('in-paste-area').value = '' }

    // 出库解析
    document.getElementById('btn-parse-out').onclick = () => {
      const txt = document.getElementById('out-paste-area').value.trim()
      if (!txt) return alert('请先粘贴数据')

      const lines = txt.split(/\r?\n/).filter(l => l.trim())
      const parsedMap = new Map()
      let errorMsgs = []
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const cols = line.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean)
        
        if (cols.length < 3) { errorMsgs.push(`第 ${i+1} 行：列数不足（需包含 单号/货号/箱数）`); continue }

        const rawSourceNo = cols[0].split(' ')[0].trim()
        const product_code = cols[1]
        const boxQtyStr = cols[2]
        const boxQty = Number(boxQtyStr)

        if (!/^\d{9}$/.test(rawSourceNo)) { errorMsgs.push(`第 ${i+1} 行：单号 [${rawSourceNo}] 格式错误，必须9位数字`); continue }
        if (!/^\d+$/.test(product_code)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 必须是纯数字`); continue }
        if (isNaN(boxQty) || boxQty <= 0) { errorMsgs.push(`第 ${i+1} 行：箱数 [${boxQtyStr}] 错误`); continue }

        const p = findProduct(product_code)
        if (!p) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 不存在`); continue }
        
        if (isProductInvalid(p)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 资料不完善（缺长宽高或规格不正确），请先去补充`); continue }
        if (!isValidSpec(p.spec)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 规格不合规`); continue }

        let billType = 'VMI出库'
        let storeCode = ''
        
        if (cols.length >= 4) {
          billType = 'DSP出库'
          const rawStore = cols[3]
          const matchedStore = myStores.find(s => s.store_code === rawStore || rawStore.includes(s.store_name) || rawStore.includes(s.store_code))
          
          if (!matchedStore) {
            errorMsgs.push(`第 ${i+1} 行：DSP出库的门店 [${rawStore}] 在系统中找不到`)
            continue
          }
          storeCode = matchedStore.store_code
        }

        const key = `${rawSourceNo}_${product_code}_${billType}_${storeCode}`
        if (parsedMap.has(key)) {
          parsedMap.get(key).quantity += boxQty
        } else {
          parsedMap.set(key, {
            source_no: rawSourceNo, 
            product_code, 
            product_name: p.product_name, 
            spec: p.spec, 
            quantity: boxQty, 
            billType, 
            storeCode
          })
        }
      }

      if (errorMsgs.length > 0) return alert(`❌ 解析失败：\n` + errorMsgs.slice(0, 5).join('\n'))

      let addedCount = 0
      parsedMap.forEach(item => {
        const existRow = outRows.find(r => 
          r.source_no === item.source_no && 
          r.product_code === item.product_code &&
          r.bill_type === item.billType &&
          r.store_code === item.storeCode
        )
        
        if (existRow) {
          existRow.quantity = Number(existRow.quantity) + item.quantity
        } else {
          const newRow = newOutRowForVendor(myVendorCode)
          newRow.source_no = item.source_no
          newRow.product_code = item.product_code
          newRow.product_name = item.product_name
          newRow.spec = item.spec
          newRow.quantity = item.quantity
          
          newRow.bill_type = item.billType
          if (item.billType === 'DSP出库') {
            newRow.owner_code = '8888'
            newRow.store_code = item.storeCode
          }

          outRows.push(newRow)
          addedCount++
        }
      })

      document.getElementById('out-paste-area').value = ''
      renderOutTable(); renderPreview()
      alert(`✅ 解析成功！新增 ${addedCount} 行。`)
    }

    document.getElementById('btn-clear-paste').onclick = () => { document.getElementById('out-paste-area').value = '' }

    const btnClear = document.getElementById('btn-clear-all')
    if (btnClear) btnClear.onclick = () => {
      if (!confirm('确定清空所有已填内容？')) return
      inRows = [newInRowForVendor(myVendorCode)]
      outRows = [newOutRowForVendor(myVendorCode)]
      render()
    }

    const btnSubmit = document.getElementById('btn-submit-all')
    if (btnSubmit) btnSubmit.onclick = async () => {
      const msgEl = document.getElementById('fill-msg')
      const { data: cfg } = await supabase.from('system_config').select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
      if (cfg?.config_value === 'true') return msgEl.innerHTML = msg('系统部署维护中，暂时无法预约', false)

      const filledIn = inRows.filter(isInRowFilled)
      const filledOut = outRows.filter(isOutRowFilled)
      if (filledIn.length === 0 && filledOut.length === 0) return msgEl.innerHTML = msg('请至少填写一条单据', false)

      const errors = []

      inRows.forEach((r, idx) => {
        if (!isInRowFilled(r)) return
        const missing = []
        if (!r.location_code) missing.push('仓位')
        if (!r.product_code) missing.push('商品代码')
        if (!r.spec) errors.push(`入库单 第 ${idx+1} 行：商品 [${r.product_code}] ${SPEC_EMPTY_MSG}`)
        else if (!isValidSpec(r.spec)) errors.push(`入库单 第 ${idx+1} 行：商品 [${r.product_code}] 规格格式错误`)
        if (!r.quantity) missing.push('箱数')
        if (!r.arrival_date) missing.push('到仓日期')
        if (missing.length) errors.push(`入库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      })

      outRows.forEach((r, idx) => {
        if (!isOutRowFilled(r)) return
        const missing = []
        if (r.bill_type === 'VMI出库' && !r.source_no) missing.push('采购单号')
        if (!r.location_code) missing.push('仓位')
        if (!r.product_code) missing.push('商品代码')
        if (!r.spec) errors.push(`出库单 第 ${idx+1} 行：商品 [${r.product_code}] ${SPEC_EMPTY_MSG}`)
        else if (!isValidSpec(r.spec)) errors.push(`出库单 第 ${idx+1} 行：商品 [${r.product_code}] 规格格式错误`)
        if (!r.quantity) missing.push('箱数')
        if (!r.pick_date) missing.push('到店日期')
        if (r.bill_type.includes('DSP')) {
          if (!r.store_code) missing.push('门店代码')
        }
        if (missing.length) errors.push(`出库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      })

      if (errors.length) {
        msgEl.innerHTML = `<div class="msg err"><strong>提交失败：</strong><div style="margin-top:8px;font-size:13px;line-height:1.8;">${errors.map(e => `<div>${e}</div>`).join('')}</div></div>`
        return
      }

      const validIn = inRows.filter(isInRowFilled)
      const validOut = outRows.filter(isOutRowFilled)

      const dspOutRows = validOut.filter(r =>
        r.bill_type === 'DSP出库' || r.bill_type === '济转西DSP(越库)'
      )
      if (dspOutRows.length > 0) {
        const validDspInKeys = new Set()
        validIn.forEach(r => {
          if (r.bill_type.includes('DSP')) validDspInKeys.add(`${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`)
        })

        const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).toISOString().slice(0, 10)
        const startIso = new Date(todayStr + 'T00:00:00+08:00').toISOString()

        const { data: dbDspIns, error: dspErr } = await supabase.from('bill_order')
          .select('owner_code, product_code')
          .eq('vendor_code', myVendorCode)
          .ilike('bill_type', '%DSP%')
          .ilike('bill_type', '%入库%')
          .gte('created_at', startIso)

        if (dspErr) return msgEl.innerHTML = msg('校验 DSP 前置单据失败', false)
        if (dbDspIns) dbDspIns.forEach(r => validDspInKeys.add(`${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`))

        const finalMissing = []
        dspOutRows.forEach(r => {
          const key = `${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`
          if (!validDspInKeys.has(key)) finalMissing.push(r.product_code)
        })

        if (finalMissing.length > 0) {
          const errCodes = [...new Set(finalMissing)].join('、')
          return msgEl.innerHTML = msg(`提交失败：商品 [${errCodes}] 在今天没有对应的 DSP入库 记录。`, false)
        }
      }

      let vendorAuthId
      if (isLogistics || isAdminDelegate) {
        const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', myVendorCode).maybeSingle()
        if (!vp) return msgEl.innerHTML = msg('找不到代报厂商', false)
        vendorAuthId = vp.id
      } else {
        vendorAuthId = currentUser.id
      }

      let defaultWh = myWhs[0]
      if (!defaultWh) return msgEl.innerHTML = msg('没有授权仓库', false)

      function calcQty(specStr, boxQty) {
        if (!boxQty) return 0
        if (!specStr) return Number(boxQty)
        const parts = String(specStr).split('*')
        const multiplier = Number(parts[parts.length - 1])
        if (isNaN(multiplier) || multiplier === 0) return Number(boxQty)
        return Number(boxQty) * multiplier
      }

      const inPayloads = validIn.map(r => ({
        vendor_id: vendorAuthId, warehouse_code: defaultWh,
        bill_type: r.bill_type, source_no: r.source_no || null,
        vendor_code: r.vendor_code, owner_code: r.owner_code,
        location_code: r.location_code, logistics_mode: getModeByType(r.bill_type),
        product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity),
        price: 1, arrival_date: r.arrival_date || null, effective_date: addOneDay(r.arrival_date),
        whole_process: 'NO', 
        product_name: r.product_name || '',
        product_remark: r.product_name || r.product_code || '无',
        submitter_type: isAdmin ? 'admin' : 'vendor'
      }))

      const outPayloads = validOut.map(r => ({
        vendor_id: vendorAuthId, warehouse_code: defaultWh,
        bill_type: r.bill_type, source_no: r.source_no || null, inbound_order_no: r.source_no || null,
        owner_code: r.owner_code, store_code: r.store_code,
        location_code: r.location_code, logistics_mode: getModeByType(r.bill_type),
        pick_date: r.pick_date || null, effective_date: addOneDay(r.pick_date),
        product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity),
        price: 1, 
        product_name: r.product_name || '',
        product_remark: r.product_name || r.product_code || '无',
        submitter_type: isAdmin ? 'admin' : 'vendor', vendor_code: myVendorCode
      }))

      const all = [...inPayloads, ...outPayloads]
      msgEl.innerHTML = msg('预约中...', true)

      const { error } = await supabase.from('bill_order').insert(all)
      if (error) return msgEl.innerHTML = msg(translateError(error.message), false)

      msgEl.innerHTML = msg(`预约成功：入库 ${inPayloads.length} 条，出库 ${outPayloads.length} 条`, true)
      inRows = [newInRowForVendor(myVendorCode)]
      outRows = [newOutRowForVendor(myVendorCode)]
      setTimeout(() => render(), 800)
    }
  }

  function renderInTable() {
    const tbody = document.getElementById('in-body')
    if (!tbody) return
    tbody.innerHTML = inRows.map((r, i) => {
      const autoSource = (r.owner_code && r.arrival_date) ? r.owner_code + r.arrival_date.replace(/-/g, '') : ''
      if (autoSource) r.source_no = autoSource
      return `<tr>
      <td>
        <select data-i="${i}" data-f="bill_type" style="width:120px;margin:0;padding:4px;">
          <option value="VMI入库" ${r.bill_type==='VMI入库'?'selected':''}>VMI入库</option>
          <option value="DSP入库" ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option>
          <option value="济转西RT(入库)" ${r.bill_type==='济转西RT(入库)'?'selected':''}>济转西RT(入库)</option>
          <option value="济转西DSP(入库)" ${r.bill_type==='济转西DSP(入库)'?'selected':''}>济转西DSP(入库)</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="vendor_code" value="${r.vendor_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td>
        <select data-i="${i}" data-f="location_code" style="width:70px;margin:0;padding:4px;">
          ${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}
        </select>
      </td>
      <td><input list="product-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:110px;margin:0;padding:4px;" placeholder="输入或选择" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:80px;margin:0;padding:4px;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:60px;margin:0;padding:4px;" /></td>
      <td><input type="date" data-i="${i}" data-f="arrival_date" value="${r.arrival_date}" ${isAdminDelegate ? '' : 'readonly'} style="width:110px;margin:0;padding:4px;${isAdminDelegate ? '' : 'background:#f5f5f5; pointer-events: none;'}" /></td>
      <td><button class="small danger" data-del-in="${i}" style="padding:4px 8px;">删除</button></td>
    </tr>`
    }).join('')

    let dl = document.getElementById('product-list')
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'product-list'; document.body.appendChild(dl) }
    dl.innerHTML = productOptionsHtml()

    tbody.querySelectorAll('input,select').forEach(el => {
      el.oninput = el.onchange = () => {
        const i = Number(el.dataset.i)
        const f = el.dataset.f
        const r = inRows[i]

        if (f === 'product_code') {
          r.product_code = el.value
          const p = findProduct(el.value)
          if (p) { 
            if (isProductInvalid(p)) {
              alert(`⚠️ 商品 [${p.product_code}] 资料不完善！\n\n可能原因：\n- 缺失长宽高或重量\n- 规格不是 1*1*X 格式\n- 品名或货号不规范\n\n请先到「商品资料」页面补充完整后再填报！`)
              el.value = ''
              r.product_code = ''
              r.spec = ''
              const specInput = el.closest('tr').querySelector('[data-f="spec"]')
              if (specInput) specInput.value = ''
              return
            }
            r.product_name = p.product_name || ''; 
            r.spec = p.spec || ''; 
            el.closest('tr').querySelector('[data-f="spec"]').value = r.spec 
          } 
          else { r.product_name = '' }
          renderPreview(); return
        }

        if (f === 'bill_type') {
          r.bill_type = el.value
          const f2 = calcInFields(r.bill_type, r.vendor_code)
          r.owner_code = f2.owner_code
          r.source_no = (r.vendor_code && r.arrival_date) ? r.vendor_code + r.arrival_date.replace(/-/g, '') : ''
          renderInTable(); renderPreview(); return
        }

        r[f] = el.value
        if (f === 'vendor_code' || f === 'arrival_date') {
          r.source_no = (r.owner_code && r.arrival_date) ? r.owner_code + r.arrival_date.replace(/-/g, '') : ''
        }
        renderPreview()
      }
    })
    tbody.querySelectorAll('[data-del-in]').forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.delIn)
        if (inRows.length === 1) return alert('至少保留一行')
        inRows.splice(i, 1); renderInTable(); renderPreview()
      }
    })
  }

  function renderOutTable() {
    const tbody = document.getElementById('out-body')
    if (!tbody) return
    tbody.innerHTML = outRows.map((r, i) => `<tr>
      <td>
        <select data-i="${i}" data-f="bill_type" style="width:140px;margin:0;padding:4px;">
          <option value="VMI出库" ${r.bill_type==='VMI出库'?'selected':''}>VMI出库</option>
          <option value="DSP出库" ${r.bill_type==='DSP出库'?'selected':''}>DSP出库</option>
          <option value="济转西RT(留库)" ${r.bill_type==='济转西RT(留库)'?'selected':''}>济转西RT(留库)</option>
          <option value="济转西RT(越库)" ${r.bill_type==='济转西RT(越库)'?'selected':''}>济转西RT(越库)</option>
          <option value="济转西DSP(留库)" ${r.bill_type==='济转西DSP(留库)'?'selected':''}>济转西DSP(留库)</option>
          <option value="济转西DSP(越库)" ${r.bill_type==='济转西DSP(越库)'?'selected':''}>济转西DSP(越库)</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="source_no" value="${r.source_no || ''}" placeholder="采购单号" style="width:100px;margin:0;padding:4px;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td>
        ${(r.bill_type === 'VMI出库' || r.bill_type.includes('济转西'))
          ? `<input data-i="${i}" data-f="store_code" value="${r.store_code}" readonly style="width:90px;margin:0;padding:4px;background:#f5f5f5;" />`
          : `<select data-i="${i}" data-f="store_code" style="width:110px;margin:0;padding:4px;">
               <option value="">请选择门店</option>
               ${myStores.map(s => `<option value="${s.store_code}" ${r.store_code===s.store_code?'selected':''}>${s.store_code}${s.store_name?' - '+s.store_name:''}</option>`).join('')}
             </select>`}
      </td>
      <td>
        <select data-i="${i}" data-f="location_code" style="width:70px;margin:0;padding:4px;">
          ${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" data-i="${i}" data-f="pick_date" value="${r.pick_date}" ${isAdminDelegate ? '' : 'readonly'} style="width:110px;margin:0;padding:4px;${isAdminDelegate ? '' : 'background:#f5f5f5; pointer-events: none;'}" /></td>
      <td><input list="product-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:110px;margin:0;padding:4px;" placeholder="输入或选择" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:80px;margin:0;padding:4px;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:60px;margin:0;padding:4px;" /></td>
      <td><button class="small danger" data-del-out="${i}" style="padding:4px 8px;">删除</button></td>
    </tr>`).join('')

    tbody.querySelectorAll('input,select').forEach(el => {
      el.oninput = el.onchange = () => {
        const i = Number(el.dataset.i)
        const f = el.dataset.f
        const r = outRows[i]

        if (f === 'product_code') {
          r.product_code = el.value
          const p = findProduct(el.value)
          if (p) { 
            if (isProductInvalid(p)) {
              alert(`⚠️ 商品 [${p.product_code}] 资料不完善！\n\n可能原因：\n- 缺失长宽高或重量\n- 规格不是 1*1*X 格式\n- 品名或货号不规范\n\n请先到「商品资料」页面补充完整后再填报！`)
              el.value = ''
              r.product_code = ''
              r.spec = ''
              const specInput = el.closest('tr').querySelector('[data-f="spec"]')
              if (specInput) specInput.value = ''
              return
            }
            r.product_name = p.product_name || ''; 
            r.spec = p.spec || ''; 
            el.closest('tr').querySelector('[data-f="spec"]').value = r.spec 
          } 
          else { r.product_name = '' }
          renderPreview(); return
        }

        if (f === 'bill_type') {
          r.bill_type = el.value
          const f2 = calcOutFields(r.bill_type, myVendorCode, defaultStoreCode)
          r.owner_code = f2.owner_code; r.store_code = f2.store_code
          renderOutTable(); renderPreview(); return
        }

        r[f] = el.value
        renderPreview()
      }
    })
    tbody.querySelectorAll('[data-del-out]').forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.delOut)
        if (outRows.length === 1) return alert('至少保留一行')
        outRows.splice(i, 1); renderOutTable(); renderPreview()
      }
    })
  }

  function renderPreview() {
    const box = document.getElementById('preview-box')
    if (!box) return
    const validIn = inRows.filter(r => r.product_code && r.quantity)
    const validOut = outRows.filter(r => r.product_code && r.quantity)
    box.innerHTML = `
      <div style="margin-bottom:12px; overflow-x:auto;">
        <strong>入库 ${validIn.length} 条：</strong>
        ${validIn.length === 0 ? '<span style="color:#999;">无</span>' : `
        <table style="margin-top:6px; white-space:nowrap;">
          <tr><th>类型</th><th>供应商代码</th><th>货主代码</th><th>仓位</th><th>商品</th><th>品名</th><th>规格</th><th>箱数</th><th>到仓日期</th></tr>
          ${validIn.map(r => `<tr>
            <td>${r.bill_type}</td><td>${r.vendor_code}</td><td>${r.owner_code}</td>
            <td>${r.location_code}</td><td>${r.product_code}</td><td>${r.product_name||''}</td><td>${r.spec}</td>
            <td>${r.quantity}</td><td>${r.arrival_date || '-'}</td>
          </tr>`).join('')}
        </table>`}
      </div>
      <div style="overflow-x:auto;">
        <strong>出库 ${validOut.length} 条：</strong>
        ${validOut.length === 0 ? '<span style="color:#999;">无</span>' : `
        <table style="margin-top:6px; white-space:nowrap;">
          <tr><th>类型</th><th>采购单号</th><th>货主代码</th><th>门店代码</th><th>仓位</th><th>到店日期</th><th>商品</th><th>品名</th><th>规格</th><th>箱数</th></tr>
          ${validOut.map(r => `<tr>
            <td>${r.bill_type}</td><td>${r.source_no || '-'}</td><td>${r.owner_code}</td><td>${r.store_code}</td>
            <td>${r.location_code}</td><td>${r.pick_date || '-'}</td>
            <td>${r.product_code}</td><td>${r.product_name||''}</td><td>${r.spec}</td><td>${r.quantity}</td>
          </tr>`).join('')}
        </table>`}
      </div>`
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

  let currentPage = 0
  const pageSize = 20
  let keyword = ''

  function renderAll() {
    const merged = {}
    ;(list || []).forEach(r => {
      const k = r.product_code
      if (!merged[k]) merged[k] = { ...r, warehouses: [r.warehouse_code] }
      else merged[k].warehouses.push(r.warehouse_code)
    })
    const mergedList = Object.values(merged)

    // ★ 前端搜索过滤
    const filteredList = mergedList.filter(r => {
      if (!keyword) return true
      const kw = keyword.toLowerCase()
      return (r.product_code || '').toLowerCase().includes(kw) || 
             (r.product_name || '').toLowerCase().includes(kw)
    })

    // ★ 统计不合格数量并显示顶部警告
    const invalidCount = filteredList.filter(r => isProductInvalid(r)).length
    let warningHtml = ''
    if (invalidCount > 0) {
      warningHtml = `
        <div style="background:#fff2f0; border:1px solid #ffccc7; border-radius:8px; padding:16px; margin-bottom:16px;">
          <h3 style="color:#cf1322; margin:0 0 8px 0;">⚠️ 您有 ${invalidCount} 个商品资料不完善</h3>
          <p style="color:#cf1322; font-size:13px; margin:0;">
            长宽高重量未填、规格不符或货号非纯数字的商品已被标红，<strong>在补充完整之前将无法用于填报</strong>。请尽快点击下方的「编辑」进行修改！
          </p>
        </div>
      `
    }

    // ★ 分页切片
    const totalPages = Math.ceil(filteredList.length / pageSize)
    const paginatedList = filteredList.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

    view.innerHTML = `
      ${warningHtml}
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
          <div><label>货号 *</label><input id="pd-code" /></div>
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
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">商品列表（${filteredList.length}）</h2>
          <div style="display:flex; gap:8px;">
            <input id="prod-search" placeholder="搜索货号/品名" style="width:240px; margin:0;" value="${keyword}" />
            <button class="secondary" id="btn-prod-search">查询</button>
          </div>
        </div>
        <div class="scroll">
          <table>
            <tr><th>货号</th><th>品名</th><th>规格</th><th>长×宽×高</th><th>重量</th><th>仓库</th><th>操作</th></tr>
            <tbody>
              ${paginatedList.map(r => {
                const invalid = isProductInvalid(r)
                const bgColor = invalid ? 'background:#fff1f0;' : ''
                return `<tr style="${bgColor}">
                  <td>${r.product_code||''} ${invalid ? '<span style="color:#cf1322;font-size:11px;">(资料不全)</span>' : ''}</td>
                  <td>${r.product_name||'<span style="color:#cf1322;">缺失</span>'}</td>
                  <td>${r.spec||'<span style="color:#cf1322;">缺失</span>'}</td>
                  <td>${r.length ?? '<span style="color:#cf1322;">0</span>'}×${r.width ?? '0'}×${r.height ?? '0'} cm</td>
                  <td>${r.weight ?? '<span style="color:#cf1322;">0</span>'} kg</td>
                  <td style="font-size:12px;">${r.warehouses.join(', ')}</td>
                  <td><button class="small ${invalid ? '' : 'secondary'}" data-edit="${r.product_code}">编辑</button></td>
                </tr>`
              }).join('') || '<tr><td colspan="7">无数据</td></tr>'}
            </tbody>
          </table>
        </div>
        <div id="prod-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;">
          <span style="font-size:13px;color:#666;">共 ${filteredList.length} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
          <button class="secondary small" id="btn-page-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
          <button class="secondary small" id="btn-page-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
        </div>
      </div>
      <div id="edit-product-panel"></div>`

    const vs = document.getElementById('prod-vendor-select')
    if (vs) {
      vs.onchange = async () => {
        selectedVendorCode = vs.value
        myWhs = await loadWhs(selectedVendorCode)
        list = await loadList(selectedVendorCode)
        currentPage = 0 // 切换厂商重置分页
        keyword = ''    // 清空搜索
        renderAll()
      }
    }

    // 绑定搜索
    document.getElementById('btn-prod-search').onclick = () => {
      keyword = document.getElementById('prod-search').value.trim()
      currentPage = 0
      renderAll()
    }
    document.getElementById('prod-search').onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('btn-prod-search').click()
    }

    // 绑定分页
    document.getElementById('btn-page-prev').onclick = () => {
      if (currentPage > 0) { currentPage--; renderAll(); }
    }
    document.getElementById('btn-page-next').onclick = () => {
      if (currentPage < totalPages - 1) { currentPage++; renderAll(); }
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

      if (!code || !name) return msgEl.innerHTML = msg('货号、品名为必填', false)
      if (!/^\d+$/.test(code)) return msgEl.innerHTML = msg('货号必须是纯数字，不能包含字母或空格', false)
      if (!spec) return msgEl.innerHTML = msg('包装规格为必填', false)
      if (!isValidSpec(spec)) return msgEl.innerHTML = msg('包装规格格式错误，必须是 1*1*X', false)
      if (!length || !width || !height || !weight) return msgEl.innerHTML = msg(SIZE_EMPTY_MSG, false)
      if (!isValidSize(length, width, height, weight)) return msgEl.innerHTML = msg('长、宽、高、重量必须为正数', false)
      if (!myWhs.length) return msgEl.innerHTML = msg('没有授权仓库，请联系管理员', false)

      for (const wh of myWhs) {
        const { data: exist } = await supabase.from('product_master').select('id').eq('warehouse_code', wh).eq('default_vendor_code', selectedVendorCode).eq('product_code', code).maybeSingle()
        if (exist) return msgEl.innerHTML = msg(`货号 ${code} 在仓库 ${wh} 下已存在`, false)
      }

      const rows = myWhs.map(wh => ({
        warehouse_code: wh, product_code: code, product_name: name, spec,
        length: Number(length), width: Number(width), height: Number(height), weight: Number(weight),
        default_vendor_code: selectedVendorCode, default_owner_code: selectedVendorCode
      }))

      const { error } = await supabase.from('product_master').insert(rows)
      if (error) return msgEl.innerHTML = msg(translateError(error.message), false)

      msgEl.innerHTML = msg(`新增成功（写入 ${rows.length} 个仓库）`, true)
      setTimeout(async () => { 
        list = await loadList(selectedVendorCode)
        currentPage = 0 // 新增后回到第一页
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

          if (!name) return msgEl.innerHTML = msg('品名为必填', false)
          if (!spec) return msgEl.innerHTML = msg('包装规格为必填', false)
          if (!isValidSpec(spec)) return msgEl.innerHTML = msg('包装规格格式错误，必须是 1*1*X', false)
          if (!length || !width || !height || !weight) return msgEl.innerHTML = msg(SIZE_EMPTY_MSG, false)
          if (!isValidSize(length, width, height, weight)) return msgEl.innerHTML = msg('长、宽、高、重量必须为正数', false)

          const patch = { product_name: name, spec, length: Number(length), width: Number(width), height: Number(height), weight: Number(weight) }
          const ids = recs.map(r => r.id)
          const { error } = await supabase.from('product_master').update(patch).in('id', ids)
          if (error) return msgEl.innerHTML = msg(translateError(error.message), false)

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
  let currentPage = 0;
  const pageSize = 20;
  let keyword = '';

  view.innerHTML = `
    <div class="card">
      <h2>${isLogistics ? '我负责厂商的单据' : '我的单据'}</h2>
      <div class="row" style="margin-bottom:12px; align-items:center;">
        <input id="my-search" placeholder="输入单号/商品代码/类型查询" style="flex:1; margin:0;" />
        <button id="btn-my-search" class="secondary" style="flex:0 0 80px;">查询</button>
      </div>
      <div id="my-msg"></div>
      <div class="scroll" style="max-height: 600px;">
        <table>
          <tr><th>ID</th><th>厂编</th><th>类型</th><th>商品</th><th>数量</th><th>仓库</th><th>已导出</th><th>时间</th><th>操作</th></tr>
          <tbody id="my-body"></tbody>
        </table>
      </div>
      <div id="my-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;"></div>
    </div>`;

  const loadData = async (page = 0) => {
    currentPage = page;
    const tbody = document.getElementById('my-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;">加载中...</td></tr>';

    let q = supabase.from('bill_order').select('*', { count: 'exact' });
    
    if (isLogistics) {
      const codes = myVendors.map(v => v.vendor_code);
      if (!codes.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#cf1322;">未配置负责厂商。</td></tr>';
        return;
      }
      q = q.in('vendor_code', codes);
    } else {
      q = q.eq('vendor_id', currentUser.id);
    }

    if (keyword) {
      q = q.or(`source_no.ilike.%${keyword}%,product_code.ilike.%${keyword}%,bill_type.ilike.%${keyword}%`);
    }

    const from = currentPage * pageSize;
    const to = from + pageSize - 1;
    q = q.order('id', { ascending: false }).range(from, to);

    const { data, error, count } = await q;

    if (error) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#cf1322;">查询失败：${error.message}</td></tr>`;
      return;
    }

    tbody.innerHTML = (data||[]).map(b => `<tr>
      <td>${b.id}</td><td>${b.vendor_code||''}</td><td>${b.bill_type}</td><td>${b.product_code}</td>
      <td>${b.quantity}</td><td>${b.warehouse_code}</td><td>${b.exported ? '是' : '否'}</td>
      <td>${new Date(b.created_at).toLocaleString()}</td>
      <td>
        ${b.exported 
          ? `<button class="small secondary" disabled style="opacity:0.5; cursor:not-allowed;">已导出</button>` 
          : `<button class="small danger" data-del="${b.id}">删除</button>`}
      </td>
    </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:#999;">暂无单据</td></tr>';

    const totalPages = Math.ceil((count || 0) / pageSize);
    const pageEl = document.getElementById('my-pagination');
    if (pageEl) {
      pageEl.innerHTML = `
        <span style="font-size:13px;color:#666;">共 ${count || 0} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
        <button class="secondary small" id="btn-my-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
        <button class="secondary small" id="btn-my-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
      `;
      document.getElementById('btn-my-prev').onclick = () => { if (currentPage > 0) loadData(currentPage - 1); };
      document.getElementById('btn-my-next').onclick = () => { if (currentPage < totalPages - 1) loadData(currentPage + 1); };
    }

    view.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.del);
        if (!confirm(`确定要删除单据 #${id} 吗？删除后无法恢复。`)) return;
        
        btn.disabled = true;
        btn.innerText = '删除中...';
        
        const { error } = await supabase.from('bill_order').delete().eq('id', id);
        
        if (error) {
          alert('删除失败：' + translateError(error.message));
          btn.disabled = false;
          btn.innerText = '删除';
          return;
        }
        
        alert('已删除');
        loadData(currentPage);
      };
    });
  };

  document.getElementById('btn-my-search').onclick = () => {
    keyword = document.getElementById('my-search').value.trim();
    loadData(0);
  };
  document.getElementById('my-search').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('btn-my-search').click();
  };

  loadData(0);
}

// ================= 质检报告 =================
async function renderQC(view) {
  // ★ 修复点 1：尝试获取上一次选中的厂编（如果存在的话）
  const prevSelect = document.getElementById('qc-vendor-select')?.value

  let mySelectedVendorId = null
  let mySelectedVendorCode = null
  let mySelectedVendorName = null

  // 1. 获取物流商负责的厂商详细数据（带 ID）
  if (isLogistics) {
    if (!myVendors.length) {
      view.innerHTML = `<div class="card"><h2>质检报告</h2><p style="color:#cf1322;">当前物流商未配置负责厂商，请联系管理员。</p></div>`
      return
    }
    const codes = myVendors.map(v => v.vendor_code)
    const { data: vps } = await supabase.from('vendor_profile').select('id, vendor_code, vendor_name').in('vendor_code', codes)
    
    // 重新绑定 myVendors 的 ID
    myVendors = myVendors.map(mv => {
      const match = (vps||[]).find(v => v.vendor_code === mv.vendor_code)
      return { ...mv, id: match?.id }
    }).filter(v => v.id)

    if (!myVendors.length) {
      view.innerHTML = `<div class="card"><h2>质检报告</h2><p style="color:#cf1322;">厂商档案异常，请联系管理员。</p></div>`
      return
    }
    
    // ★ 修复点 2：优先恢复上次选中的厂商，如果没有则取第一个
    const matchedVendor = myVendors.find(v => v.vendor_code === prevSelect) || myVendors[0]
    mySelectedVendorId = matchedVendor.id
    mySelectedVendorCode = matchedVendor.vendor_code
    mySelectedVendorName = matchedVendor.vendor_name
  } else {
    mySelectedVendorId = currentUser.id
    mySelectedVendorCode = currentProfile?.vendor_code || ''
    mySelectedVendorName = currentProfile?.vendor_name || ''
  }

  const loadReports = async () => {
    let q = supabase.from('qc_report').select('*').order('id', { ascending: false })
    if (isLogistics) {
      const codes = myVendors.map(v => v.vendor_code)
      q = q.in('vendor_code', codes)
    } else {
      q = q.eq('vendor_id', currentUser.id)
    }
    const { data } = await q
    return data || []
  }

  const reports = await loadReports()

  view.innerHTML = `
    <div class="card">
      <h2>上传质检报告</h2>
      
      ${isLogistics ? `
        <div class="row" style="margin-bottom:12px;">
          <div style="flex:1;">
            <label>选择代传厂商 *</label>
            <select id="qc-vendor-select">
              ${myVendors.map(v => `<option value="${v.vendor_code}" data-id="${v.id}" data-name="${v.vendor_name}" ${v.vendor_code === mySelectedVendorCode ? 'selected' : ''}>${v.vendor_code} - ${v.vendor_name}</option>`).join('')}
            </select>
          </div>
        </div>
      ` : ''}

      <div id="qc-msg"></div>
      
      <p style="font-size:13px;color:#666;margin-bottom:12px;">
        规则：1. 仅限 PDF 格式；2. 支持多选；3. 单次上传总大小不能超过 <strong>10MB</strong>。<br>
        <span style="color:#cf1322;">* 如果所选厂商今天已经传过，再次上传将自动覆盖该厂商今天之前上传的所有报告。</span>
      </p>
      <div class="row">
        <div style="flex:1;">
          <input type="file" id="qc-file" accept=".pdf,application/pdf" multiple />
        </div>
        <button id="btn-qc-upload" style="flex:0 0 100px; margin-top: 24px;">上传</button>
      </div>
    </div>
    <div class="card">
      <h2>已上传的报告（${reports.length}）</h2>
      <div class="scroll">
        <table>
          <tr><th>上传时间</th><th>厂编</th><th>归属厂商</th><th>文件名</th><th>操作</th></tr>
          ${reports.map(r => `<tr>
            <td>${new Date(new Date(r.created_at).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)}</td>
            <td>${r.vendor_code}</td>
            <td>${r.report_name.split('_')[1] || '-'}</td>
            <td>${r.report_name}</td>
            <td>
              <a href="${r.file_url}" target="_blank" class="small secondary" style="text-decoration:none; padding:4px 10px; border-radius:4px; margin-right:8px;">预览/下载</a>
              <button class="small danger" data-del-id="${r.id}" data-path="${r.file_path}">删除</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无数据</td></tr>'}
        </table>
      </div>
    </div>`

  // 监听厂商下拉切换（其实用不上了，因为上传时直接取，但保留以防万一）
  if (isLogistics) {
    const sel = document.getElementById('qc-vendor-select')
    sel.onchange = () => {
      const opt = sel.options[sel.selectedIndex]
      mySelectedVendorCode = opt.value
      mySelectedVendorId = opt.dataset.id
      mySelectedVendorName = opt.dataset.name
    }
  }

  document.getElementById('btn-qc-upload').onclick = async () => {
    const msgEl = document.getElementById('qc-msg')
    const fileInput = document.getElementById('qc-file')
    const files = Array.from(fileInput.files)

    if (files.length === 0) return msgEl.innerHTML = msg('请选择文件', false)

    let totalSize = 0
    for (const file of files) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        return msgEl.innerHTML = msg(`文件 [${file.name}] 不是 PDF 格式`, false)
      }
      totalSize += file.size
    }
    
    if (totalSize > 10 * 1024 * 1024) {
      return msgEl.innerHTML = msg(`本次上传总大小为 ${(totalSize/1024/1024).toFixed(2)}MB，超过了 10MB 限制`, false)
    }

    const btn = document.getElementById('btn-qc-upload')
    btn.disabled = true
    btn.innerText = '上传中...'
    msgEl.innerHTML = msg('正在处理...', true)

    try {
      // ★ 修复点 3：极度重要！在上传瞬间，直接从下拉框 DOM 获取最新选中的厂商，避免状态滞后
      let targetCode = mySelectedVendorCode
      let targetName = mySelectedVendorName
      let targetId = mySelectedVendorId

      if (isLogistics) {
        const sel = document.getElementById('qc-vendor-select')
        if (sel && sel.options[sel.selectedIndex]) {
          const opt = sel.options[sel.selectedIndex]
          targetCode = opt.value
          targetId = opt.dataset.id
          targetName = opt.dataset.name
        }
      }

      targetName = targetName.replace(/[\/\\:*?"<>|]/g, '')

      const fileInfos = files.map((file, index) => {
        const ext = file.name.split('.').pop()
        let customName = file.name.replace(/\.[^/.]+$/, "")
          .replace(/[\/\\:*?"<>|]/g, '')
          .replace(/ /g, '') 
          .replace(/（/g, '_').replace(/）/g, '_') 
        
        const timestamp = Date.now()
        const finalFileName = `qc/${targetCode}_${targetName}_${customName}_${timestamp}_${index}.${ext}`
        return { file, fileName: finalFileName, originalName: file.name }
      })

      // 1. 获取上传链接
      msgEl.innerHTML = msg('正在获取上传凭证...', true)
      const { data: { session } } = await supabase.auth.getSession()
      
      const res = await safeFetch(`/functions/v1/upload-qc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ fileNames: fileInfos.map(f => f.fileName) })
      })
      
      if (!res.ok) {
        const errText = await res.text()
        throw new Error('获取上传凭证失败: ' + errText)
      }
      const { urls } = await res.json()

      // 2. 并行上传 R2
      msgEl.innerHTML = msg(`正在上传 ${files.length} 个文件到云存储...`, true)
      await Promise.all(fileInfos.map(async (info, i) => {
        const uploadRes = await fetch(urls[i].uploadUrl, {
          method: 'PUT',
          body: info.file
        })
        if (!uploadRes.ok) throw new Error(`文件 [${info.originalName}] 上传失败`)
      }))

      // 3. 覆盖逻辑
      msgEl.innerHTML = msg('正在清理该厂商今日的旧报告...', true)
      const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).toISOString().slice(0, 10)
      const todayStartIso = new Date(todayStr + 'T00:00:00+08:00').toISOString()
      
      const { data: oldReports } = await supabase.from('qc_report')
        .select('id, file_path')
        .eq('vendor_id', targetId)  
        .gte('created_at', todayStartIso)

      if (oldReports && oldReports.length > 0) {
        await Promise.all(oldReports.map(async (old) => {
          try {
            await safeFetch(`/functions/v1/delete-qc`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({ filePath: old.file_path })
            })
          } catch (e) { console.error('删除旧文件失败', e) }
        }))
        await supabase.from('qc_report').delete().in('id', oldReports.map(r => r.id))
      }

      // 4. 写入新记录
      const dbRows = fileInfos.map((info, i) => {
        const safeOriginalName = info.originalName.replace(/[\/\\:*?"<>|]/g, '')
        const finalDisplayName = `${targetCode}_${targetName}_${safeOriginalName}`
        return {
          vendor_id: targetId,
          vendor_code: targetCode,
          report_name: finalDisplayName,
          file_path: info.fileName,
          file_url: urls[i].fileUrl,
          file_size: info.file.size
        }
      })

      const { error: dbErr } = await supabase.from('qc_report').insert(dbRows)
      if (dbErr) throw dbErr

      msgEl.innerHTML = msg('上传并覆盖成功', true)
      
      // ★ 修复点 4：刷新时把刚才上传的厂商编号传给渲染函数，让它保持选中状态
      setTimeout(() => {
        // 临时把选中的值存入 DOM 的 data 属性，或者在渲染时读取
        const tempSelect = document.getElementById('qc-vendor-select')
        if (tempSelect) tempSelect.value = targetCode 
        renderQC(view)
      }, 1000)

    } catch (err) {
      console.error(err)
      msgEl.innerHTML = msg(err.message || '上传失败', false)
      btn.disabled = false
      btn.innerText = '上传'
    }
  }

  view.querySelectorAll('[data-del-id]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.delId)
      const path = btn.dataset.path
      if (!confirm('确定要删除这份质检报告吗？')) return

      btn.disabled = true
      btn.innerText = '删除中...'

      try {
        const { data: { session } } = await supabase.auth.getSession()
        
        const res = await safeFetch(`/functions/v1/delete-qc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ filePath: path })
        })
        
        if (!res.ok) throw new Error('R2 文件删除失败')

        const { error, count } = await supabase.from('qc_report').delete({ count: 'exact' }).eq('id', id)
        
        if (error) throw error
        if (count === 0) throw new Error('权限不足，未能删除该记录，请联系管理员')

        alert('删除成功')
        
        const tr = btn.closest('tr')
        if (tr) {
          tr.remove()
          const tbody = tr.parentElement
          if (tbody && tbody.children.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;">暂无数据</td></tr>'
          }
        }

      } catch (err) {
        alert('删除失败：' + err.message)
        btn.disabled = false
        btn.innerText = '删除'
      }
    }
  })
}

// ================= 公告强弹窗逻辑 =================
async function checkAnnouncements() {
  try {
    // 1. 查生效中的公告
    const { data: anns } = await supabase.from('announcement')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    
    if (!anns || !anns.length) return

    // 2. 查我读过的公告
    const { data: reads } = await supabase.from('announcement_read')
      .select('announcement_id')
      .eq('user_id', currentUser.id)
      
    const readIds = new Set((reads || []).map(r => r.announcement_id))
    const unreadAnns = anns.filter(a => !readIds.has(a.id))

    if (!unreadAnns.length) return

    // 3. 依次弹窗
    for (const ann of unreadAnns) {
      await showAnnouncementModal(ann)
    }
  } catch (e) {
    console.error('检查公告失败', e)
  }
}

function showAnnouncementModal(ann) {
  return new Promise((resolve) => {
    const modal = document.createElement('div')
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;'
    
    modal.innerHTML = `
      <div style="background:#fff;border-radius:8px;max-width:500px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.2);display:flex;flex-direction:column;overflow:hidden;">
        <div style="background:#1677ff;color:#fff;padding:16px 20px;">
          <h2 style="margin:0;font-size:18px;color:#fff;">📢 系统公告</h2>
        </div>
        <div style="padding:24px;max-height:50vh;overflow-y:auto;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">${ann.content}</div>
        <div style="padding:16px 20px;border-top:1px solid #eee;text-align:right;background:#fafafa;">
          <button id="btn-ann-read" style="background:#1677ff;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:14px;">我已知晓</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    document.getElementById('btn-ann-read').onclick = async () => {
      const btn = document.getElementById('btn-ann-read')
      btn.disabled = true
      btn.innerText = '提交中...'

      try {
        // 1. 写入已读记录
        const { error: readErr } = await supabase.from('announcement_read').insert({
          announcement_id: ann.id,
          user_id: currentUser.id,
          vendor_code: currentProfile?.vendor_code || ''
        })

        if (readErr) throw new Error('记录已读失败: ' + readErr.message)

        // 2. 同步到厂商修改记录 (bill_id = 0)
        const { error: logErr } = await supabase.from('vendor_edit_log').insert({
          bill_id: 0,
          vendor_code: currentProfile?.vendor_code || '',
          changed_fields: ['阅读公告'],
          before_data: null,
          after_data: { '公告标题': ann.title, '阅读时间': new Date().toLocaleString() }
        })
        
        if (logErr) console.warn('写入日志失败，但不影响已读状态', logErr)

      } catch (e) {
        console.error(e)
        alert('网络异常，保存已读状态失败，请刷新后重试！')
        btn.disabled = false
        btn.innerText = '我已知晓'
        return // ★ 发生错误时不关闭弹窗，让用户重试
      }

      // 成功才关闭弹窗
      modal.remove()
      resolve()
    }
  })
}

// ================= 「我的对账」（厂商 + 物流商共用） =================
async function renderBilling(view) {
  const isLg = isLogistics
  let vendorCodes = [], vendorNameMap = {}

  if (isLg) {
    if (!myVendors || !myVendors.length) return view.innerHTML = `<div class="card"><h2>我的对账</h2><p style="color:#cf1322;">当前物流商未配置负责厂商，请联系管理员。</p></div>`
    vendorCodes = myVendors.map(v => v.vendor_code)
    myVendors.forEach(v => { vendorNameMap[v.vendor_code] = v.vendor_name || '' })
  } else {
    const vc = currentProfile?.vendor_code || ''
    if (!vc) return view.innerHTML = `<div class="card"><h2>我的对账</h2><p style="color:#cf1322;">未找到当前账号对应的厂编，请联系管理员。</p></div>`
    vendorCodes = [vc]
    vendorNameMap[vc] = currentProfile?.vendor_name || ''
  }

  const { data: bills, error } = await supabase.from('vendor_billings').select('*').in('vendor_code', vendorCodes).order('bill_month', { ascending: false }).order('warehouse_code', { ascending: true })
  if (error) return view.innerHTML = `<div class="card"><h2>我的对账</h2>${msg(translateError(error.message), false)}</div>`
  if (!bills || bills.length === 0) return view.innerHTML = '<div class="card"><h2>我的对账</h2><p style="color:#999;">暂无对账数据</p></div>'

  const { data: cfg } = await supabase.from('system_config').select('config_value').eq('config_key', 'billing_rates_config').maybeSingle()
  let currentCfg = {
    rates: { dsp_east: 10, dsp_west: 15, dsp_nm: 15, transit: 7, storage: 3.5, operation: 1.5, unloading: 0.3 },
    taxes: { transport: 0.09, storage: 0.06, unloading: 0.06 }
  }
  if (cfg?.config_value) { try { currentCfg = JSON.parse(cfg.config_value) } catch(e) {} }

  const codesWithBills = [...new Set(bills.map(b => b.vendor_code))]
  let currentVendor = isLg ? codesWithBills[0] : vendorCodes[0]
  let currentWh = null
  let currentMonth = null

  const renderUI = () => {
    const vendorBills = bills.filter(b => b.vendor_code === currentVendor)
    const warehouses = [...new Set(vendorBills.map(b => b.warehouse_code))]
    if (!currentWh || !warehouses.includes(currentWh)) currentWh = warehouses[0]

    const monthBills = vendorBills.filter(b => b.warehouse_code === currentWh)
    const months = [...new Set(monthBills.map(b => b.bill_month))].sort().reverse()
    if (!currentMonth || !months.includes(currentMonth)) currentMonth = months[0]

    const currentBill = monthBills.find(b => b.bill_month === currentMonth) || monthBills[0]
    const canConfirm = currentBill?.status === 'pending'

    const rates = currentCfg.rates
    const taxes = currentCfg.taxes
    const details = []
    
    const addDetail = (category, item, qty, rate, unit, taxRate, qtyUnit = unit) => {
      const q = Number(qty) || 0
      const untaxed = q * rate
      const tax = untaxed * taxRate
      details.push({ category, item, qty: q, rate, unit, qtyUnit, untaxed, tax, total: untaxed + tax, taxRate })
    }

    const sData = currentBill.summary_data || {}
    addDetail('运输', 'DSP省内(中/东区)', sData.dsp_east, rates.dsp_east, '箱', taxes.transport)
    addDetail('运输', 'DSP省外(西/西南)', sData.dsp_west, rates.dsp_west, '箱', taxes.transport)
    addDetail('运输', 'DSP省外(内蒙古)', sData.dsp_nm, rates.dsp_nm, '箱', taxes.transport)
    addDetail('运输', '干线代送', sData.transit, rates.transit, '箱', taxes.transport)
    addDetail('储存', '仓储费', sData.storage, rates.storage, '板/天', taxes.storage, '板')
    addDetail('储存', '操作费', sData.operation, rates.operation, '箱', taxes.storage)
    addDetail('装卸', '装卸费', sData.unloading, rates.unloading, '箱', taxes.unloading)

    const calcTotalTaxed = details.reduce((sum, d) => sum + d.total, 0)
    const displayTotal = Number(currentBill.total_amount_tax) > 0 ? Number(currentBill.total_amount_tax) : calcTotalTaxed

    view.innerHTML = `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
          <h2 style="margin:0;">我的对账单</h2>
          <div style="display:flex; gap:12px;">
            ${isLg && codesWithBills.length > 1 ? `
              <select id="bill-vendor-select" style="padding:6px; border-radius:4px; border:1px solid #d9d9d9;">
                ${codesWithBills.map(code => `<option value="${code}" ${code===currentVendor?'selected':''}>${code} - ${vendorNameMap[code]}</option>`).join('')}
              </select>
            ` : ''}
            ${warehouses.length > 1 ? `
              <select id="bill-wh-select" style="padding:6px; border-radius:4px; border:1px solid #d9d9d9;">
                ${warehouses.map(w => `<option value="${w}" ${w===currentWh?'selected':''}>${w}</option>`).join('')}
              </select>
            ` : `<span style="padding:6px; font-weight:bold; color:#666;">${currentWh}</span>`}
            ${months.length > 1 ? `
              <select id="bill-month-select" style="padding:6px; border-radius:4px; border:1px solid #d9d9d9;">
                ${months.map(m => `<option value="${m}" ${m===currentMonth?'selected':''}>${m}</option>`).join('')}
              </select>
            ` : `<span style="padding:6px; font-weight:bold; color:#666;">${currentMonth}</span>`}
          </div>
        </div>

        <div style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;">
          <div style="flex:1; background:#f8f9fa; padding:16px; border-radius:8px; border:1px solid #eee;">
            <div style="font-size:13px; color:#666; margin-bottom:8px;">结算周期</div>
            <div style="font-size:16px; font-weight:bold;">${currentBill.bill_month} 月账单</div>
          </div>
          <div style="flex:1; background:#f8f9fa; padding:16px; border-radius:8px; border:1px solid #eee;">
            <div style="font-size:13px; color:#666; margin-bottom:8px;">仓库</div>
            <div style="font-size:16px; font-weight:bold;">${currentBill.warehouse_code}</div>
          </div>
          <div style="flex:1; background:#f8f9fa; padding:16px; border-radius:8px; border:1px solid #eee;">
            <div style="font-size:13px; color:#666; margin-bottom:8px;">含税总金额</div>
            <div style="font-size:24px; font-weight:bold; color:#cf1322;">¥ ${displayTotal.toFixed(2)}</div>
          </div>
          <div style="flex:1; background:${currentBill.status === 'confirmed' ? '#f6ffed' : '#fff1f0'}; padding:16px; border-radius:8px; border:1px solid ${currentBill.status === 'confirmed' ? '#b7eb8f' : '#ffccc7'};">
            <div style="font-size:13px; color:#666; margin-bottom:8px;">状态</div>
            <div style="font-size:16px; font-weight:bold; color:${currentBill.status === 'confirmed' ? '#389e0d' : '#cf1322'};">
              ${currentBill.status === 'confirmed' ? '✅ 已确认' : '⏳ 待确认'}
            </div>
          </div>
        </div>

        <h3 style="font-size:16px; margin-bottom:12px;">费用明细</h3>
        <table style="margin-bottom:24px;">
          <thead style="background:#fafafa;">
            <tr><th>大类</th><th>项目</th><th>发生量</th><th>计费标准</th><th>税率</th><th style="text-align:right;">未税金额</th><th style="text-align:right;">税额</th><th style="text-align:right;">含税小计</th></tr>
          </thead>
          <tbody>
            ${details.map(d => `<tr>
              <td>${d.category}</td><td>${d.item}</td>
              <td style="${d.qty === 0 ? 'color:#999;' : ''}">${d.qty} ${d.qtyUnit}</td>
              <td>${d.rate} 元/${d.unit}</td><td>${(d.taxRate * 100).toFixed(0)}%</td>
              <td style="text-align:right;">${d.untaxed.toFixed(2)}</td><td style="text-align:right;">${d.tax.toFixed(2)}</td>
              <td style="text-align:right; color:#cf1322; font-weight:bold;">${d.total.toFixed(2)}</td>
            </tr>`).join('')}
          </tbody>
        </table>

        <div style="text-align:right; margin-top:20px; display:flex; justify-content:flex-end; gap:12px;">
          <button class="secondary" onclick="downloadBillExcel()">📥 下载完整对账单</button>
          ${canConfirm ? `<button style="background:#52c41a; color:#fff;" onclick="confirmBill(${currentBill.id})">✅ 确认账单无误</button>` : ''}
        </div>
      </div>
    `

    const selV = document.getElementById('bill-vendor-select')
    if (selV) selV.onchange = (e) => { currentVendor = e.target.value; currentWh = null; currentMonth = null; renderUI() }
    const selW = document.getElementById('bill-wh-select')
    if (selW) selW.onchange = (e) => { currentWh = e.target.value; currentMonth = null; renderUI() }
    const selM = document.getElementById('bill-month-select')
    if (selM) selM.onchange = (e) => { currentMonth = e.target.value; renderUI() }

    window.confirmBill = async (id) => {
      if (!confirm('确认本月账单金额及明细无误吗？')) return
      const { error, count } = await supabase.from('vendor_billings').update({ status: 'confirmed' }).eq('id', id).select('id', { count: 'exact' })
      if (error) return alert('确认失败：' + translateError(error.message))
      if (count === 0) return alert('确认失败：权限不足或记录不存在')
      alert('已确认！财务将收到您的确认状态。'); renderBilling(view)
    }

    // 🌟 前端完美复刻结算单模板及全量明细
    window.downloadBillExcel = () => {
      const wb = XLSX.utils.book_new()
      
      const dspEastQty = details.find(d => d.item.includes('DSP省内'))?.qty || 0
      const dspWestQty = details.find(d => d.item.includes('DSP省外(西/西南)'))?.qty || 0
      const dspNmQty = details.find(d => d.item.includes('DSP省外(内蒙古)'))?.qty || 0
      const transitQty = details.find(d => d.item.includes('干线代送'))?.qty || 0
      const storageQty = details.find(d => d.item === '仓储费')?.qty || 0
      const operationQty = details.find(d => d.item === '操作费')?.qty || 0
      const unloadingQty = details.find(d => d.item === '装卸费')?.qty || 0

      const dspEastUntax = dspEastQty * rates.dsp_east
      const dspWestUntax = dspWestQty * rates.dsp_west
      const dspNmUntax = dspNmQty * rates.dsp_nm
      const transitUntax = transitQty * rates.transit
      const transportUntax = dspEastUntax + dspWestUntax + dspNmUntax + transitUntax

      const storageUntax = storageQty * rates.storage
      const operationUntax = operationQty * rates.operation
      const storageTotalUntax = storageUntax + operationUntax

      const unloadingUntax = unloadingQty * rates.unloading

      const totalUntaxed = transportUntax + storageTotalUntax + unloadingUntax
      const transportTax = transportUntax * taxes.transport
      const storageTax = storageTotalUntax * taxes.storage
      const unloadingTax = unloadingUntax * taxes.unloading
      const totalTax = transportTax + storageTax + unloadingTax
      const totalTaxed = totalUntaxed + totalTax

      const aoa = [
        ['厂编/厂名', currentVendor, vendorNameMap[currentVendor], '', '', '', `应收账款确认单 (${currentBill.warehouse_code})`, '', ''],
        ['大润发开户行：', '', '', '', '', '大润发账号：', '', '', ''],
        ['结算日期：', `${currentBill.bill_month}`, '', '', '', '制表人：', '', '', ''],
        [], 
        ['', '运费', '', '', '', '', '', '', ''], 
        ['名称', '', '仓别', '计费科目', '单位', '计费标准', '发生量', '计费量', '未税费用'],
        ['运输', 'DSP省内', '中区、东区', '配送费', '元/箱', rates.dsp_east, dspEastQty || '-', dspEastQty || '-', dspEastUntax || '-'],
        ['', 'DSP省外', '西区、西南区', '配送费', '元/箱', rates.dsp_west, dspWestQty || '-', dspWestQty || '-', dspWestUntax || '-'],
        ['', 'DSP省外', '内蒙古', '配送费', '元/箱', rates.dsp_nm, dspNmQty || '-', dspNmQty || '-', dspNmUntax || '-'],
        ['', '退货', '退货', '配送费', '元/箱', 10, '-', '-', '-'],
        ['', '赠品', '赠品代送', '配送费', '元/箱', 10, '-', '-', '-'],
        ['', '干线代送', '济南仓至西安仓', '配送费', '元/箱', rates.transit, transitQty || '-', transitQty || '-', transitUntax || '-'],
        ['小计', '', '', '运费', '', '', '', '', transportUntax || '-'],
        
        ['', '储存', '', '', '', '', '', '', ''],
        ['名称', '', '仓别', '计费科目', '单位', '计费标准', '发生量', '计费量', '费用'],
        ['增值', '存储费', '济南冻仓', '仓储费', '元/板/天', rates.storage, storageQty || '-', storageQty || '-', storageUntax || '-'],
        ['增值', '操作费', '济南冻仓', '操作费', '元/箱', rates.operation, operationQty || '-', operationQty || '-', operationUntax || '-'],
        ['退货', '存储费', '济南冻仓', '退货仓储费', '元/板/天', 3.5, '-', '-', '-'],
        ['小计', '', '', '仓储费', '', '', '', '', storageTotalUntax || '-'],

        ['', '装卸', '', '', '', '', '', '', ''],
        ['名称', '', '仓别', '计费科目', '单位', '计费标准', '发生量', '计费量', '费用'],
        ['增值', '', '济南冻仓', '装卸', '装卸费用：箱/元', rates.unloading, unloadingQty || '-', unloadingQty || '-', unloadingUntax || '-'],
        ['小计', '', '', '增值', '', '', '', '', unloadingUntax || '-'],
        
        [],
        ['发票注意事项：', '备注', '', '', '', '', '', '', ''],
        ['分类', '', '税额', '未税', '税额', '含税', '', '', ''],
        ['运费', '', taxes.transport, transportUntax || '-', transportTax || '-', (transportUntax + transportTax) || '-', '', '确认人：', ''],
        ['储存', '', taxes.storage, storageTotalUntax || '-', storageTax || '-', (storageTotalUntax + storageTax) || '-', '', '审核人：', ''],
        ['装卸', '', taxes.unloading, unloadingUntax || '-', unloadingTax || '-', (unloadingUntax + unloadingTax) || '-', '', '', ''],
        ['合计', '', '', totalUntaxed || '-', totalTax || '-', totalTaxed || '-', '', '', '']
      ]

      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const range = XLSX.utils.decode_range(ws['!ref'])
      
      const borderStyle = { top: { style: "thin", color: { rgb: "000000" } }, bottom: { style: "thin", color: { rgb: "000000" } }, left: { style: "thin", color: { rgb: "000000" } }, right: { style: "thin", color: { rgb: "000000" } } }
      const bStyle = { font: { bold: true }, border: borderStyle }
      const centerStyle = { alignment: { horizontal: 'center', vertical: 'center' }, border: borderStyle }
      const leftStyle = { alignment: { horizontal: 'left', vertical: 'center' }, border: borderStyle }
      const rightStyle = { alignment: { horizontal: 'right', vertical: 'center' }, border: borderStyle }
      const boldRight = { font: { bold: true }, alignment: { horizontal: 'right', vertical: 'center' }, border: borderStyle }
      
      const titleStyle = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center', vertical: 'center' } }
      const yellowBg = { fill: { fgColor: { rgb: "FFC000" } }, font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center' }, border: borderStyle }
      const greyBg = { fill: { fgColor: { rgb: "EFEFEF" } }, font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center' }, border: borderStyle }
      
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellRef = XLSX.utils.encode_cell({ c: C, r: R })
          if (!ws[cellRef]) continue
          
          if (R === 0) { ws[cellRef].s = { font: { sz: 12 } }; continue; }
          if (R === 4 || R === 13 || R === 19) { ws[cellRef].s = yellowBg; continue; }
          if (R === 5 || R === 14 || R === 20 || R === 25) { ws[cellRef].s = greyBg; continue; }
          
          if (R === 12 || R === 18 || R === 22) {
            ws[cellRef].s = (C >= 6) ? boldRight : bStyle
            continue
          }
          
          if (R === 29) {
            ws[cellRef].s = (C >= 3) ? boldRight : bStyle
            continue
          }

          if (R > 5 && R < 24 && R !== 12 && R !== 18 && R !== 13 && R !== 19) {
             if (C >= 5) ws[cellRef].s = rightStyle
             else ws[cellRef].s = centerStyle
          } else {
             ws[cellRef].s = leftStyle
          }
        }
      }

      ws['A1'].s = { font: { bold: true } }
      ws['G1'].s = titleStyle

      ws['!merges'] = [
        { s: { r: 0, c: 6 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } }, { s: { r: 1, c: 6 }, e: { r: 1, c: 8 } },
        { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } }, { s: { r: 2, c: 6 }, e: { r: 2, c: 8 } }, { s: { r: 4, c: 1 }, e: { r: 4, c: 8 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } }, { s: { r: 6, c: 0 }, e: { r: 11, c: 0 } }, { s: { r: 12, c: 0 }, e: { r: 12, c: 2 } }, { s: { r: 12, c: 3 }, e: { r: 12, c: 7 } },
        { s: { r: 13, c: 1 }, e: { r: 13, c: 8 } }, { s: { r: 14, c: 0 }, e: { r: 14, c: 1 } }, { s: { r: 18, c: 0 }, e: { r: 18, c: 2 } }, { s: { r: 18, c: 3 }, e: { r: 18, c: 7 } },
        { s: { r: 19, c: 1 }, e: { r: 19, c: 8 } }, { s: { r: 20, c: 0 }, e: { r: 20, c: 1 } }, { s: { r: 22, c: 0 }, e: { r: 22, c: 2 } }, { s: { r: 22, c: 3 }, e: { r: 22, c: 7 } },
        { s: { r: 24, c: 2 }, e: { r: 24, c: 8 } }, { s: { r: 25, c: 1 }, e: { r: 25, c: 1 } }, { s: { r: 26, c: 6 }, e: { r: 28, c: 6 } }, { s: { r: 26, c: 7 }, e: { r: 28, c: 8 } }
      ]

      ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }]
      XLSX.utils.book_append_sheet(wb, ws, '结算单')

      const applyStyleToDetail = (wsDetail, headerRowCount) => {
        if (!wsDetail || !wsDetail['!ref']) return
        const dr = XLSX.utils.decode_range(wsDetail['!ref'])
        const sHeader = { font: { bold: true }, fill: { fgColor: { rgb: "EFEFEF" } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borderStyle }
        const sText = { alignment: { vertical: 'center' }, border: borderStyle }
        const sNum = { alignment: { horizontal: 'right', vertical: 'center' }, border: borderStyle }

        for (let R = dr.s.r; R <= dr.e.r; ++R) {
          for (let C = dr.s.c; C <= dr.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ c: C, r: R })
            if (!wsDetail[cellRef]) continue
            if (R < headerRowCount) wsDetail[cellRef].s = sHeader
            else wsDetail[cellRef].s = (typeof wsDetail[cellRef].v === 'number') ? sNum : sText
          }
        }
      }

      const addDetailSheet = (sheetName, dataObj, defaultHeaders) => {
        let sheetData = []
        if (dataObj && dataObj.headers && dataObj.headers.length > 0) {
          sheetData = [...dataObj.headers]
          if (dataObj.rows && dataObj.rows.length > 0) sheetData = sheetData.concat(dataObj.rows)
        } else {
          sheetData = [defaultHeaders]
        }
        
        const wsDetail = XLSX.utils.aoa_to_sheet(sheetData)
        const colWidths = []
        sheetData.forEach(row => {
          if (!row) return
          row.forEach((cell, i) => {
            const val = String(cell || '')
            const len = val.replace(/[^\x00-\xff]/g, 'xx').length 
            colWidths[i] = Math.max(colWidths[i] || 10, len + 2)
          })
        })
        wsDetail['!cols'] = colWidths.map(w => ({ wch: Math.min(w, 50) })) 
        const headerCount = (dataObj && dataObj.headers) ? dataObj.headers.length : 1
        applyStyleToDetail(wsDetail, headerCount)
        XLSX.utils.book_append_sheet(wb, wsDetail, sheetName)
      }

      const HEADERS = {
        unloading: ['项目', '细项', '状态', '单号', '日期', '厂商编码', '厂商名称', '店编码', '店别', '商品编码', '商品名称', '规格', '单位', '件数', '数量'],
        operation: ['序号', '单号', '领用类型', '行号', '单头备注', '领用日期', '商品代码', '商品名称', '包装规格', '单位', '货位', '容器', '件数', '数量', '生产日期', '批次', '供应商', '厂商名称', '仓位', '货主', '领用对象', '领用人', '状态'],
        storage: ['序号', '日期', '仓位', '货位', '货位用途', '温层', '容器条码', '商品代码', '商品名称', '包装规格', '库存状态', '单位', '库存件数', '库存数量', '生产日期', '批号', '到效期', '批次', '入库时间', '来源单号', '所属供应商', '厂商名称', '所属对象', '所属货主'],
        transit: ['序号', '收货单号', '订单号', '订单来源单号', '订单类型', '整单加工', '订单备注', '收货单状态', '收货人', '仓位', '商品代码', '商品名称', '包装规格', '结算单位', '单位', '收货件数', '收货数量', '金额', '容器', '收货时间', '生产日期', '到效期', '保质期', '上传时间', '供应商', '厂商名称', '卸货方式', '课别', '温层', '总重(kg)'],
        dsp: ['序号', '收货单号', '订单号', '订单来源单号', '店号', '区域', '订单类型', '整单加工', '订单备注', '收货单状态', '收货人', '仓位', '商品代码', '商品名称', '包装规格', '单位', '收货件数', '收货数量', '金额', '容器', '收货时间', '生产日期', '到效期', '保质期', '上传时间', '供应商', '厂商名称', '卸货方式', '课别', '总重(kg)'],
        gift: ['类别', '到货时间', '门店号', '要货方', '厂编', '厂商名称', '件数', '备注'],
        return: ['录单时间', '退货单时间', 'NT订单号', '货号', '商品', '规格', '店号', '店名', '厂编', '厂商', '退货数量（个）', '退货数量（个）2', '差异数量', '件数', '存储板数', '天数', '收费天数>7天', '收费板数', '通知厂商取退货时间', '提货日期', '存储库位', '备注']
      }

      const dData = currentBill.details_data || {}
      addDetailSheet('装卸', dData.unloading, HEADERS.unloading)
      addDetailSheet('操作费', dData.operation, HEADERS.operation)
      addDetailSheet('储存清单', dData.storage, HEADERS.storage)
      addDetailSheet('西安干线', dData.transit, HEADERS.transit)
      addDetailSheet('DSP', dData.dsp, HEADERS.dsp)
      addDetailSheet('赠品&专柜', dData.gift, HEADERS.gift)
      addDetailSheet('退货', dData.return, HEADERS.return)

      XLSX.writeFile(wb, `${currentVendor}_${vendorNameMap[currentVendor]}_${currentBill.bill_month}_对账单.xlsx`)
    }
  }

  renderUI()
}

// 启动系统
init()