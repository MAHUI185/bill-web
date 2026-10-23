// app.js — 主逻辑（2026-10-23 终极完整版：代报搜索联想、济转西双向、强制留库/越库、极速粘贴）

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

function msg(text, ok = true) {
  return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>`
}

// ========== 商品规格与尺寸校验工具 ==========

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

async function init() {
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
    if (!session) return renderLogin()
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
  isAdmin = !!admin
  currentRole = admin?.role || null
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
  // ★ 管理员导航栏加上“管理填报”
  const tabs = isAdmin 
    ? [['fill','管理填报'], ['admin','管理后台']] 
    : [['fill','填报'],['my','我的单据'],['products','商品资料'],['qc','质检报告']]
  
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

function calcOutFields(billType, supplierInput, defaultStore) {
  if (billType === 'VMI出库' || billType === '留库出') {
    return { owner_code: supplierInput, store_code: defaultStore || '' }
  }
  if (billType === 'DSP出库' || billType === '越库出') {
    return { owner_code: '8888', store_code: '' }
  }
  if (billType === '济转西RT(留库)') {
    return { owner_code: supplierInput, store_code: '8205RT' }
  }
  if (billType === '济转西RT(越库)') {
    return { owner_code: '8888', store_code: '8205RT' }
  }
  if (billType === '济转西DSP(留库)') {
    return { owner_code: supplierInput, store_code: '8205DSP' }
  }
  if (billType === '济转西DSP(越库)') {
    return { owner_code: '8888', store_code: '8205DSP' }
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
  let isAdminDelegate = isAdmin // ★ 管理员代报标记

  if (isAdminDelegate) {
    // 管理员代报：拉取所有厂商
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

  let myWhs = []
  if (isAdminDelegate) {
    const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', myVendorCode).maybeSingle()
    if (vp) {
      const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vp.id)
      myWhs = (vw||[]).map(x => x.warehouse_code)
    }
  } else if (isLogistics) {
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

  const { range } = await loadDeadlineRange(myVendorCode, myWhs[0] || null)

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
              <!-- 使用 input 替代 select，支持搜索 -->
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
                <th>箱数</th><th>到货日期</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="in-body"></tbody>
          </table>
        </div>
        <button class="secondary small" id="btn-add-in" style="margin-top:8px;">+ 添加入库行</button>

        <h3 style="margin:24px 0 8px;">出库单</h3>
        <p style="font-size:12px;color:#d46b08;margin-bottom:8px;">注意：预约「DSP出库」前，必须已经预约过同货主、同商品的「DSP入库」单据。</p>
        
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
                <th>仓位</th><th>配货日期</th>
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

      // 1. 搜索联想逻辑
      searchInput.oninput = () => {
        const kw = searchInput.value.trim().toLowerCase()
        if (!kw) { suggestBox.style.display = 'none'; return }

        // 过滤出包含厂编或名称的结果，最多 10 条
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

        // 2. 点击联想项
        suggestBox.querySelectorAll('[data-pick]').forEach(el => {
          el.onmousedown = async (e) => {
            e.preventDefault()
            const vc = el.dataset.pick
            
            // 如果选的是当前厂商，不处理
            if (vc === myVendorCode) {
              searchInput.value = vc
              suggestBox.style.display = 'none'
              return
            }

            // 检查是否有填了一半的数据，避免误触丢失
            const hasData = inRows.some(isInRowFilled) || outRows.some(isOutRowFilled)
            if (hasData && !confirm('切换厂商会清空当前已填写的内容，确定切换吗？')) {
              searchInput.value = myVendorCode // 恢复原值
              suggestBox.style.display = 'none'
              return
            }

            // 执行切换逻辑
            selectedVendor = myVendors.find(v => v.vendor_code === vc)
            myVendorCode = vc
            searchInput.value = vc
            suggestBox.style.display = 'none'

            // 重新加载该厂商的商品和仓库
            productList = await loadProducts(vc)
            
            const { data: vp } = await supabase.from('vendor_profile').select('id').eq('vendor_code', vc).maybeSingle()
            if (vp) {
              const { data: vw } = await supabase.from('vendor_warehouse').select('warehouse_code').eq('vendor_id', vp.id)
              myWhs = (vw||[]).map(x => x.warehouse_code)
              if (myWhs.length) {
                const { data: whInfo } = await supabase.from('warehouse').select('default_store_code').eq('warehouse_code', myWhs[0]).maybeSingle()
                defaultStoreCode = whInfo?.default_store_code || ''
              } else {
                defaultStoreCode = ''
              }
            }
            
            // 清空表格并重绘
            inRows = [newInRowForVendor(vc)]
            outRows = [newOutRowForVendor(vc)]
            render()
          }
        })
      }

      // 3. 失去焦点时隐藏联想框
      searchInput.onblur = () => {
        setTimeout(() => { suggestBox.style.display = 'none' }, 200)
      }
    }

    const btnAddIn = document.getElementById('btn-add-in')
    if (btnAddIn) btnAddIn.onclick = () => { inRows.push(newInRowForVendor(myVendorCode)); renderInTable(); renderPreview() }

    const btnAddOut = document.getElementById('btn-add-out')
    if (btnAddOut) btnAddOut.onclick = () => { outRows.push(newOutRowForVendor(myVendorCode)); renderOutTable(); renderPreview() }

    // ★ 入库解析粘贴内容
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

        if (isNaN(boxQty) || boxQty <= 0) { errorMsgs.push(`第 ${i+1} 行：箱数 [${boxQtyStr}] 必须是大于 0 的数字`); continue }

        const p = findProduct(product_code)
        if (!p) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 在商品库不存在`); continue }
        if (!isValidSpec(p.spec)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 规格 [${p.spec}] 不合规`); continue }

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

    // ★ 出库解析粘贴内容（支持 3列 VMI / 4列 DSP）
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

        const source_no = cols[0]
        const product_code = cols[1]
        const boxQtyStr = cols[2]
        const boxQty = Number(boxQtyStr)

        if (!/^\d{9}$/.test(source_no)) { errorMsgs.push(`第 ${i+1} 行：单号 [${source_no}] 格式错误，必须9位数字`); continue }
        if (isNaN(boxQty) || boxQty <= 0) { errorMsgs.push(`第 ${i+1} 行：箱数 [${boxQtyStr}] 错误`); continue }

        const p = findProduct(product_code)
        if (!p) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 不存在`); continue }
        if (!isValidSpec(p.spec)) { errorMsgs.push(`第 ${i+1} 行：货号 [${product_code}] 规格不合规`); continue }

        // 判定 VMI 还是 DSP
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

        const key = `${source_no}_${product_code}_${billType}_${storeCode}`
        if (parsedMap.has(key)) {
          parsedMap.get(key).quantity += boxQty
        } else {
          parsedMap.set(key, {
            source_no, product_code, product_name: p.product_name, spec: p.spec, quantity: boxQty, billType, storeCode
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
        if (!r.arrival_date) missing.push('到货日期')
        if (missing.length) errors.push(`入库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      })

      outRows.forEach((r, idx) => {
        if (!isOutRowFilled(r)) return
        const missing = []
        if ((r.bill_type === 'VMI出库' || r.bill_type === '留库出' || r.bill_type === '越库出') && !r.source_no) missing.push('采购单号')
        if (!r.location_code) missing.push('仓位')
        if (!r.product_code) missing.push('商品代码')
        if (!r.spec) errors.push(`出库单 第 ${idx+1} 行：商品 [${r.product_code}] ${SPEC_EMPTY_MSG}`)
        else if (!isValidSpec(r.spec)) errors.push(`出库单 第 ${idx+1} 行：商品 [${r.product_code}] 规格格式错误`)
        if (!r.quantity) missing.push('箱数')
        if (!r.pick_date) missing.push('配货日期')
        if (r.bill_type.includes('DSP') || r.bill_type === '越库出') {
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

      const dspOutRows = validOut.filter(r => r.bill_type.includes('DSP') || r.bill_type === '越库出')
      if (dspOutRows.length > 0) {
        const validDspInKeys = new Set()
        validIn.forEach(r => {
          if (r.bill_type.includes('DSP')) validDspInKeys.add(`${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`)
        })

        const startOfToday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
        startOfToday.setHours(0, 0, 0, 0)
        const startIso = startOfToday.toISOString()

        const { data: dbDspIns, error: dspErr } = await supabase.from('bill_order')
          .select('owner_code, product_code')
          .eq('vendor_code', myVendorCode)
          .ilike('bill_type', '%DSP%')
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
        whole_process: 'NO', product_remark: r.product_name || null,
        submitter_type: isAdmin ? 'admin' : 'vendor' // ★ 代报标识
      }))

      const outPayloads = validOut.map(r => ({
        vendor_id: vendorAuthId, warehouse_code: defaultWh,
        bill_type: r.bill_type, source_no: r.source_no || null, inbound_order_no: r.source_no || null,
        owner_code: r.owner_code, store_code: r.store_code,
        location_code: r.location_code, logistics_mode: getModeByType(r.bill_type),
        pick_date: r.pick_date || null, effective_date: addOneDay(r.pick_date),
        product_code: r.product_code, spec: r.spec, quantity: calcQty(r.spec, r.quantity),
        price: 1, product_remark: r.product_name || null,
        submitter_type: isAdmin ? 'admin' : 'vendor', vendor_code: myVendorCode // ★ 代报标识
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
      const autoSource = (r.vendor_code && r.arrival_date) ? r.vendor_code + r.arrival_date.replace(/-/g, '') : ''
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
      <td><input type="date" data-i="${i}" data-f="arrival_date" value="${r.arrival_date}" ${isAdminDelegate ? '' : 'readonly'} style="width:110px;margin:0;padding:4px;${isAdminDelegate ? '' : 'background:#f5f5f5;'}" /></td>
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
          if (p) { r.product_name = p.product_name || ''; r.spec = p.spec || ''; el.closest('tr').querySelector('[data-f="spec"]').value = r.spec } 
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
          r.source_no = (r.vendor_code && r.arrival_date) ? r.vendor_code + r.arrival_date.replace(/-/g, '') : ''
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
          <option value="留库出" ${r.bill_type==='留库出'?'selected':''}>留库出</option>
          <option value="越库出" ${r.bill_type==='越库出'?'selected':''}>越库出</option>
          <option value="济转西RT(留库)" ${r.bill_type==='济转西RT(留库)'?'selected':''}>济转西RT(留库)</option>
          <option value="济转西RT(越库)" ${r.bill_type==='济转西RT(越库)'?'selected':''}>济转西RT(越库)</option>
          <option value="济转西DSP(留库)" ${r.bill_type==='济转西DSP(留库)'?'selected':''}>济转西DSP(留库)</option>
          <option value="济转西DSP(越库)" ${r.bill_type==='济转西DSP(越库)'?'selected':''}>济转西DSP(越库)</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="source_no" value="${r.source_no || ''}" placeholder="采购单号" style="width:100px;margin:0;padding:4px;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td>
        ${(r.bill_type === 'VMI出库' || r.bill_type === '留库出' || r.bill_type.includes('济转西'))
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
      <td><input type="date" data-i="${i}" data-f="pick_date" value="${r.pick_date}" ${isAdminDelegate ? '' : 'readonly'} style="width:110px;margin:0;padding:4px;${isAdminDelegate ? '' : 'background:#f5f5f5;'}" /></td>
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
          if (p) { r.product_name = p.product_name || ''; r.spec = p.spec || ''; el.closest('tr').querySelector('[data-f="spec"]').value = r.spec } 
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
          <tr><th>类型</th><th>供应商代码</th><th>货主代码</th><th>仓位</th><th>商品</th><th>品名</th><th>规格</th><th>箱数</th><th>到货日期</th></tr>
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
          <tr><th>类型</th><th>采购单号</th><th>货主代码</th><th>门店代码</th><th>仓位</th><th>配货日期</th><th>商品</th><th>品名</th><th>规格</th><th>箱数</th></tr>
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
    return  }

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
      if (!merged[k]) merged[k] = { ...r, warehouses: [r.warehouse_code] }
      else merged[k].warehouses.push(r.warehouse_code)
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

      if (!code || !name) return msgEl.innerHTML = msg('商品编码、品名为必填', false)
      if (!spec) return msgEl.innerHTML = msg('包装规格为必填', false)
      if (!isValidSpec(spec)) return msgEl.innerHTML = msg('包装规格格式错误，必须是 1*1*X', false)
      if (!length || !width || !height || !weight) return msgEl.innerHTML = msg(SIZE_EMPTY_MSG, false)
      if (!isValidSize(length, width, height, weight)) return msgEl.innerHTML = msg('长、宽、高、重量必须为正数', false)
      if (!myWhs.length) return msgEl.innerHTML = msg('没有授权仓库，请联系管理员', false)

      for (const wh of myWhs) {
        const { data: exist } = await supabase.from('product_master').select('id').eq('warehouse_code', wh).eq('default_vendor_code', selectedVendorCode).eq('product_code', code).maybeSingle()
        if (exist) return msgEl.innerHTML = msg(`商品编码 ${code} 在仓库 ${wh} 下已存在`, false)
      }

      const rows = myWhs.map(wh => ({
        warehouse_code: wh, product_code: code, product_name: name, spec,
        length: Number(length), width: Number(width), height: Number(height), weight: Number(weight),
        default_vendor_code: selectedVendorCode, default_owner_code: selectedVendorCode
      }))

      const { error } = await supabase.from('product_master').insert(rows)
      if (error) return msgEl.innerHTML = msg(translateError(error.message), false)

      msgEl.innerHTML = msg(`新增成功（写入 ${rows.length} 个仓库）`, true)
      setTimeout(async () => { list = await loadList(selectedVendorCode); renderAll() }, 600)
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
          setTimeout(async () => { list = await loadList(selectedVendorCode); renderAll() }, 600)
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
    <div class="card">
      <h2>${isLogistics ? '我负责厂商的单据' : '我的单据'}</h2>
      <div id="my-msg"></div>
      <div class="scroll" style="max-height: 600px;">
        <table>
          <tr><th>ID</th><th>厂编</th><th>类型</th><th>商品</th><th>数量</th><th>仓库</th><th>已导出</th><th>时间</th></tr>
          ${(data||[]).map(b => `<tr>
            <td>${b.id}</td><td>${b.vendor_code||''}</td><td>${b.bill_type}</td><td>${b.product_code}</td>
            <td>${b.quantity}</td><td>${b.warehouse_code}</td><td>${b.exported ? '是' : '否'}</td>
            <td>${new Date(b.created_at).toLocaleString()}</td>
          </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无单据</td></tr>'}
        </table>
      </div>
    </div>`
}

// ================= 质检报告 =================
async function renderQC(view) {
  let q = supabase.from('qc_report').select('*').order('id', { ascending: false })
  
  if (isLogistics) {
    const codes = myVendors.map(v => v.vendor_code)
    if (!codes.length) { view.innerHTML = `<div class="card"><h2>质检报告</h2><p style="color:#cf1322;">未配置负责厂商。</p></div>`; return }
    q = q.in('vendor_code', codes)
  } else {
    q = q.eq('vendor_id', currentUser.id)
  }

  const { data: reports } = await q

  view.innerHTML = `
    <div class="card">
      <h2>上传质检报告</h2>
      <div id="qc-msg"></div>
      <div class="row">
        <div style="flex:1;">
          <label>选择文件（仅支持 PDF，最大 10MB）</label>
          <input type="file" id="qc-file" accept=".pdf,application/pdf" />
        </div>
        <button id="btn-qc-upload" style="flex:0 0 100px; margin-top: 24px;">上传</button>
      </div>
    </div>
    <div class="card">
      <h2>已上传的报告（${(reports||[]).length}）</h2>
      <div class="scroll">
        <table>
          <tr><th>上传时间</th><th>厂编</th><th>文件名</th><th>操作</th></tr>
          ${(reports||[]).map(r => `<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.vendor_code}</td>
            <td>${r.report_name}</td>
            <td>
              <a href="${r.file_url}" target="_blank" class="small secondary" style="text-decoration:none; padding:4px 10px; border-radius:4px; margin-right:8px;">预览/下载</a>
              <button class="small danger" data-del-id="${r.id}" data-path="${r.file_path}">删除</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;">暂无数据</td></tr>'}
        </table>
      </div>
    </div>`

  document.getElementById('btn-qc-upload').onclick = async () => {
    const msgEl = document.getElementById('qc-msg')
    const fileInput = document.getElementById('qc-file')
    const file = fileInput.files[0]

    if (!file) return msgEl.innerHTML = msg('请选择文件', false)
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return msgEl.innerHTML = msg('只支持上传 PDF 格式的文件', false)
    }
    if (file.size > 10 * 1024 * 1024) return msgEl.innerHTML = msg('文件不能超过 10MB', false)

    const btn = document.getElementById('btn-qc-upload')
    btn.disabled = true
    btn.innerText = '上传中...'
    msgEl.innerHTML = msg('正在处理...', true)

    try {
      const myCode = isLogistics ? myVendors[0].vendor_code : currentProfile.vendor_code
      // 强制后缀为 .pdf，防止伪造
      const fileName = `qc/${myCode}_${Date.now()}.pdf`

      // 1. 获取 R2 预签名 URL
      msgEl.innerHTML = msg('正在获取上传凭证...', true)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-qc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ fileName })
      })
      
      if (!res.ok) throw new Error('获取上传凭证失败')
      const { uploadUrl, fileUrl } = await res.json()

      // 2. 直传文件到 R2
      msgEl.innerHTML = msg('正在上传到云存储...', true)
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file
      })

      if (!uploadRes.ok) throw new Error('文件上传到 R2 失败')

      // 3. 写入数据库
      msgEl.innerHTML = msg('正在保存记录...', true)
      const { error: dbErr } = await supabase.from('qc_report').insert({
        vendor_id: currentUser.id,
        vendor_code: myCode,
        report_name: file.name,
        file_path: fileName,
        file_url: fileUrl,
        file_size: file.size
      })

      if (dbErr) throw dbErr

      msgEl.innerHTML = msg('上传成功', true)
      setTimeout(() => renderQC(view), 1000)

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
        // 1. 调云函数删 R2 文件
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-qc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ filePath: path })
        })
        if (!res.ok) throw new Error('R2 文件删除失败')

        // 2. 删数据库记录
        const { error } = await supabase.from('qc_report').delete().eq('id', id)
        if (error) throw error

        alert('删除成功')
        renderQC(view)
      } catch (err) {
        alert('删除失败：' + err.message)
        btn.disabled = false
        btn.innerText = '删除'
      }
    }
  })
}

init()