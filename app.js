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

async function renderFill(view) {
  const { data: whs } = await supabase.from('vendor_warehouse')
    .select('warehouse_code').eq('vendor_id', currentUser.id)
  const { data: modes } = await supabase.from('logistics_mode_config')
    .select('mode_code, mode_name').eq('status', 1)
  const { data: locs } = await supabase.from('location_config')
    .select('warehouse_code, location_code').eq('status', 1)

  view.innerHTML = `
    <div class="card">
      <h2>填报单据</h2>
      <div id="fill-msg"></div>
      <div class="row">
        <select id="f-warehouse">${(whs||[]).map(w =>
          `<option value="${w.warehouse_code}">${w.warehouse_code}</option>`).join('')}</select>
        <select id="f-billtype">
          <option>VMI入库</option><option>VMI出库</option>
          <option>DSP入库</option><option>DSP出库</option>
        </select>
        <select id="f-mode">${(modes||[]).map(m =>
          `<option value="${m.mode_code}">${m.mode_name}</option>`).join('')}</select>
      </div>
      <div class="row">
        <input id="f-source" placeholder="来源单号" />
        <input id="f-vendor" placeholder="供应商代码" value="${currentProfile?.vendor_code||''}" />
        <input id="f-owner" placeholder="货主代码" />
      </div>
      <div class="row">
        <select id="f-location">${(locs||[]).map(l =>
          `<option value="${l.location_code}">${l.location_code}</option>`).join('')}</select>
        <input id="f-product" placeholder="商品代码" />
        <input id="f-spec" placeholder="包装规格 1*1*30" />
      </div>
      <div class="row">
        <input id="f-qty" type="number" placeholder="数量" />
        <input id="f-price" type="number" placeholder="单价" />
        <input id="f-effective" type="date" />
        <input id="f-arrival" type="date" />
      </div>
      <div class="row">
        <select id="f-process"><option>NO</option><option>YES</option></select>
        <input id="f-remark" placeholder="商品备注" />
        <input id="f-remark2" placeholder="备注" />
      </div>
      <button id="btn-submit">提交单据</button>
    </div>`

  document.getElementById('btn-submit').onclick = async () => {
    const payload = {
      vendor_id: currentUser.id,
      warehouse_code: document.getElementById('f-warehouse').value,
      bill_type: document.getElementById('f-billtype').value,
      source_no: document.getElementById('f-source').value,
      vendor_code: document.getElementById('f-vendor').value,
      owner_code: document.getElementById('f-owner').value,
      location_code: document.getElementById('f-location').value,
      logistics_mode: document.getElementById('f-mode').value,
      product_code: document.getElementById('f-product').value,
      spec: document.getElementById('f-spec').value,
      quantity: Number(document.getElementById('f-qty').value),
      price: Number(document.getElementById('f-price').value) || null,
      effective_date: document.getElementById('f-effective').value || null,
      arrival_date: document.getElementById('f-arrival').value || null,
      whole_process: document.getElementById('f-process').value,
      product_remark: document.getElementById('f-remark').value,
      remark: document.getElementById('f-remark2').value
    }
    const { error } = await supabase.from('bill_order').insert(payload)
    document.getElementById('fill-msg').innerHTML = error
      ? msg(error.message, false) : msg('提交成功', true)
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
          <h2>修改单据 #${id}</h2>
          <div class="row">
            <input id="e-source" placeholder="来源单号" value="${bill.source_no||''}" />
            <input id="e-product" placeholder="商品代码" value="${bill.product_code||''}" />
            <input id="e-spec" placeholder="包装规格" value="${bill.spec||''}" />
          </div>
          <div class="row">
            <input id="e-qty" type="number" placeholder="数量" value="${bill.quantity||''}" />
            <input id="e-price" type="number" placeholder="单价" value="${bill.price||''}" />
            <input id="e-owner" placeholder="货主代码" value="${bill.owner_code||''}" />
          </div>
          <div class="row">
            <input id="e-effective" type="date" value="${bill.effective_date||''}" />
            <input id="e-arrival" type="date" value="${bill.arrival_date||''}" />
            <input id="e-remark" placeholder="备注" value="${bill.remark||''}" />
          </div>
          <div class="row">
            <input id="e-remark2" placeholder="商品备注" value="${bill.product_remark||''}" />
            <input id="e-process" placeholder="整单加工" value="${bill.whole_process||''}" />
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
          price: Number(document.getElementById('e-price').value) || null,
          owner_code: document.getElementById('e-owner').value,
          effective_date: document.getElementById('e-effective').value || null,
          arrival_date: document.getElementById('e-arrival').value || null,
          remark: document.getElementById('e-remark').value,
          product_remark: document.getElementById('e-remark2').value,
          whole_process: document.getElementById('e-process').value
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