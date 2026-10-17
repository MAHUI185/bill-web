import { supabase } from './supabase.js'

const SUPABASE_URL = 'https://gpjdzgakvqhnpykuqbfr.supabase.co'

const app = document.getElementById('app')
let currentUser = null
let currentProfile = null
let isAdmin = false
let currentRole = null
let isLogistics = false
let myVendors = []
let countdownTimer = null
let activeHeartbeatTimer = null

function msg(text, ok = true) {
  return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>`
}

// 统一错误翻译（Auth + DB + 网络）
function translateError(errMsg) {
  if (!errMsg) return '操作失败'
  const m = String(errMsg).toLowerCase()

  if (m.includes('new password should be different') || m.includes('same password'))
    return '新密码不能与旧密码相同'
  if (m.includes('password should be at least'))
    return '密码长度不足（至少 6 位）'
  if (m.includes('invalid login credentials'))
    return '邮箱或密码错误'
  if (m.includes('email not confirmed'))
    return '邮箱未确认'
  if (m.includes('user not found'))
    return '用户不存在'
  if (m.includes('email rate limit') || m.includes('for security purposes'))
    return '操作过于频繁，请稍后再试'
  if (m.includes('weak password'))
    return '密码太弱，请用更复杂的密码'
  if (m.includes('user already registered'))
    return '该用户已存在'
  if (m.includes('banned'))
    return '账号已被禁用'

  if (m.includes('row-level security'))
    return '没有权限执行此操作'
  if (m.includes('duplicate key') && m.includes('product_master'))
    return '该商品编码已存在'
  if (m.includes('duplicate key') && m.includes('warehouse'))
    return '该仓库代码已存在'
  if (m.includes('duplicate key') && m.includes('store_config'))
    return '该门店代码已存在'
  if (m.includes('duplicate key') && m.includes('location_config'))
    return '该仓位代码已存在'
  if (m.includes('duplicate key') && m.includes('logistics_mode'))
    return '该物流方式代码已存在'
  if (m.includes('duplicate key') && m.includes('location_warehouse_map'))
    return '该仓位映射已存在'
  if (m.includes('duplicate key') && m.includes('vendor_profile'))
    return '该厂编已存在'
  if (m.includes('duplicate key') && m.includes('admin_users'))
    return '该管理员已存在'
  if (m.includes('duplicate key') && m.includes('deadline_config'))
    return '该提报时间段已存在'
  if (m.includes('duplicate key') && m.includes('holiday_config'))
    return '该节假日已存在'
  if (m.includes('duplicate key'))
    return '数据已存在，请检查'
  if (m.includes('violates foreign key'))
    return '关联数据不存在，无法操作'
  if (m.includes('violates not-null'))
    return '必填字段不能为空'
  if (m.includes('check constraint'))
    return '数据格式不合法'
  if (m.includes('invalid input syntax for type uuid'))
    return 'ID 格式错误'
  if (m.includes('invalid input syntax for type date'))
    return '日期格式错误'
  if (m.includes('invalid input syntax for type integer') || m.includes('invalid input syntax for type numeric'))
    return '数字格式错误'
  if (m.includes('timeout') || m.includes('timed out'))
    return '操作超时，请重试'
  if (m.includes('connection'))
    return '网络连接失败，请检查网络'
  if (m.includes('jwt') && m.includes('expired'))
    return '登录已过期，请重新登录'
  if (m.includes('failed to fetch') || m.includes('networkerror'))
    return '网络连接失败，请检查网络'

  if (/[\u4e00-\u9fa5]/.test(errMsg)) return errMsg

  return '操作失败：' + errMsg
}

async function init() {
  const { data: cfg } = await supabase.from('system_config')
    .select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
  if (cfg?.config_value === 'true') return renderMaintenance()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return renderLogin()
  currentUser = session.user
  const ok = await loadProfile()
  if (!ok) return
  renderMain()
}

async function loadProfile() {
  const { data: profile } = await supabase.from('vendor_profile')
    .select('*').eq('id', currentUser.id).single()

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

  const { data: admin } = await supabase.from('admin_users')
    .select('role, status').eq('id', currentUser.id).maybeSingle()

  if (admin?.status === 0) {
    await supabase.auth.signOut()
    renderLogin('账号已禁用，请联系管理员')
    return false
  }

  isAdmin = !!admin
  currentRole = admin?.role || null
  isLogistics = profile?.account_type === 'logistics'

  if (isLogistics) {
    const { data: lv } = await supabase.from('logistics_vendor')
      .select('vendor_code, vendor_name')
      .eq('logistics_id', currentUser.id)
      .order('vendor_code')
    myVendors = lv || []
  }
  return true
}

function renderMaintenance() {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;text-align:center;">
      <h1>系统维护中</h1>
      <p style="margin:16px 0;color:#666;">系统正在部署更新，暂时无法提交数据，请稍后再试。</p>
      <button id="btn-retry">刷新</button>
    </div>`
  document.getElementById('btn-retry').onclick = () => location.reload()
  const timer = setInterval(async () => {
    const { data } = await supabase.from('system_config')
      .select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    if (data?.config_value !== 'true') {
      clearInterval(timer)
      location.reload()
    }
  }, 10000)
}

