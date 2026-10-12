import { supabase } from './supabase.js'

const SUPABASE_URL = 'https://gpjdzgakvqhnpykuqbfr.supabase.co'

const app = document.getElementById('app')
let currentUser = null
let currentProfile = null
let isAdmin = false
let currentRole = null
let isLogistics = false
let myVendors = []

function msg(text, ok = true) {
  return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>`
}

async function init() {
  const { data: cfg } = await supabase.from('system_config')
    .select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
  if (cfg?.config_value === 'true') return renderMaintenance()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return renderLogin()
  currentUser = session.user
  await loadProfile()
  renderMain()
}

async function loadProfile() {
  const { data: profile } = await supabase.from('vendor_profile')
    .select('*').eq('id', currentUser.id).single()
  currentProfile = profile

  const { data: admin } = await supabase.from('admin_users')
    .select('role').eq('id', currentUser.id).maybeSingle()
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

function renderLogin() {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;">
      <h1>厂商留库数据提交系统</h1>
      <div id="login-msg"></div>
      <input id="email" placeholder="邮箱" />
      <input id="password" type="password" placeholder="密码" />
      <button id="btn-login">登录</button>
    </div>`
  document.getElementById('btn-login').onclick = async () => {
    const email = document.getElementById('email').value.trim()
    const password = document.getElementById('password').value
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      document.getElementById('login-msg').innerHTML = msg(error.message, false)
      return
    }
    await init()
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
      <button class="secondary" id="btn-logout" style="flex:0 0 auto;">退出登录</button>
    </div>
    <div class="nav" id="nav"></div>
    <div id="view"></div>`
  document.getElementById('btn-logout').onclick = async () => {
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
}

async function renderView(key) {
  const view = document.getElementById('view')
  if (key === 'fill') return renderFill(view)
  if (key === 'my') return renderMy(view)
  if (key === 'products') return renderProducts(view)
  if (key === 'admin') {
    try {
      const mod = await import('./admin.js')
      await mod.renderAdmin(view, {
        supabase, currentUser, currentProfile, isAdmin, currentRole, msg, SUPABASE_URL
      })
    } catch (e) {
      console.error('管理后台加载失败', e)
      view.innerHTML = msg('管理后台加载失败：' + e.message, false)
    }
  }
}

function addOneDay(d) {
  if (!d) return null
  const dt = new Date(d + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

function getModeByType(billType) {
  if (billType === 'VMI入库') return 'UNIFY'
  if (billType === 'DSP入库') return 'LIKECROSS'
  if (billType === 'VMI出库') return 'LIKECROSS'
  if (billType === 'DSP出库') return 'LIKECROSS'
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

function calcOutFields(billType, supplierInput) {
  if (billType === 'VMI出库') {
    return { owner_code: supplierInput, store_code: '9998204' }
  }
  if (billType === 'DSP出库') {
    return { owner_code: '8888', store_code: '' }
  }
  return { owner_code: '', store_code: '' }
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
      product_code: '', spec: '', quantity: '', arrival_date: '',
      product_name: ''
    }
  }
  function newOutRowForVendor(vc) {
    const f = calcOutFields('VMI出库', vc)
    return {
      bill_type: 'VMI出库', owner_code: f.owner_code, store_code: f.store_code,
      location_code: (locs && locs[0]) ? locs[0].location_code : '',
      pick_date: '', product_code: '', spec: '', quantity: '',
      product_name: ''
    }
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
        <div style="overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>单据类型</th><th>供应商代码</th><th>货主代码</th>
                <th>仓位</th><th>商品代码</th><th>包装规格</th>
                <th>数量</th><th>到货日期</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="in-body"></tbody>
          </table>
        </div>
        <button class="secondary small" id="btn-add-in" style="margin-top:8px;">+ 添加入库行</button>

        <h3 style="margin:24px 0 8px;">出库单</h3>
        <div style="overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>配单类型</th><th>货主代码</th><th>门店代码</th>
                <th>仓位</th><th>配货日期</th>
                <th>商品代码</th><th>包装规格</th><th>数量</th><th>操作</th>
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
  }

  function productOptionsHtml() {
    return productList.map(p =>
      `<option value="${p.product_code}">${p.product_code} - ${p.product_name||''} - ${p.spec||''}</option>`
    ).join('')
  }

  function findProduct(code) {
    return productList.find(p => p.product_code === code)
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
        <select data-i="${i}" data-f="bill_type" style="width:110px;margin:0;">
          <option ${r.bill_type==='VMI入库'?'selected':''}>VMI入库</option>
          <option ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="vendor_code" value="${r.vendor_code}" readonly style="width:100px;margin:0;background:#f5f5f5;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:100px;margin:0;background:#f5f5f5;" /></td>
      <td>
        <select data-i="${i}" data-f="location_code" style="width:80px;margin:0;">
          ${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}
        </select>
      </td>
      <td><input list="product-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:140px;margin:0;" placeholder="输入或选择" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:100px;margin:0;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:80px;margin:0;" /></td>
      <td><input type="date" data-i="${i}" data-f="arrival_date" value="${r.arrival_date}" style="width:140px;margin:0;" /></td>
      <td><button class="small danger" data-del-in="${i}">删除</button></td>
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
        <select data-i="${i}" data-f="bill_type" style="width:110px;margin:0;">
          <option ${r.bill_type==='VMI出库'?'selected':''}>VMI出库</option>
          <option ${r.bill_type==='DSP出库'?'selected':''}>DSP出库</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" readonly style="width:100px;margin:0;background:#f5f5f5;" /></td>
      <td>
        ${r.bill_type === 'VMI出库'
          ? `<input data-i="${i}" data-f="store_code" value="${r.store_code}" readonly style="width:120px;margin:0;background:#f5f5f5;" />`
          : `<select data-i="${i}" data-f="store_code" style="width:140px;margin:0;">
               <option value="">请选择门店</option>
               ${myStores.map(s => `<option value="${s.store_code}" ${r.store_code===s.store_code?'selected':''}>${s.store_code}${s.store_name?' - '+s.store_name:''}</option>`).join('')}
             </select>`}
      </td>
      <td>
        <select data-i="${i}" data-f="location_code" style="width:80px;margin:0;">
          ${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" data-i="${i}" data-f="pick_date" value="${r.pick_date}" style="width:140px;margin:0;" /></td>
      <td><input list="product-list" data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:140px;margin:0;" placeholder="输入或选择" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:100px;margin:0;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:80px;margin:0;" /></td>
      <td><button class="small danger" data-del-out="${i}">删除</button></td>
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
          const f2 = calcOutFields(el.value, myVendorCode)
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
      <div style="margin-bottom:12px;">
        <strong>入库 ${validIn.length} 条：</strong>
        ${validIn.length === 0 ? '<span style="color:#999;">无</span>' : `
        <table style="margin-top:6px;">
          <tr><th>单据类型</th><th>供应商代码</th><th>货主代码</th><th>仓位</th><th>商品</th><th>品名</th><th>规格</th><th>数量</th><th>到货日期</th></tr>
          ${validIn.map(r => `<tr>
            <td>${r.bill_type}</td><td>${r.vendor_code}</td><td>${r.owner_code}</td>
            <td>${r.location_code}</td><td>${r.product_code}</td><td>${r.product_name||''}</td><td>${r.spec}</td>
            <td>${r.quantity}</td><td>${r.arrival_date || '-'}</td>
          </tr>`).join('')}
        </table>`}
      </div>
      <div>
        <strong>出库 ${validOut.length} 条：</strong>
        ${validOut.length === 0 ? '<span style="color:#999;">无</span>' : `
        <table style="margin-top:6px;">
          <tr><th>配单类型</th><th>货主代码</th><th>门店代码</th><th>仓位</th><th>配货日期</th><th>商品</th><th>品名</th><th>规格</th><th>数量</th></tr>
          ${validOut.map(r => `<tr>
            <td>${r.bill_type}</td><td>${r.owner_code}</td><td>${r.store_code}</td>
            <td>${r.location_code}</td><td>${r.pick_date || '-'}</td>
            <td>${r.product_code}</td><td>${r.product_name||''}</td><td>${r.spec}</td><td>${r.quantity}</td>
          </tr>`).join('')}
        </table>`}
      </div>`
  }

  render()

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

    const errors = []

    inRows.forEach((r, idx) => {
      const missing = []
      if (!r.location_code) missing.push('仓位')
      if (!r.product_code) missing.push('商品代码')
      if (!r.spec) missing.push('包装规格')
      if (!r.quantity) missing.push('数量')
      if (!r.arrival_date) missing.push('到货日期')
      if (missing.length) {
        errors.push(`入库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      }
    })

    outRows.forEach((r, idx) => {
      const missing = []
      if (!r.location_code) missing.push('仓位')
      if (!r.product_code) missing.push('商品代码')
      if (!r.spec) missing.push('包装规格')
      if (!r.quantity) missing.push('数量')
      if (!r.pick_date) missing.push('配货日期')
      if (r.bill_type === 'DSP出库' && !r.store_code) missing.push('门店代码')
      if (missing.length) {
        errors.push(`出库单 第 ${idx+1} 行：${missing.join('、')} 未填`)
      }
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

    const validIn = inRows
    const validOut = outRows

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
      source_no: null,
      owner_code: r.owner_code,
      store_code: r.store_code,
      location_code: r.location_code,
      logistics_mode: getModeByType(r.bill_type),
      pick_date: r.pick_date || null,
      effective_date: addOneDay(r.pick_date),
      inbound_order_no: null,
      product_code: r.product_code,
      spec: r.spec,
      quantity: Number(r.quantity),
      price: 1,
      group_name: null, split_flag: null, split_desc: null,
      product_remark: r.product_name || null,
      submitter_type: 'vendor',
      vendor_code: r.owner_code
    }))

    const all = [...inPayloads, ...outPayloads]
    msgEl.innerHTML = msg('提交中...', true)

    const { error } = await supabase.from('bill_order').insert(all)
    if (error) {
      msgEl.innerHTML = msg(error.message, false)
      return
    }

    msgEl.innerHTML = msg(`提交成功：入库 ${inPayloads.length} 条，出库 ${outPayloads.length} 条`, true)
    inRows = [newInRowForVendor(myVendorCode)]
    outRows = [newOutRowForVendor(myVendorCode)]
    setTimeout(() => render(), 800)
  }
}

// ================= 商品资料（厂商 + 物流商） =================
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
        msgEl.innerHTML = msg(error.message, false)
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
            msgEl.innerHTML = msg(error.message, false)
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
      <table>
        <tr>
          <th>ID</th><th>厂编</th><th>类型</th><th>商品</th><th>数量</th>
          <th>仓库</th><th>已导出</th><th>时间</th><th>操作</th>
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
          <td>
            ${b.exported
              ? '<span style="color:#999;font-size:12px;">已导出不可改</span>'
              : `<button class="small secondary" data-edit="${b.id}">修改</button>`}
          </td>
        </tr>`).join('')}
      </table>
    </div>
    <div id="edit-panel"></div>`

  view.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.edit)
      const bill = (data||[]).find(x => x.id === id)
      if (!bill) return
      const panel = document.getElementById('edit-panel')
      panel.innerHTML = `
        <div class="card">
          <h2>修改单据 #${id}</h2>
          <input id="e-source" type="hidden" value="${bill.source_no||''}" />
          <div class="row">
            <div><label>商品代码</label><input id="e-product" value="${bill.product_code||''}" /></div>
            <div><label>包装规格</label><input id="e-spec" value="${bill.spec||''}" /></div>
            <div><label>数量</label><input id="e-qty" type="number" value="${bill.quantity||''}" /></div>
          </div>
          <div class="row">
            <div><label>货主代码</label><input id="e-owner" value="${bill.owner_code||''}" /></div>
            <div><label>到货日期</label><input id="e-arrival" type="date" value="${bill.arrival_date||''}" /></div>
            <div><label>订单到效日期</label><input id="e-effective" type="date" value="${bill.effective_date||''}" /></div>
          </div>
          <div class="row">
            <div style="flex:3;"><label>备注</label><input id="e-remark" value="${bill.remark||''}" /></div>
          </div>
          <button id="btn-save-edit">保存修改</button>
          <button class="secondary" id="btn-cancel-edit">取消</button>
        </div>`

      document.getElementById('btn-save-edit').onclick = async () => {
        const patch = {
          source_no: document.getElementById('e-source').value,
          product_code: document.getElementById('e-product').value,
          spec: document.getElementById('e-spec').value,
          quantity: Number(document.getElementById('e-qty').value),
          owner_code: document.getElementById('e-owner').value,
          effective_date: document.getElementById('e-effective').value || null,
          arrival_date: document.getElementById('e-arrival').value || null,
          remark: document.getElementById('e-remark').value
        }
        const { error } = await supabase.from('bill_order')
          .update(patch).eq('id', id)
        if (error) {
          document.getElementById('my-msg').innerHTML = msg(error.message, false)
          return
        }
        document.getElementById('my-msg').innerHTML = msg('修改成功', true)
        renderMy(view)
      }

      document.getElementById('btn-cancel-edit').onclick = () => {
        panel.innerHTML = ''
      }
    }
  })
}

init()