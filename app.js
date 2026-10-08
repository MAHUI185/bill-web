import { supabase } from './supabase.js'

const SUPABASE_URL = 'https://gpjdzgakvqhnpykuqbfr.supabase.co'

const app = document.getElementById('app')
let currentUser = null
let currentProfile = null
let isAdmin = false

function msg(text, ok = true) {
  return `<div class="msg ${ok ? 'ok' : 'err'}">${text}</div>`
}

async function init() {
  // ★ 维护模式检查
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
}

// ★ 维护页
function renderMaintenance() {
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:80px auto;text-align:center;">
      <h1>系统维护中</h1>
      <p style="margin:16px 0;color:#666;">系统正在部署更新，暂时无法提交数据，请稍后再试。</p>
      <button id="btn-retry">刷新</button>
    </div>`
  document.getElementById('btn-retry').onclick = () => location.reload()
  // 每 10 秒自动检查，部署完自动放行
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
  app.innerHTML = `
    <div class="card">
      <h1>厂商留库数据提交系统</h1>
      <p>当前用户：${currentProfile?.vendor_name || currentUser.email} ${isAdmin ? '（管理员）' : ''}</p>
      <button class="secondary" id="btn-logout">退出登录</button>
    </div>
    <div class="nav" id="nav"></div>
    <div id="view"></div>`
  document.getElementById('btn-logout').onclick = async () => {
    await supabase.auth.signOut()
    init()
  }
  const nav = document.getElementById('nav')
  const tabs = isAdmin
    ? [['fill','填报'],['my','我的单据'],['admin','管理后台']]
    : [['fill','填报'],['my','我的单据']]
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
  if (key === 'admin') {
    try {
      const mod = await import('./admin.js')
      await mod.renderAdmin(view, {
        supabase, currentUser, currentProfile, isAdmin, msg, SUPABASE_URL
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
  if (billType === 'VMI存储') return 'UNIFY'
  if (billType === 'DSP入库') return 'LIKECROSS'
  if (billType === 'VMI出库') return 'LIKECROSS'
  if (billType === 'DSP出货') return 'LIKECROSS'
  return 'UNIFY'
}

async function renderFill(view) {
  const { data: whs } = await supabase.from('vendor_warehouse')
    .select('warehouse_code').eq('vendor_id', currentUser.id)
  const { data: locs } = await supabase.from('location_config')
    .select('warehouse_code, location_code').eq('status', 1)

  let inRows = [newInRow()]
  let outRows = [newOutRow()]

  function newInRow() {
    return {
      source_no: '', bill_type: 'VMI存储', vendor_code: currentProfile?.vendor_code || '',
      owner_code: '', location_code: (locs && locs[0]) ? locs[0].location_code : '',
      product_code: '', spec: '', quantity: '', arrival_date: ''
    }
  }
  function newOutRow() {
    return {
      bill_type: 'VMI出库', owner_code: '', store_code: '',
      location_code: (locs && locs[0]) ? locs[0].location_code : '',
      pick_date: '', product_code: '', spec: '', quantity: ''
    }
  }

  function render() {
    view.innerHTML = `
      <div class="card">
        <h2>填报单据</h2>
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
  }

  function renderInTable() {
    const tbody = document.getElementById('in-body')
    if (!tbody) return
    tbody.innerHTML = inRows.map((r, i) => {
      // ★ 自动计算来源单号（隐藏，不显示，但提交时写入）
      const autoSource = (r.owner_code && r.arrival_date)
        ? r.owner_code + r.arrival_date.replace(/-/g, '')
        : ''
      if (autoSource) r.source_no = autoSource
      return `<tr>
      <td>
        <select data-i="${i}" data-f="bill_type" style="width:110px;margin:0;">
          <option ${r.bill_type==='VMI存储'?'selected':''}>VMI存储</option>
          <option ${r.bill_type==='DSP入库'?'selected':''}>DSP入库</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="vendor_code" value="${r.vendor_code}" style="width:120px;margin:0;" /></td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" style="width:120px;margin:0;" /></td>
      <td>
        <select data-i="${i}" data-f="location_code" style="width:80px;margin:0;">
          ${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}
        </select>
      </td>
      <td><input data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:120px;margin:0;" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:100px;margin:0;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:80px;margin:0;" /></td>
      <td><input type="date" data-i="${i}" data-f="arrival_date" value="${r.arrival_date}" style="width:140px;margin:0;" /></td>
      <td><button class="small danger" data-del-in="${i}">删除</button></td>
    </tr>`
    }).join('')

    tbody.querySelectorAll('input,select').forEach(el => {
      el.oninput = el.onchange = () => {
        const i = Number(el.dataset.i)
        const f = el.dataset.f
        inRows[i][f] = el.value
        // ★ 自动计算 source_no（不再更新页面元素）
        if (f === 'owner_code' || f === 'arrival_date') {
          const r = inRows[i]
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
          <option ${r.bill_type==='DSP出货'?'selected':''}>DSP出货</option>
        </select>
      </td>
      <td><input data-i="${i}" data-f="owner_code" value="${r.owner_code}" style="width:120px;margin:0;" /></td>
      <td><input data-i="${i}" data-f="store_code" value="${r.store_code}" style="width:120px;margin:0;" /></td>
      <td>
        <select data-i="${i}" data-f="location_code" style="width:80px;margin:0;">
          ${(locs||[]).map(l => `<option value="${l.location_code}" ${r.location_code===l.location_code?'selected':''}>${l.location_code}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" data-i="${i}" data-f="pick_date" value="${r.pick_date}" style="width:140px;margin:0;" /></td>
      <td><input data-i="${i}" data-f="product_code" value="${r.product_code}" style="width:120px;margin:0;" /></td>
      <td><input data-i="${i}" data-f="spec" value="${r.spec}" style="width:100px;margin:0;" /></td>
      <td><input type="number" data-i="${i}" data-f="quantity" value="${r.quantity}" style="width:80px;margin:0;" /></td>
      <td><button class="small danger" data-del-out="${i}">删除</button></td>
    </tr>`).join('')

    tbody.querySelectorAll('input,select').forEach(el => {
      el.oninput = el.onchange = () => {
        const i = Number(el.dataset.i)
        const f = el.dataset.f
        outRows[i][f] = el.value
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
    const validIn = inRows.filter(r => r.source_no && r.product_code && r.quantity)
    const validOut = outRows.filter(r => r.owner_code && r.product_code && r.quantity)
    box.innerHTML = `
      <div style="margin-bottom:12px;">
        <strong>入库 ${validIn.length} 条：</strong>
        ${validIn.length === 0 ? '<span style="color:#999;">无</span>' : `
        <table style="margin-top:6px;">
          <tr><th>来源单号</th><th>单据类型</th><th>商品</th><th>规格</th><th>数量</th><th>到货日期</th><th>订单到效日期</th></tr>
          ${validIn.map(r => `<tr>
            <td>${r.source_no}</td><td>${r.bill_type}</td><td>${r.product_code}</td>
            <td>${r.spec}</td><td>${r.quantity}</td><td>${r.arrival_date || '-'}</td>
            <td>${r.arrival_date ? addOneDay(r.arrival_date) : '-'}</td>
          </tr>`).join('')}
        </table>`}
      </div>
      <div>
        <strong>出库 ${validOut.length} 条：</strong>
        ${validOut.length === 0 ? '<span style="color:#999;">无</span>' : `
        <table style="margin-top:6px;">
          <tr><th>配单类型</th><th>货主</th><th>门店</th><th>商品</th><th>规格</th><th>数量</th><th>配货日期</th><th>到效日期</th></tr>
          ${validOut.map(r => `<tr>
            <td>${r.bill_type}</td><td>${r.owner_code}</td><td>${r.store_code}</td>
            <td>${r.product_code}</td><td>${r.spec}</td>
            <td>${r.quantity}</td><td>${r.pick_date || '-'}</td>
            <td>${r.pick_date ? addOneDay(r.pick_date) : '-'}</td>
          </tr>`).join('')}
        </table>`}
      </div>`
  }

  // ★★★ 关键：先渲染 HTML，再绑定按钮 ★★★
  render()

  const btnAddIn = document.getElementById('btn-add-in')
  if (btnAddIn) btnAddIn.onclick = () => {
    inRows.push(newInRow())
    renderInTable()
    renderPreview()
  }

  const btnAddOut = document.getElementById('btn-add-out')
  if (btnAddOut) btnAddOut.onclick = () => {
    outRows.push(newOutRow())
    renderOutTable()
    renderPreview()
  }

  const btnClear = document.getElementById('btn-clear-all')
  if (btnClear) btnClear.onclick = () => {
    if (!confirm('确定清空所有已填内容？')) return
    inRows = [newInRow()]
    outRows = [newOutRow()]
    render()
  }

  const btnSubmit = document.getElementById('btn-submit-all')
  if (btnSubmit) btnSubmit.onclick = async () => {
    const msgEl = document.getElementById('fill-msg')

    // ★ 提交前检查维护模式
    const { data: cfg } = await supabase.from('system_config')
      .select('config_value').eq('config_key', 'maintenance_mode').maybeSingle()
    if (cfg?.config_value === 'true') {
      return msgEl.innerHTML = msg('系统部署维护中，暂时无法提交，请稍后再试', false)
    }

    const validIn = inRows.filter(r => r.source_no && r.product_code && r.quantity)
    const validOut = outRows.filter(r => r.owner_code && r.product_code && r.quantity)
    if (validIn.length === 0 && validOut.length === 0) {
      return msgEl.innerHTML = msg('请至少填写一条单据', false)
    }
    if (!whs || whs.length === 0) {
      return msgEl.innerHTML = msg('没有授权仓库，请联系管理员', false)
    }
    const defaultWh = whs[0].warehouse_code

    const inPayloads = validIn.map(r => ({
      vendor_id: currentUser.id,
      warehouse_code: defaultWh,
      bill_type: r.bill_type,
      source_no: r.source_no,
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
      product_remark: null,
      remark: null,
      split_flag: null,
      split_desc: null,
      tare_dimension: null,
      tare_value: null,
      route: null,
      submitter_type: 'vendor'
    }))

    const outPayloads = validOut.map(r => ({
      vendor_id: currentUser.id,
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
      group_name: null,
      split_flag: null,
      split_desc: null,
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
    inRows = [newInRow()]
    outRows = [newOutRow()]
    setTimeout(() => render(), 800)
  }
}

async function renderMy(view) {
  const { data } = await supabase.from('bill_order')
    .select('*').eq('vendor_id', currentUser.id)
    .order('id', { ascending: false }).limit(100)

  view.innerHTML = `
    <div class="card">
      <h2>我的单据</h2>
      <div id="my-msg"></div>
      <table>
        <tr>
          <th>ID</th><th>类型</th><th>商品</th><th>数量</th>
          <th>仓库</th><th>已导出</th><th>时间</th><th>操作</th>
        </tr>
        ${(data||[]).map(b => `<tr>
          <td>${b.id}</td>
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
          <h2>修改单据</h2>
          <input id="e-source" type="hidden" value="${bill.source_no||''}" />
          <div class="row">
            <div>
              <label>商品代码</label>
              <input id="e-product" value="${bill.product_code||''}" />
            </div>
            <div>
              <label>包装规格</label>
              <input id="e-spec" value="${bill.spec||''}" />
            </div>
            <div>
              <label>数量</label>
              <input id="e-qty" type="number" value="${bill.quantity||''}" />
            </div>
          </div>
          <div class="row">
            <div>
              <label>货主代码</label>
              <input id="e-owner" value="${bill.owner_code||''}" />
            </div>
            <div>
              <label>到货日期</label>
              <input id="e-arrival" type="date" value="${bill.arrival_date||''}" />
            </div>
            <div>
              <label>订单到效日期</label>
              <input id="e-effective" type="date" value="${bill.effective_date||''}" />
            </div>
          </div>
          <div class="row">
            <div style="flex:3;">
              <label>备注</label>
              <input id="e-remark" value="${bill.remark||''}" />
            </div>
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