function renderLogin(errMsg = '') {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;">
      <h1>厂商留库数据提交系统</h1>
      <div id="login-msg">${errMsg ? msg(errMsg, false) : ''}</div>
      <input id="email" placeholder="邮箱" />
      <input id="password" type="password" placeholder="密码" />
      <button id="btn-login" style="width:100%;">登录</button>
      <button class="secondary" id="btn-goto-change" style="width:100%;margin-top:8px;">修改密码</button>
    </div>`
  document.getElementById('btn-login').onclick = async () => {
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      document.getElementById('login-msg').innerHTML = msg(
        translateError(error.message) === '邮箱或密码错误'
          ? '登录失败，账号可能已禁用或密码错误，请联系管理员'
          : translateError(error.message),
        false)
      return
    }

    // ★ 登录成功：写登录日志 + 更新最后登录/活跃时间
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('login_log').insert({
          vendor_id: user.id,
          user_agent: navigator.userAgent
        })
        await supabase.from('vendor_profile')
          .update({
            last_login_at: new Date().toISOString(),
            last_active_at: new Date().toISOString()
          })
          .eq('id', user.id)
      }
    } catch (e) {
      console.warn('写登录日志失败', e)
    }

    await init()
  }
  document.getElementById('btn-goto-change').onclick = () => renderChangePwd()
}

function renderChangePwd() {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;">
      <h1>修改密码</h1>
      <div id="cp-msg"></div>
      <input id="cp-email" placeholder="邮箱" />
      <input id="cp-old" type="password" placeholder="旧密码" />
      <input id="cp-new" type="password" placeholder="新密码（至少 6 位）" />
      <input id="cp-new2" type="password" placeholder="确认新密码" />
      <button id="btn-cp-submit" style="width:100%;">提交</button>
      <button class="secondary" id="btn-cp-back" style="width:100%;margin-top:8px;">返回登录</button>
    </div>`

  document.getElementById('btn-cp-back').onclick = () => renderLogin()

  document.getElementById('btn-cp-submit').onclick = async () => {
    const msgEl = document.getElementById('cp-msg')
    const email = document.getElementById('cp-email').value.trim()
    const oldPwd = document.getElementById('cp-old').value
    const newPwd = document.getElementById('cp-new').value
    const newPwd2 = document.getElementById('cp-new2').value

    if (!email || !oldPwd || !newPwd || !newPwd2) {
      msgEl.innerHTML = msg('所有字段为必填', false); return
    }
    if (newPwd.length < 6) {
      msgEl.innerHTML = msg('新密码至少 6 位', false); return
    }
    if (newPwd !== newPwd2) {
      msgEl.innerHTML = msg('两次输入的新密码不一致', false); return
    }

    msgEl.innerHTML = msg('处理中...', true)

    const { error: signErr } = await supabase.auth.signInWithPassword({
      email, password: oldPwd
    })
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
    if (error) {
      msgEl.innerHTML = msg(translateError(error.message), false); return
    }

    const { error: updErr } = await supabase.from('vendor_profile')
      .update({ must_change_pwd: false })
      .eq('id', currentUser.id)
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

function renderMain() {
  const roleTag = isAdmin ? '（管理员）' : isLogistics ? '（物流商）' : ''
  app.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
      <div>
        <h1 style="margin-bottom:4px;">厂商留库数据提交系统</h1>
        <p style="margin:0;">当前用户：${currentProfile?.vendor_name || currentUser.email} ${roleTag}</p>
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
    await supabase.auth.signOut()
    init()
  }
  const nav = document.getElementById('nav')
  const tabs = isAdmin
    ? [['admin','管理后台']]
    : [['fill','填报'],['my','我的单据'],['products','商品资料']]
  nav.innerHTML = tabs.map(([k, v]) =>
    `<button data-k="${k}">${v}</button>`).join('')
  nav.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      nav.querySelectorAll('button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      renderView(b.dataset.k)
    }
  })
  nav.querySelector('button').classList.add('active')
  renderView(tabs[0][0])

  // ★ 活跃心跳：每 3 分钟更新 last_active_at
  if (activeHeartbeatTimer) { clearInterval(activeHeartbeatTimer); activeHeartbeatTimer = null }
  if (currentUser) {
    const beat = async () => {
      try {
        await supabase.from('vendor_profile')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', currentUser.id)
      } catch (e) {}
    }
    beat()
    activeHeartbeatTimer = setInterval(beat, 3 * 60 * 1000)
  }
}

async function renderView(key) {
  const view = document.getElementById('view')
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }

  const cdEl = document.getElementById('main-countdown')
  if (cdEl) cdEl.style.display = 'none'

  if (key === 'fill') return renderFill(view)
  if (key === 'my') return renderMy(view)
  if (key === 'products') return renderProducts(view)
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
  if (billType === 'VMI入库') return 'UNIFY'
  if (billType === 'DSP入库') return 'LIKECROSS'
  if (billType === 'VMI出库') return 'LIKECROSS'
  if (billType === 'DSP出库') return 'LIKECROSS'
  if (billType === '济转西RT') return 'LIKECROSS'
  if (billType === '济转西DSP') return 'LIKECROSS'
  return 'UNIFY'
}

function calcInFields(billType, supplierInput) {
  if (billType === 'VMI入库') {
    return { vendor_code: supplierInput, owner_code: supplierInput }
  }
  if (billType === 'DSP入库') {
    return { vendor_code: supplierInput, owner_code: '8888' }
  }
  return { vendor_code: supplierInput, owner_code: '' }
}

function calcOutFields(billType, supplierInput, defaultStore) {
  if (billType === 'VMI出库') {
    return { owner_code: supplierInput, store_code: defaultStore || '' }
  }
  if (billType === 'DSP出库') {
    return { owner_code: '8888', store_code: '' }
  }
  if (billType === '济转西RT') {
    return { owner_code: supplierInput, store_code: '8205RT' }
  }
  if (billType === '济转西DSP') {
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

  return {
    range: dayType === 'weekend' ? '08:00-12:00' : '07:00-15:00',
    dayType
  }
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

  if (nowSec < startSec) {
    return {
      text: `距开始还有 ${fmt(startSec - nowSec)}`,
      bg: 'linear-gradient(135deg,#fff7e6 0%,#fff1b8 100%)',
      border: '#ffd591',
      color: '#d46b08'
    }
  }
  if (nowSec < endSec) {
    return {
      text: `距截止还有 ${fmt(endSec - nowSec)}`,
      bg: 'linear-gradient(135deg,#f6ffed 0%,#e6f4ff 100%)',
      border: '#b7eb8f',
      color: '#389e0d'
    }
  }
  return {
    text: '今日提报已截止',
    bg: 'linear-gradient(135deg,#fff2f0 0%,#ffccc7 100%)',
    border: '#ffa39e',
    color: '#cf1322'
  }
}

// ================= 填报 =================
async function renderFill(view) {
  let selectedVendor = null

  if (isLogistics) {
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
  if (isLogistics) {
    const codes = myVendors.map(v => v.vendor_code)
    const { data: vps } = await supabase.from('vendor_profile')
      .select('id, vendor_code').in('vendor_code', codes)
    const ids = (vps||[]).map(v => v.id)
    if (ids.length) {
      const { data: vw } = await supabase.from('vendor_warehouse')
        .select('warehouse_code').in('vendor_id', ids)
      myWhs = [...new Set((vw||[]).map(x => x.warehouse_code))]
    }
  } else {
    const { data: vw } = await supabase.from('vendor_warehouse')
      .select('warehouse_code').eq('vendor_id', currentUser.id)
    myWhs = (vw||[]).map(x => x.warehouse_code)
  }

  let defaultStoreCode = ''
  if (myWhs.length) {
    const { data: whInfo } = await supabase.from('warehouse')
      .select('default_store_code')
      .eq('warehouse_code', myWhs[0])
      .maybeSingle()
    defaultStoreCode = whInfo?.default_store_code || ''
  }

  const { range } = await loadDeadlineRange(myVendorCode, myWhs[0] || null)

  const { data: locs } = await supabase.from('location_config')
    .select('warehouse_code, location_code').eq('status', 1)

  const { data: stores } = await supabase.from('store_config')
    .select('warehouse_code, store_code, store_name')
    .eq('status', 1)
  const myStores = (stores||[]).filter(s =>
    !s.warehouse_code || myWhs.includes(s.warehouse_code)
  )

  async function loadProducts(vendorCode) {
    const { data } = await supabase.from('product_master')
      .select('product_code, product_name, spec')
      .eq('default_vendor_code', vendorCode)
      .order('product_code')
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

  function isInRowFilled(r) {
    return !!(r.product_code || r.spec || r.quantity)
  }
  function isOutRowFilled(r) {
    return !!(r.product_code || r.spec || r.quantity || r.source_no)
  }

  function productOptionsHtml() {
    return productList.map(p =>
      `<option value="${p.product_code}">${p.product_code} - ${p.product_name||''} - ${p.spec||''}</option>`
    ).join('')
  }

  function findProduct(code) {
    return productList.find(p => p.product_code === code)
  }

  function startCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    const wrap = document.getElementById('main-countdown')
    if (!wrap) return
    wrap.style.display = 'block'

    function tick() {
      const c = calcCountdown(range)
      const inner = document.getElementById('main-countdown-inner')
      const textEl = document.getElementById('main-countdown-text')
      if (inner) {
        inner.style.background = c.bg
        inner.style.borderColor = c.border
        inner.style.color = c.color
      }
      if (textEl) textEl.textContent = c.text
    }
    tick()
    countdownTimer = setInterval(tick, 1000)
  }

  function render() {
    view.innerHTML = `
      <div class="card">
        <h2>填报单据</h2>
        ${isLogistics ? `
          <div class="row" style="margin-bottom:12px;">
            <div>
              <label>代报厂商 *</label>
              <select id="vendor-select">
                ${myVendors.map(v => `<option value="${v.vendor_code}" ${v.vendor_code===myVendorCode?'selected':''}>${v.vendor_code}${v.vendor_name?' - '+v.vendor_name:''}</option>`).join('')}
              </select>
            </div>
          </div>` : ''}
        <div id="fill-msg"></div>

        <h3 style="margin:16px 0 8px;">入库单</h3>
        <div style="overflow-x:auto;">
          <table style="white-space:nowrap;">
            <thead>
              <tr>
                <th>类型</th><th>供应商代码</th><th>货主代码</th>
                <th>仓位</th><th>商品代码</th><th>规格</th>
                <th>数量</th><th>到货日期</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="in-body"></tbody>
          </table>
        </div>
        <button class="secondary small" id="btn-add-in" style="margin-top:8px;">+ 添加入库行</button>

        <h3 style="margin:24px 0 8px;">出库单</h3>
        <p style="font-size:12px;color:#d46b08;margin-bottom:8px;">注意：提交「DSP出库」前，必须已经提交过同货主、同商品的「DSP入库」单据。</p>
        <div style="overflow-x:auto;">
          <table style="white-space:nowrap;">
            <thead>
              <tr>
                <th>类型</th><th>采购单号</th><th>货主代码</th><th>门店代码</th>
                <th>仓位</th><th>配货日期</th>
                <th>商品代码</th><th>规格</th><th>数量</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="out-body"></tbody>
          </table>
        </div>
        <button class="secondary small" id="btn-add-out" style="margin-top:8px;">+ 添加出库行</button>

        <h3 style="margin:24px 0 8px;">预览</h3>
        <div id="preview-box"></div>

        <div style="margin-top:16px;">
          <button id="btn-submit-all">提交全部</button>
          <button class="secondary" id="btn-clear-all">清空</button>
        </div>
      </div>`

    renderInTable()
    renderOutTable()
    renderPreview()
    startCountdown()

    const vs = document.getElementById('vendor-select')
    if (vs) {
      vs.onchange = async () => {
        const vc = vs.value
        selectedVendor = myVendors.find(v => v.vendor_code === vc)
        myVendorCode = vc
        productList = await loadProducts(vc)
        inRows = [newInRowForVendor(vc)]
        outRows = [newOutRowForVendor(vc)]
        render()
      }
    }

    const btnAddIn = document.getElementById('btn-add-in')
    if (btnAddIn) btnAddIn.onclick = () => {
      inRows.push(newInRowForVendor(myVendorCode))
      renderInTable()
      renderPreview()
    }

    const btnAddOut = document.getElementById('btn-add-out')
    if (btnAddOut) btnAddOut.onclick = () => {
      outRows.push(newOutRowForVendor(myVendorCode))
      renderOutTable()
      renderPreview()
    }

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

      const { data: cfg } = await supabase.from('system_config')
        .select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
      if (cfg?.config_value === 'true') {
        return msgEl.innerHTML = msg('系统部署维护中，暂时无法提交，请稍后再试', false)
      }

      const filledIn = inRows.filter(isInRowFilled)
      const filledOut = outRows.filter(isOutRowFilled)
      if (filledIn.length === 0 && filledOut.length === 0) {
        return msgEl.innerHTML = msg('请至少填写一条单据', false)
      }

      const errors = []

      inRows.forEach((r, idx) => {
        if (!isInRowFilled(r)) return
        const missing = []
        if (!r.location_code) missing.push('仓位')
        if (!r.product_code) missing.push('商品代码')
        if (!r.spec) missing.push('包装规格')
        if (!r.quantity) missing.push('数量')
        if (!r.arrival_date) missing.push('到货日期')
        if (missing.length) errors.push(`入库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      })

      outRows.forEach((r, idx) => {
        if (!isOutRowFilled(r)) return
        const missing = []
        // ★ 只有 VMI出库 必填来源单号
        if (r.bill_type === 'VMI出库' && !r.source_no) missing.push('采购单号')
        
        if (!r.location_code) missing.push('仓位')
        if (!r.product_code) missing.push('商品代码')
        if (!r.spec) missing.push('包装规格')
        if (!r.quantity) missing.push('数量')
        if (!r.pick_date) missing.push('配货日期')
        if (r.bill_type === 'DSP出库' && !r.store_code) missing.push('门店代码')
        if (missing.length) errors.push(`出库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      })

      if (errors.length) {
        msgEl.innerHTML = `<div class="msg err">
          <strong>提交失败，以下行数据不完整：</strong>
          <div style="margin-top:8px;font-size:13px;line-height:1.8;">
            ${errors.map(e => `<div>${e}</div>`).join('')}
          </div>
        </div>`
        return
      }

      const validIn = inRows.filter(isInRowFilled)
      const validOut = outRows.filter(isOutRowFilled)

      // ===== ★ DSP核验：按 货主代码 + 商品代码 维度 =====
      const dspOutRows = validOut.filter(r => r.bill_type === 'DSP出库' || r.bill_type === 'DSP出货')
      
      if (dspOutRows.length > 0) {
        // 1. 获取本批次填写的入库记录（忽略空格大小写防误判）
        const currentInDspKeys = new Set()
        validIn.forEach(r => {
          if (r.bill_type === 'DSP入库') {
            currentInDspKeys.add(`${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`)
          }
        })

        // 2. 找出本批次里缺失了入库的前置商品
        const missingKeys = new Set()
        dspOutRows.forEach(r => {
          const key = `${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`
          if (!currentInDspKeys.has(key)) {
            missingKeys.add(key)
          }
        })

        if (missingKeys.size > 0) {
          // 3. 对于本批次缺的商品，统一去数据库查历史
          const productCodes = Array.from(missingKeys).map(k => k.split('||')[1])
          const { data: existDspIn, error: dspErr } = await supabase.from('bill_order')
            .select('owner_code, product_code')
            .eq('vendor_code', myVendorCode)
            .in('bill_type', ['DSP入库'])
            .in('product_code', productCodes)

          if (dspErr) {
            return msgEl.innerHTML = msg('校验 DSP 前置单据失败，请重试', false)
          }

          // 4. 构建数据库里已有的记录集合
          const dbExistKeys = new Set()
          ;(existDspIn || []).forEach(r => {
            dbExistKeys.add(`${(r.owner_code||'').trim()}||${(r.product_code||'').trim()}`)
          })

          // 5. 最终确认哪些缺失了
          const finalMissing = []
          missingKeys.forEach(k => {
            if (!dbExistKeys.has(k)) finalMissing.push(k)
          })

          if (finalMissing.length > 0) {
            const errCodes = finalMissing.map(k => k.split('||')[1]).join('、')
            return msgEl.innerHTML = msg(`提交失败：商品 [${errCodes}] 没有对应的 DSP入库 记录。请先提交同货主、同商品的 DSP入库单。`, false)
          }
        }
      }
      // ===== ★ DSP核验结束 =====

      let vendorAuthId
      if (isLogistics) {
        const { data: vp } = await supabase.from('vendor_profile')
          .select('id').eq('vendor_code', myVendorCode).maybeSingle()
        if (!vp) return msgEl.innerHTML = msg('找不到代报厂商，请联系管理员', false)
        vendorAuthId = vp.id
      } else {
        vendorAuthId = currentUser.id
      }

      let defaultWh
      if (myWhs.length) {
        defaultWh = myWhs[0]
      } else {
        return msgEl.innerHTML = msg('没有授权仓库，请联系管理员', false)
      }

      const inPayloads = validIn.map(r => ({
        vendor_id: vendorAuthId,
        warehouse_code: defaultWh,
        bill_type: r.bill_type,
        source_no: r.source_no || null,
        vendor_code: r.vendor_code,
        owner_code: r.owner_code,
        location_code: r.location_code,
        logistics_mode: getModeByType(r.bill_type),
        product_code: r.product_code,
        spec: r.spec,
        quantity: Number(r.quantity),
        price: 1,
        arrival_date: r.arrival_date || null,
        effective_date: addOneDay(r.arrival_date),
        whole_process: 'NO',
        product_remark: r.product_name || null,
        remark: null,
        split_flag: null, split_desc: null, tare_dimension: null, tare_value: null, route: null,
        submitter_type: 'vendor'
      }))

      const outPayloads = validOut.map(r => ({
        vendor_id: vendorAuthId,
        warehouse_code: defaultWh,
        bill_type: r.bill_type,
        source_no: r.source_no || null,
        inbound_order_no: r.source_no || null,  // 自动等于来源单号
        owner_code: r.owner_code,
        store_code: r.store_code,
        location_code: r.location_code,
        logistics_mode: getModeByType(r.bill_type),
        pick_date: r.pick_date || null,
        effective_date: addOneDay(r.pick_date),
        product_code: r.product_code,
        spec: r.spec,
        quantity: Number(r.quantity),
        price: 1,
        group_name: null, split_flag: null, split_desc: null,
        product_remark: r.product_name || null,
        submitter_type: 'vendor',
        vendor_code: myVendorCode
      }))

      const all = [...inPayloads, ...outPayloads]
      msgEl.innerHTML = msg('提交中...', true)

      const { error } = await supabase.from('bill_order').insert(all)
      if (error) {
        msgEl.innerHTML = msg(translateError(error.message), false)
        return
      }

      msgEl.innerHTML = msg(`提交成功：入库 ${inPayloads.length} 条，出库 ${outPayloads.length} 条`, true)
      inRows = [newInRowForVendor(myVendorCode)]
      outRows = [newOutRowForVendor(myVendorCode)]
      setTimeout(() => render(), 800)
    }
  }

  function renderInTable() {
    const tbody = document.getElementById('in-body')
    if (!tbody) return
    tbody.innerHTML = inRows.map((r, i) => {
      const autoSource = (r.owner_code && r.arrival_date)
        ? r.owner_code + r.arrival_date.replace(/-/g, '')
        : ''
      if (autoSource) r.source_no = autoSource
      return `<tr>
      <td>
        <select data-i="${i}" data-f="bill_type" style="width:100px;margin:0;padding:4px;">
          <option ${r.bill_type==='VMI入库'?'selected':''}>VMI入库</option>
          <option ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option>
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
      <td><input type="date" data-i="${i}" data-f="arrival_date" value="${r.arrival_date}" readonly style="width:110px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td><button class="small danger" data-del-in="${i}" style="padding:4px 8px;">删除</button></td>
    </tr>`
    }).join('')

    let dl = document.getElementById('product-list')
    if (!dl) {
      dl = document.createElement('datalist')
      dl.id = 'product-list'
      document.body.appendChild(dl)
    }
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
            r.product_name = p.product_name || ''
            r.spec = p.spec || ''
            const tr = el.closest('tr')
            tr.querySelector('[data-f="spec"]').value = r.spec
          } else {
            r.product_name = ''
          }
          renderPreview()
          return
        }

        if (f === 'bill_type') {
          r.bill_type = el.value
          const f2 = calcInFields(el.value, r.vendor_code)
          r.owner_code = f2.owner_code
          renderInTable()
          renderPreview()
          return
        }

        r[f] = el.value
        if (f === 'owner_code' || f === 'arrival_date') {
          r.source_no = (r.owner_code && r.arrival_date)
            ? r.owner_code + r.arrival_date.replace(/-/g, '')
            : ''
        }
        renderPreview()
      }
    })
    tbody.querySelectorAll('[data-del-in]').forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.delIn)
        if (inRows.length === 1) return alert('至少保留一行')
        inRows.splice(i, 1)
        renderInTable()
        renderPreview()
      }
    })
  }

  function renderOutTable() {
    const tbody = document.getElementById('out-body')
    if (!tbody) return
    tbody.innerHTML = outRows.map((r, i) => `<tr>
      <td>
        <select data-i="${i}" data-f="bill_type" style="width:100px;margin:0;padding:4px;">
          <option ${r.bill_type==='VMI出库'?'selected':''}>VMI出库</option>
          <option ${r.bill_type==='DSP出库'?'selected':''}>DSP出库</option>
          <option ${r.bill_type==='济转西RT'?'selected':''}>济转西RT</option>
          <option ${r.bill_type==='济转西DSP'?'selected':''}>济转西DSP</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="source_no" value="${r.source_no || ''}" placeholder="采购单号" style="width:100px;margin:0;padding:4px;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:80px;margin:0;padding:4px;background:#f5f5f5;" /></td>
      <td>
        ${(r.bill_type === 'VMI出库' || r.bill_type === '济转西RT' || r.bill_type === '济转西DSP')
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
      <td><input type="date" data-i="${i}" data-f="pick_date" value="${r.pick_date}" readonly style="width:110px;margin:0;padding:4px;background:#f5f5f5;" /></td>
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
            r.product_name = p.product_name || ''
            r.spec = p.spec || ''
            const tr = el.closest('tr')
            tr.querySelector('[data-f="spec"]').value = r.spec
          } else {
            r.product_name = ''
          }
          renderPreview()
          return
        }

        if (f === 'bill_type') {
          r.bill_type = el.value
          const f2 = calcOutFields(el.value, myVendorCode, defaultStoreCode)
          r.owner_code = f2.owner_code
          r.store_code = f2.store_code
          renderOutTable()
          renderPreview()
          return
        }

        r[f] = el.value
        renderPreview()
      }
    })
    tbody.querySelectorAll('[data-del-out]').forEach(b => {
      b.onclick = () => {
        const i = Number(b.dataset.delOut)
        if (outRows.length === 1) return alert('至少保留一行')
        outRows.splice(i, 1)
        renderOutTable()
        renderPreview()
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
          <tr><th>类型</th><th>供应商代码</th><th>货主代码</th><th>仓位</th><th>商品</th><th>品名</th><th>规格</th><th>数量</th><th>到货日期</th></tr>
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
          <tr><th>类型</th><th>采购单号</th><th>货主代码</th><th>门店代码</th><th>仓位</th><th>配货日期</th><th>商品</th><th>品名</th><th>规格</th><th>数量</th></tr>
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
    const { data: vp } = await supabase.from('vendor_profile')
      .select('id').eq('vendor_code', vendorCode).maybeSingle()
    if (!vp) return []
    const { data: vw } = await supabase.from('vendor_warehouse')
      .select('warehouse_code').eq('vendor_id', vp.id)
    return (vw||[]).map(x => x.warehouse_code)
  }

  async function loadList(vendorCode) {
    const { data } = await supabase.from('product_master')
      .select('*')
      .eq('default_vendor_code', vendorCode)
      .order('id', { ascending: false })
    return data || []
  }

  let myWhs = await loadWhs(selectedVendorCode)
  let list = await loadList(selectedVendorCode)

  function renderAll() {
    const merged = {}
    ;(list||[]).forEach(r => {
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
          <div><label>规格 *</label><input id="pd-spec" placeholder="如 1*1*24" /></div>
        </div>
        <p style="font-size:12px;color:#666;margin:8px 0;">授权仓库：${myWhs.join(', ') || '无'}（新增时会写入全部授权仓库）</p>
        <button id="btn-pd-add">新增商品</button>
      </div>
      <div class="card">
        <h2>商品列表（${mergedList.length}）</h2>
        <div class="scroll">
          <table>
            <tr><th>商品编码</th><th>品名</th><th>规格</th><th>仓库</th><th>操作</th></tr>
            <tbody>
              ${mergedList.map(r => `<tr>
                <td>${r.product_code||''}</td>
                <td>${r.product_name||''}</td>
                <td>${r.spec||''}</td>
                <td style="font-size:12px;">${r.warehouses.join(', ')}</td>
                <td><button class="small secondary" data-edit="${r.product_code}">编辑</button></td>
              </tr>`).join('') || '<tr><td colspan="5">无数据</td></tr>'}
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
      const code = document.getElementById('pd-code').value.trim()
      const name = document.getElementById('pd-name').value.trim()
      const spec = document.getElementById('pd-spec').value.trim()

      if (!code || !name || !spec) {
        msgEl.innerHTML = msg('商品编码、品名、规格为必填', false); return
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
        const recs = (list||[]).filter(r => r.product_code === code)
        if (!recs.length) return
        const first = recs[0]
        const panel = document.getElementById('edit-product-panel')
        panel.innerHTML = `
          <div class="card">
            <h2>编辑商品：${code}</h2>
            <div id="pedit-msg"></div>
            <div class="row">
              <div><label>品名 *</label><input id="pe-name" value="${first.product_name||''}" /></div>
              <div><label>规格 *</label><input id="pe-spec" value="${first.spec||''}" /></div>
            </div>
            <p style="font-size:12px;color:#666;margin:8px 0;">将同时更新 ${recs.length} 条记录（仓库：${recs.map(r=>r.warehouse_code).join(', ')}）</p>
            <button id="btn-pe-save">保存</button>
            <button class="secondary" id="btn-pe-cancel">取消</button>
          </div>`

        document.getElementById('btn-pe-cancel').onclick = () => panel.innerHTML = ''

        document.getElementById('btn-pe-save').onclick = async () => {
          const msgEl = document.getElementById('pedit-msg')
          const name = document.getElementById('pe-name').value.trim()
          const spec = document.getElementById('pe-spec').value.trim()
          if (!name || !spec) {
            msgEl.innerHTML = msg('品名、规格为必填', false); return
          }
          const patch = { product_name: name, spec }
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
  let q = supabase.from('bill_order')
    .select('*')
    .order('id', { ascending: false })
    .limit(200)

  if (isLogistics) {
    const codes = myVendors.map(v => v.vendor_code)
    if (!codes.length) {
      view.innerHTML = `<div class="card"><h2>我的单据</h2><p style="color:#cf1322;">未配置负责厂商。</p></div>`
      return
    }
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
          <tr>
            <th>ID</th><th>厂编</th><th>类型</th><th>商品</th><th>数量</th>
            <th>仓库</th><th>已导出</th><th>时间</th>
          </tr>
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

init()