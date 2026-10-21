// admin.js — 管理后台（2026-10-22 正式上线完整版，包含全部增删改查）

let ctx = null
let operatorName = '未知'

function isValidSpec(spec) {
  if (!spec) return false
  return /^1\*1\*[1-9]\d*$/.test(String(spec).trim())
}
const SIZE_EMPTY_MSG = '长、宽、高、重量为必填，请到「商品资料」补全'

export async function renderAdmin(view, context) {
  ctx = context

  if (context.currentRole) {
    const { data: au } = await context.supabase.from('admin_users')
      .select('name').eq('id', context.currentUser.id).maybeSingle()
    operatorName = au?.name || context.currentProfile?.contact_name || '管理员'
  } else {
    operatorName = context.currentProfile?.contact_name
      || context.currentProfile?.vendor_name || '未知'
  }
  ctx.operatorName = operatorName

  let menuHtml = ''
  if (context.currentRole === 'super_admin') {
    menuHtml = `
      <button data-t="progress" class="active">预约进度</button>
      <button data-t="bills">单据管理</button>
      <button data-t="vendors">厂商管理</button>
      <button data-t="logistics">物流商管理</button>
      <button data-t="admins">管理员管理</button>
      <button data-t="base">基础数据</button>
      <button data-t="logs">日志</button>
      <button data-t="sys">系统配置</button>
    `
  } else if (context.currentRole === 'admin') {
    menuHtml = `
      <button data-t="progress" class="active">预约进度</button>
      <button data-t="bills">单据管理</button>
      <button data-t="vendors">厂商管理</button>
      <button data-t="logistics">物流商管理</button>
    `
  } else {
    menuHtml = `
      <button data-t="progress" class="active">预约进度</button>
      <button data-t="bills">单据管理</button>
    `
  }

  view.innerHTML = `
    <div class="card" style="flex:1; margin:0; padding:0; overflow:hidden; display:flex; flex-direction:column;">
      <div style="padding:16px 24px 0; flex:0 0 auto;">
        <h2>管理后台</h2>
        <div class="tabs" id="admin-tabs">${menuHtml}</div>
      </div>
      <div id="admin-view" style="flex:1; overflow:hidden; padding:0 24px 24px; display:flex; flex-direction:column;"></div>
    </div>`

  document.querySelectorAll('#admin-tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#admin-tabs button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      renderTab(b.dataset.t)
    }
  })
  renderTab('progress')
}

async function renderTab(key) {
  const v = document.getElementById('admin-view')
  v.innerHTML = '<p>加载中...</p>'
  try {
    if (key === 'progress') return renderProgress(v)
    if (key === 'bills') return renderBills(v)
    if (key === 'vendors') return renderVendors(v)
    if (key === 'logistics') return renderLogistics(v)
    if (key === 'admins') return renderAdmins(v)
    if (key === 'base') return renderBase(v)
    if (key === 'logs') return renderLogs(v)
    if (key === 'sys') return renderSys(v)
  } catch (e) {
    console.error(e)
    v.innerHTML = ctx.msg('加载失败，请刷新重试', false)
  }
}

function isSuper() {
  return ctx.currentRole === 'super_admin'
}

async function logOp(action, target, detail = {}) {
  try {
    await ctx.supabase.from('operation_log').insert({
      operator_id: ctx.currentUser.id,
      operator_name: ctx.operatorName,
      action, target, detail
    })
  } catch (e) {
    console.warn('写操作日志失败', e)
  }
}

// ================= 1. 预约进度 =================
async function renderProgress(v) {
  const { data } = await ctx.supabase.from('vendor_report_status').select('*')
  
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const { data: qcs } = await ctx.supabase.from('qc_upload_log').select('*').eq('upload_date', todayStr)
  
  const qcMap = {}
  ;(qcs||[]).forEach(q => {
    if (!qcMap[q.vendor_code]) qcMap[q.vendor_code] = { count: 0, list: [] }
    qcMap[q.vendor_code].count++
    qcMap[q.vendor_code].list.push(q)
  })

  v.innerHTML = `
    <div class="row" style="margin-bottom:12px; flex:0 0 auto;">
      <input id="p-search" placeholder="搜索厂编/名称" style="flex:2; margin:0;" />
      <select id="p-type" style="flex:1; margin:0;">
        <option value="">全部类型</option>
        <option value="stock">留库厂商</option>
        <option value="cross">越库厂商</option>
      </select>
      <select id="p-qc" style="flex:1; margin:0;">
        <option value="">全部质检状态</option>
        <option value="yes">已上传</option>
        <option value="no">未上传</option>
      </select>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table>
        <thead><tr><th>厂编</th><th>厂商名称</th><th>类型</th><th>登录状态</th><th>今日预约</th><th>最后活跃</th><th>质检报告</th></tr></thead>
        <tbody id="p-body"></tbody>
      </table>
    </div>`

  const render = () => {
    const kw = (document.getElementById('p-search').value || '').toLowerCase()
    const type = document.getElementById('p-type').value
    const qc = document.getElementById('p-qc').value
    let list = data || []
    
    if (kw) list = list.filter(r => (r.vendor_code||'').toLowerCase().includes(kw) || (r.vendor_name||'').toLowerCase().includes(kw))
    if (type) list = list.filter(r => r.vendor_type === type)
    if (qc === 'yes') list = list.filter(r => qcMap[r.vendor_code])
    if (qc === 'no') list = list.filter(r => !qcMap[r.vendor_code])

    document.getElementById('p-body').innerHTML = list.map(r => {
      const qcInfo = qcMap[r.vendor_code]
      let qcHtml = '<span style="color:#999;">未上传</span>'
      if (qcInfo) {
        qcHtml = `<a href="${qcInfo.list[0].file_key}" target="_blank" style="color:#1677ff; text-decoration:none;">📄 下载 PDF</a> <span style="color:#999;font-size:12px;">(${qcInfo.count}份)</span>`
      }

      return `<tr>
        <td>${r.vendor_code || ''}</td>
        <td>${r.vendor_name || ''}</td>
        <td>${r.vendor_type === 'cross' ? '<span class="stat" style="background:#fff7e6;color:#d46b08;border:1px solid #ffd591;">越库</span>' : '<span class="stat" style="background:#e6f4ff;color:#1677ff;border:1px solid #91caff;">留库</span>'}</td>
        <td>${r.login_status === '在线' ? '<span class="stat ok" style="color:#1677ff;">● 在线</span>' : r.login_status === '今日已登录' ? '<span class="stat ok">已登录</span>' : '<span class="stat no">未登录</span>'}</td>
        <td>${r.vendor_type === 'cross' ? '-' : (r.reported_today ? '<span class="stat ok">已预约</span>' : '<span class="stat no">未预约</span>')}</td>
        <td>${r.last_active_at ? new Date(r.last_active_at).toLocaleString() : '-'}</td>
        <td>${qcHtml}</td>
      </tr>`
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;">无数据</td></tr>'
  }
  document.getElementById('p-search').oninput = render
  document.getElementById('p-type').onchange = render
  document.getElementById('p-qc').onchange = render
  render()
}

// ================= 2. 单据管理 =================
async function renderBills(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data: vendors } = await ctx.supabase.from('vendor_profile').select('vendor_code, vendor_name').eq('account_type', 'vendor')
  const vMap = {}
  ;(vendors || []).forEach(x => { vMap[x.vendor_code] = x.vendor_name })

  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row" style="margin-bottom:12px; flex:0 0 auto;">
        <select id="exp-wh" style="flex:1; margin:0;">
          ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
        </select>
        <input id="exp-start" type="date" style="flex:1; margin:0;" />
        <span style="color:#666; font-size:13px;">至</span>
        <input id="exp-end" type="date" style="flex:1; margin:0;" />
        <label style="flex:0 0 auto; display:flex; align-items:center; gap:6px; font-size:13px; color:#666; margin:0;">
          <input type="checkbox" id="exp-include" style="width:auto; margin:0;" /> 包含已导出
        </label>
        <button id="btn-export" style="flex:0 0 100px;">导出</button>
      </div>
      <div id="export-msg" style="flex:0 0 auto;"></div>
      
      <div class="row" style="margin-bottom:8px;">
        <input id="b-search" placeholder="输入厂商名称/厂编/单号查询" style="flex:2; margin:0;" />
        <select id="b-wh" style="flex:1; margin:0;"><option value="">全部仓库</option>${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <select id="b-exported" style="flex:1; margin:0;"><option value="">全部状态</option><option value="0">未导出</option><option value="1">已导出</option></select>
        <button id="btn-b-search" class="secondary" style="flex:0 0 auto;">查询明细</button>
      </div>
      
      <div style="display:flex; align-items:center; background:#fafafa; padding:8px 12px; border-radius:4px; border:1px solid #ebeef5;">
        <span style="font-size:13px; color:#666; margin-right:8px;">统计区间：</span>
        <input id="stat-start" type="date" style="width:130px; margin:0; padding:4px 8px;" />
        <span style="font-size:13px; color:#666; margin:0 8px;">至</span>
        <input id="stat-end" type="date" style="width:130px; margin:0; padding:4px 8px;" />
        <div id="stat-result-display" style="flex:1; padding-left:16px; margin-left:16px; border-left:1px solid #ddd;"></div>
        <button id="btn-stat" class="secondary" style="flex:0 0 auto;">统计箱数</button>
      </div>
    </div>

    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table>
        <thead><tr><th>ID</th><th>来源单号</th><th>类型</th><th>厂编</th><th>厂商名称</th><th>仓库</th><th>商品</th><th>数量</th><th>已导出</th><th>时间</th><th>操作</th></tr></thead>
        <tbody id="b-body"></tbody>
      </table>
    </div>
    <div id="admin-edit-bill-panel"></div>`

  document.getElementById('btn-export').onclick = async () => {
    const warehouse_code = document.getElementById('exp-wh').value
    const start_date = document.getElementById('exp-start').value
    const end_date = document.getElementById('exp-end').value
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/export-bills`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ warehouse_code, start_date, end_date, include_exported: document.getElementById('exp-include')?.checked || false })
    })
    if (!res.ok) {
      const txt = await res.text()
      let msgText = '导出失败'
      try { msgText = ctx.translateError(JSON.parse(txt).error || '导出失败') } catch (e) {}
      return document.getElementById('export-msg').innerHTML = ctx.msg(msgText, false)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `export_${Date.now()}.xlsx`; a.click()
    document.getElementById('export-msg').innerHTML = ctx.msg('导出成功', true)
    await logOp('export_bills', '导出 ' + warehouse_code, { start_date, end_date })
  }

  const search = async () => {
    document.getElementById('b-body').innerHTML = '<tr><td colspan="11" style="text-align:center;">查询中...</td></tr>'
    let q = ctx.supabase.from('bill_order').select('*').order('id', { ascending: false }).limit(200)
    const kw = document.getElementById('b-search').value.trim()
    const wh = document.getElementById('b-wh').value
    const ex = document.getElementById('b-exported').value
    if (kw) q = q.or(`vendor_code.ilike.%${kw}%,source_no.ilike.%${kw}%,product_code.ilike.%${kw}%`)
    if (wh) q = q.eq('warehouse_code', wh)
    if (ex === '0') q = q.eq('exported', false)
    if (ex === '1') q = q.eq('exported', true)
    const { data } = await q
    
    document.getElementById('b-body').innerHTML = (data||[]).map(b => `<tr>
      <td>${b.id}</td><td>${b.source_no||''}</td><td>${b.bill_type||''}</td>
      <td>${b.vendor_code||''}</td><td>${vMap[b.vendor_code] || ''}</td>
      <td>${b.warehouse_name||b.warehouse_code||''}</td><td>${b.product_code||''}</td><td>${b.quantity||''}</td>
      <td>${b.exported ? '是' : '否'}</td><td>${new Date(b.created_at).toLocaleString()}</td>
      <td>
        <button class="small secondary" data-act="edit-bill" data-id="${b.id}">修改</button>
        ${isSuper() ? `<button class="small danger" data-act="del-bill" data-id="${b.id}">删除</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="11">无数据</td></tr>'

    document.querySelectorAll('#b-body button[data-act]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.id)
        const b = (data||[]).find(x => x.id === id)
        if (!b) return
        if (btn.dataset.act === 'edit-bill') {
          const panel = document.getElementById('admin-edit-bill-panel')
          panel.innerHTML = `
            <div class="card" style="border:2px solid #1677ff; margin-top:12px; padding:16px;">
              <h2>修改单据 #${id}</h2>
              <div id="ae-bill-msg"></div>
              <div class="row">
                <div><label>商品代码 *</label><input id="ab-product" value="${b.product_code||''}" /></div>
                <div><label>包装规格 *</label><input id="ab-spec" value="${b.spec||''}" /></div>
                <div><label>数量 *</label><input id="ab-qty" type="number" value="${b.quantity||''}" /></div>
              </div>
              <div class="row">
                <div><label>货主代码</label><input id="ab-owner" value="${b.owner_code||''}" /></div>
                <div><label>到货日期</label><input id="ab-arrival" type="date" value="${b.arrival_date||''}" /></div>
                <div><label>到效日期</label><input id="ab-effective" type="date" value="${b.effective_date||''}" /></div>
              </div>
              <div class="row"><div><label>备注</label><input id="ab-remark" value="${b.remark||''}" /></div></div>
              <button id="btn-save-ab">保存</button>
              <button class="secondary" id="btn-cancel-ab">取消</button>
            </div>`
          document.getElementById('btn-cancel-ab').onclick = () => panel.innerHTML = ''
          document.getElementById('btn-save-ab').onclick = async () => {
            const msgEl = document.getElementById('ae-bill-msg')
            const patch = {
              product_code: document.getElementById('ab-product').value.trim(),
              spec: document.getElementById('ab-spec').value.trim(),
              quantity: Number(document.getElementById('ab-qty').value),
              owner_code: document.getElementById('ab-owner').value.trim(),
              arrival_date: document.getElementById('ab-arrival').value || null,
              effective_date: document.getElementById('ab-effective').value || null,
              remark: document.getElementById('ab-remark').value.trim()
            }
            if (!patch.product_code || !patch.spec || !patch.quantity) return msgEl.innerHTML = ctx.msg('必填项不能为空', false)
            const { error } = await ctx.supabase.from('bill_order').update(patch).eq('id', id)
            if (error) return msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
            await logOp('update_bill', '修改单据 ' + id)
            panel.innerHTML = ''; await search()
          }
        }
        if (btn.dataset.act === 'del-bill') {
          if (!confirm(`确定删除单据 #${id} 吗？`)) return
          btn.disabled = true; btn.innerText = '删除中...'
          ;(async () => {
            try {
              const { data: { session } } = await ctx.supabase.auth.getSession()
              const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/delete-bill`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
                body: JSON.stringify({ bill_id: id })
              })
              if (!res.ok) { alert('删除失败'); btn.disabled = false; btn.innerText = '删除'; return }
              await logOp('delete_bill', '删除单据 ' + id)
              await search()
            } catch (err) { alert('网络异常'); btn.disabled = false; btn.innerText = '删除' }
          })()
        }
      }
    })
  }
  document.getElementById('btn-b-search').onclick = search
  document.getElementById('btn-stat').onclick = async () => {
    const start = document.getElementById('stat-start').value
    const end = document.getElementById('stat-end').value
    if (!start || !end) return alert('请选择完整的开始和结束日期')
    const btn = document.getElementById('btn-stat')
    const displayBox = document.getElementById('stat-result-display')
    btn.innerText = '统计中...'; btn.disabled = true
    const { data, error } = await ctx.supabase.from('bill_order').select('bill_type, spec, quantity').gte('created_at', start + 'T00:00:00+08:00').lte('created_at', end + 'T23:59:59+08:00')
    btn.innerText = '统计箱数'; btn.disabled = false
    if (error) return displayBox.innerHTML = `<span style="color:#cf1322;font-size:13px;">${ctx.translateError(error.message)}</span>`
    let totalIn = 0, totalOut = 0
    ;(data||[]).forEach(b => {
      const boxes = Math.round(b.quantity / (Number(String(b.spec || '1').split('*').pop()) || 1))
      if (b.bill_type.includes('入库')) totalIn += boxes; else totalOut += boxes
    })
    displayBox.innerHTML = `<span style="color:#666;font-size:13px;">入库：</span><span style="color:#1677ff;font-weight:bold;font-size:16px;">${totalIn}</span><span style="color:#666;font-size:13px;">箱 | 出库：</span><span style="color:#d46b08;font-weight:bold;font-size:16px;">${totalOut}</span><span style="color:#666;font-size:13px;">箱</span>`
  }
  search()
}

// ================= 3. 厂商管理 =================
async function renderVendors(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data: vpsRaw } = await ctx.supabase.from('vendor_profile').select('*').eq('account_type', 'vendor').order('created_at', { ascending: false })
  const { data: adminList } = await ctx.supabase.from('admin_users').select('id')
  const adminIdSet = new Set((adminList||[]).map(a => a.id))
  const vps = (vpsRaw||[]).filter(p => !adminIdSet.has(p.id) && !(p.vendor_code || '').startsWith('ADMIN_'))

  const { data: vws } = await ctx.supabase.from('vendor_warehouse').select('*')
  const vwMap = {}
  ;(vws||[]).forEach(x => { (vwMap[x.vendor_id] ||= []).push(x.warehouse_code) })

  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row" style="margin-bottom:12px;">
        <input id="v-code" placeholder="厂编 *" style="flex:1;" />
        <input id="v-name" placeholder="厂商名称 *" style="flex:2;" />
        <input id="v-contact" placeholder="联系人 *" style="flex:1;" />
        <input id="v-phone" placeholder="手机号 *" style="flex:1;" />
        <input id="v-pwd" placeholder="初始密码 *" style="flex:1;" />
      </div>
      <div class="row" style="margin-bottom:12px;">
        <select id="v-type" style="flex:1;">
          <option value="stock">留库厂商</option>
          <option value="cross">越库厂商</option>
        </select>
        <select id="v-wh" multiple style="flex:2; height:80px;">
          ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
        </select>
        <button id="btn-create-vendor" style="flex:1;">创建厂商</button>
      </div>
      <div id="vendor-msg"></div>
      
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
        <span style="font-size:16px; font-weight:bold;">厂商列表（<span id="v-total-count">${vps.length}</span>）</span>
        <div style="display:flex; align-items:center; gap:8px; width:300px;">
          <input id="v-search" placeholder="搜索厂编/名称/联系人" style="margin:0;" />
        </div>
      </div>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table>
        <thead><tr><th>厂编</th><th>名称</th><th>类型</th><th>联系人</th><th>手机</th><th>授权仓库</th><th>状态</th><th>操作</th></tr></thead>
        <tbody id="v-table-body"></tbody>
      </table>
    </div>
    <div id="vendor-edit-panel"></div>`

  const renderVendorTable = (keyword = '') => {
    const kw = keyword.toLowerCase().trim()
    const filtered = vps.filter(p => {
      const whsStr = (vwMap[p.id] || []).join(', ').toLowerCase()
      return (p.vendor_code || '').toLowerCase().includes(kw) || (p.vendor_name || '').toLowerCase().includes(kw) ||
             (p.contact_name || '').toLowerCase().includes(kw) || (p.contact_phone || '').includes(kw) || whsStr.includes(kw)
    })
    document.getElementById('v-total-count').innerText = kw ? `${filtered.length}/${vps.length}` : vps.length
    
    document.getElementById('v-table-body').innerHTML = filtered.map(p => `<tr>
      <td>${p.vendor_code||''}</td>
      <td>${p.vendor_name||''}</td>
      <td>${p.vendor_type === 'cross' ? '<span class="stat" style="background:#fff7e6;color:#d46b08;border:1px solid #ffd591;">越库</span>' : '<span class="stat" style="background:#e6f4ff;color:#1677ff;border:1px solid #91caff;">留库</span>'}</td>
      <td>${p.contact_name||''}</td>
      <td>${p.contact_phone||''}</td>
      <td>${(vwMap[p.id]||[]).join(', ')||'-'}</td>
      <td>${p.status===1?'<span class="stat ok">启用</span>':'<span class="stat no">禁用</span>'}</td>
      <td>
        <button class="small secondary" data-act="toggle-type" data-id="${p.id}" data-type="${p.vendor_type}">切为${p.vendor_type === 'cross' ? '留库' : '越库'}</button>
        <button class="small secondary" data-act="toggle" data-id="${p.id}" data-enable="${p.status===1?'0':'1'}">${p.status===1?'禁用':'启用'}</button>
        <button class="small secondary" data-act="reset" data-id="${p.id}" data-code="${p.vendor_code}">重置密码</button>
        ${isSuper() ? `<button class="small danger" data-act="del" data-id="${p.id}" data-code="${p.vendor_code}">删除</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无匹配数据</td></tr>'
    
    bindTableActions()
  }

  const bindTableActions = () => {
    v.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id; const act = b.dataset.act
        if (act === 'toggle-type') {
          const newType = b.dataset.type === 'cross' ? 'stock' : 'cross'
          if (!confirm(`确定将此厂商切换为${newType === 'cross' ? '越库' : '留库'}吗？`)) return
          await ctx.supabase.from('vendor_profile').update({ vendor_type: newType }).eq('id', id)
          await logOp('update_vendor', '切换厂商类型', { id, newType })
          renderTab('vendors'); return
        }
        if (act === 'toggle') {
          const enable = b.dataset.enable === '1'
          if (!confirm(`确定${enable ? '启用' : '禁用'}该厂商？`)) return
          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/toggle-user-status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ user_id: id, account_type: 'vendor', enable })
          })
          if (res.ok) { await logOp('toggle_vendor', '厂商状态变更', { enable }); renderTab('vendors') }
          else alert('操作失败')
          return
        }
        if (act === 'reset') {
          const pwd = prompt('输入新密码（至少 6 位）')
          if (!pwd || pwd.length < 6) return alert('密码太短')
          const { data: { session } } = await ctx.supabase.auth.getSession()
          await fetch(`${ctx.SUPABASE_URL}/functions/v1/reset-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ user_id: id, new_password: pwd })
          })
          alert('重置成功'); return
        }
        if (act === 'del') {
          if (!confirm(`确定删除厂商「${b.dataset.code}」？不可撤销！`)) return
          const { data: { session } } = await ctx.supabase.auth.getSession()
          await fetch(`${ctx.SUPABASE_URL}/functions/v1/delete-vendor`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ vendor_id: id })
          })
          renderTab('vendors'); return
        }
      }
    })
  }

  document.getElementById('v-search').oninput = (e) => renderVendorTable(e.target.value)
  renderVendorTable()

  document.getElementById('btn-create-vendor').onclick = async () => {
    const whsSel = Array.from(document.getElementById('v-wh').selectedOptions).map(o => o.value)
    const code = document.getElementById('v-code').value.trim()
    const name = document.getElementById('v-name').value.trim()
    const contact = document.getElementById('v-contact').value.trim()
    const phone = document.getElementById('v-phone').value.trim()
    const pwd = document.getElementById('v-pwd').value
    const type = document.getElementById('v-type').value
    if (!code || !name || !contact || !phone || !pwd) return document.getElementById('vendor-msg').innerHTML = ctx.msg('必填项不能为空', false)
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/create-vendor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ vendor_code: code, vendor_name: name, contact_name: contact, contact_phone: phone, password: pwd, warehouse_codes: whsSel, vendor_type: type })
    })
    if (res.ok) { document.getElementById('vendor-msg').innerHTML = ctx.msg('创建成功', true); setTimeout(() => renderTab('vendors'), 1000) }
    else document.getElementById('vendor-msg').innerHTML = ctx.msg('创建失败', false)
  }
}

// ================= 4. 物流商管理 =================
async function renderLogistics(v) {
  const { data: vps } = await ctx.supabase.from('vendor_profile').select('*').eq('account_type', 'logistics').order('created_at', { ascending: false })
  const { data: lvs } = await ctx.supabase.from('logistics_vendor').select('*')
  const lvMap = {}
  ;(lvs||[]).forEach(x => { (lvMap[x.logistics_id] ||= []).push(x.vendor_code) })

  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row" style="margin-bottom:12px;">
        <input id="lg-code" placeholder="编号 (999开头)" style="flex:1;" />
        <input id="lg-name" placeholder="物流商名称" style="flex:2;" />
        <input id="lg-pwd" placeholder="初始密码" style="flex:1;" />
        <button id="btn-create-logistics" style="flex:1;">创建物流商</button>
      </div>
      <div id="lg-msg"></div>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table>
        <thead><tr><th>编号</th><th>名称</th><th>负责厂商</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${(vps||[]).map(p => `<tr>
          <td>${p.vendor_code||''}</td>
          <td>${p.vendor_name||''}</td>
          <td style="font-size:12px;color:#666;">${(lvMap[p.id]||[]).join(', ')||'-'}</td>
          <td>${p.status===1?'<span class="stat ok">启用</span>':'<span class="stat no">禁用</span>'}</td>
          <td>
            <button class="small secondary" data-act="reset" data-id="${p.id}">重置密码</button>
            ${isSuper() ? `<button class="small danger" data-act="del" data-id="${p.id}" data-code="${p.vendor_code}">删除</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="5">无数据</td></tr>'}</tbody>
      </table>
    </div>`

  document.getElementById('btn-create-logistics').onclick = async () => {
    const code = document.getElementById('lg-code').value.trim()
    const name = document.getElementById('lg-name').value.trim()
    const pwd = document.getElementById('lg-pwd').value
    if (!code || !name || !pwd) return document.getElementById('lg-msg').innerHTML = ctx.msg('必填项不能为空', false)
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/create-logistics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ logistics_code: code, logistics_name: name, password: pwd, vendor_codes: [] })
    })
    if (res.ok) { document.getElementById('lg-msg').innerHTML = ctx.msg('创建成功', true); setTimeout(() => renderTab('logistics'), 1000) }
    else document.getElementById('lg-msg').innerHTML = ctx.msg('创建失败', false)
  }

  v.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id
      if (b.dataset.act === 'reset') {
        const pwd = prompt('输入新密码（至少 6 位）')
        if (!pwd || pwd.length < 6) return alert('密码太短')
        const { data: { session } } = await ctx.supabase.auth.getSession()
        await fetch(`${ctx.SUPABASE_URL}/functions/v1/reset-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ user_id: id, new_password: pwd })
        })
        alert('重置成功'); return
      }
      if (b.dataset.act === 'del') {
        if (!confirm(`确定删除物流商「${b.dataset.code}」？`)) return
        const { data: { session } } = await ctx.supabase.auth.getSession()
        await fetch(`${ctx.SUPABASE_URL}/functions/v1/delete-logistics`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ logistics_id: id })
        })
        renderTab('logistics')
      }
    }
  })
}

// ================= 5. 管理员管理 =================
async function renderAdmins(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data: admins } = await ctx.supabase.from('admin_users').select('*').order('created_at', { ascending: false })

  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>创建管理员</h2>
      <div class="row">
        <input id="ad-login" placeholder="登录名（英文）*" />
        <input id="ad-name" placeholder="姓名 *" />
        <input id="ad-phone" placeholder="手机号" />
        <input id="ad-pwd" placeholder="初始密码 *" />
      </div>
      <div class="row">
        <select id="ad-role">
          <option value="admin">管理员</option>
          <option value="assistant">助理</option>
          <option value="super_admin">超级管理员</option>
        </select>
        <select id="ad-wh" multiple style="height:80px;">
          ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
        </select>
      </div>
      <button id="btn-create-admin">创建管理员</button>
      <div id="admin-create-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>管理员列表（${(admins||[]).length}）</h2>
      <div class="scroll">
        <table>
          <tr><th>姓名</th><th>手机</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
          <tbody>${(admins||[]).map(a => `<tr>
            <td>${a.name || ''}</td>
            <td>${a.phone || ''}</td>
            <td>${a.role === 'super_admin' ? '超管' : a.role === 'admin' ? '管理员' : '助理'}</td>
            <td>${a.status===1?'<span class="stat ok">启用</span>':'<span class="stat no">禁用</span>'}</td>
            <td>${a.created_at ? new Date(a.created_at).toLocaleString() : ''}</td>
            <td>
              <button class="small secondary" data-act="edit" data-id="${a.id}">修改</button>
              <button class="small secondary" data-act="toggle" data-id="${a.id}" data-enable="${a.status===1?'0':'1'}" data-name="${a.name||''}">${a.status===1?'禁用':'启用'}</button>
              <button class="small secondary" data-act="pwd" data-id="${a.id}" data-name="${a.name||''}">重置密码</button>
              ${isSuper() ? `<button class="small danger" data-act="del" data-id="${a.id}" data-name="${a.name||''}">删除</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="6">无数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div id="admin-edit-panel"></div>`

  document.getElementById('btn-create-admin').onclick = async () => {
    const elLogin = document.getElementById('ad-login')
    const elName = document.getElementById('ad-name')
    const elPhone = document.getElementById('ad-phone')
    const elPwd = document.getElementById('ad-pwd')
    const elRole = document.getElementById('ad-role')
    const elWh = document.getElementById('ad-wh')
    const msgEl = document.getElementById('admin-create-msg')

    const login = (elLogin.value || '').trim()
    const name = (elName.value || '').trim()
    const phone = (elPhone?.value || '').trim()
    const pwd = elPwd.value || ''
    const role = elRole?.value || 'admin'
    const whSel = elWh ? Array.from(elWh.selectedOptions).map(o => o.value) : []

    if (!login) { msgEl.innerHTML = ctx.msg('请填写登录名', false); return }
    if (!name) { msgEl.innerHTML = ctx.msg('请填写姓名', false); return }
    if (!pwd) { msgEl.innerHTML = ctx.msg('请填写初始密码', false); return }
    if (!/^[a-zA-Z0-9_]+$/.test(login)) {
      msgEl.innerHTML = ctx.msg('登录名只能用字母、数字、下划线', false); return
    }
    if (pwd.length < 6) { msgEl.innerHTML = ctx.msg('密码至少 6 位', false); return }

    msgEl.innerHTML = ctx.msg('创建中...', true)

    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/create-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ login_name: login, password: pwd, name, phone, role, warehouse_codes: whSel })
    })
    const json = await res.json()
    if (res.ok) {
      msgEl.innerHTML = ctx.msg(`创建成功，登录邮箱：${json.email}`, true)
      await logOp('create_admin', '管理员 ' + name, { role })
      renderTab('admins')
    } else {
      msgEl.innerHTML = ctx.msg(ctx.translateError(json.error || '创建失败'), false)
    }
  }

  v.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id
      const act = b.dataset.act
      const nameAttr = b.dataset.name

      if (act === 'edit') {
        const a = admins.find(x => x.id === id)
        if (!a) return
        const panel = document.getElementById('admin-edit-panel')
        panel.innerHTML = `
          <div class="card" style="border:2px solid #1677ff;">
            <h2>修改管理员 · ${a.name||''}</h2>
            <div id="ae-msg"></div>
            <div class="row">
              <div><label>姓名 *</label><input id="ae-name" value="${a.name||''}" /></div>
              <div><label>手机</label><input id="ae-phone" value="${a.phone||''}" /></div>
              <div>
                <label>角色 *</label>
                <select id="ae-role">
                  <option value="admin" ${a.role==='admin'?'selected':''}>管理员</option>
                  <option value="assistant" ${a.role==='assistant'?'selected':''}>助理</option>
                  <option value="super_admin" ${a.role==='super_admin'?'selected':''}>超级管理员</option>
                </select>
              </div>
            </div>
            <button id="btn-ae-save">保存</button>
            <button class="secondary" id="btn-ae-cancel">取消</button>
          </div>`
        document.getElementById('btn-ae-cancel').onclick = () => panel.innerHTML = ''
        document.getElementById('btn-ae-save').onclick = async () => {
          const msgEl = document.getElementById('ae-msg')
          const name = document.getElementById('ae-name').value.trim()
          const phone = document.getElementById('ae-phone').value.trim()
          const role = document.getElementById('ae-role').value
          if (!name) { msgEl.innerHTML = ctx.msg('姓名为必填', false); return }
          if (!['admin','assistant','super_admin'].includes(role)) {
            msgEl.innerHTML = ctx.msg('角色不合法', false); return
          }
          const { error } = await ctx.supabase.from('admin_users')
            .update({ name, phone: phone || null, role })
            .eq('id', id)
          if (error) {
            msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false); return
          }
          await logOp('update_admin', '管理员 ' + name, { fields: ['name','phone','role'] })
          alert('已保存')
          renderTab('admins')
        }
        return
      }

      if (act === 'toggle') {
        const enable = b.dataset.enable === '1'
        const action = enable ? '启用' : '禁用'
        if (id === ctx.currentUser.id) return alert('不能禁用自己的账号')
        if (!confirm(`确定${action}该管理员？`)) return
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/toggle-user-status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ user_id: id, account_type: 'admin', enable })
        })
        const json = await res.json()
        if (res.ok) {
          await logOp('toggle_admin', '管理员 ' + nameAttr, { enable })
          alert(`已${action}`)
          renderTab('admins')
        } else {
          alert(`${action}失败：` + ctx.translateError(json.error || '未知错误'))
        }
        return
      }

      if (act === 'pwd') {
        const pwd = prompt('输入新密码（至少 6 位）')
        if (!pwd || pwd.length < 6) return alert('密码太短')
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/reset-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ user_id: id, new_password: pwd })
        })
        if (res.ok) {
          await logOp('reset_admin_pwd', '管理员 ' + nameAttr)
          alert('重置成功')
        } else {
          alert('重置失败，请重试')
        }
        return
      }

      if (act === 'del') {
        if (id === ctx.currentUser.id) return alert('不能删除自己')
        if (!confirm(`确定删除管理员「${nameAttr}」？`)) return
        const { error } = await ctx.supabase.from('admin_users').delete().eq('id', id)
        if (error) return alert(ctx.translateError(error.message))
        await ctx.supabase.from('vendor_profile').delete().eq('id', id)
        await logOp('delete_admin', '管理员 ' + nameAttr)
        alert('已删除')
        renderTab('admins')
      }
    }
  })
}

// ================= 6. 基础数据 =================
async function renderBase(v) {
  v.innerHTML = `
    <div class="tabs" id="base-tabs" style="flex:0 0 auto;">
      <button data-t="wh" class="active">仓库</button>
      <button data-t="store">门店</button>
      <button data-t="product">商品主数据</button>
      <button data-t="deadline">预约时间段</button>
      <button data-t="holiday">节假日</button>
      <button data-t="bypass">强制放行</button>
    </div>
    <div id="base-view" style="flex:1; overflow:hidden; display:flex; flex-direction:column;"></div>`
  document.querySelectorAll('#base-tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#base-tabs button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      renderBaseSub(b.dataset.t)
    }
  })
  renderBaseSub('wh')
}

async function renderBaseSub(key) {
  const v = document.getElementById('base-view')
  v.innerHTML = '加载中...'
  if (key === 'wh') return renderWh(v)
  if (key === 'store') return renderStore(v)
  if (key === 'product') return renderProduct(v)
  if (key === 'deadline') return renderDeadline(v)
  if (key === 'holiday') return renderHoliday(v)
  if (key === 'bypass') return renderBypass(v)
}

// ===== 5.1 仓库（三块合一） =====
async function renderWh(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').order('warehouse_code')
  const list = whs || []
  let selectedCode = list.length ? list[0].warehouse_code : null

  const renderAll = async () => {
    const sel = list.find(w => w.warehouse_code === selectedCode)
    let locs = []
    let maps = []
    if (selectedCode) {
      const { data: l } = await ctx.supabase.from('location_config_detail').select('*').eq('warehouse_code', selectedCode).order('location_code')
      locs = l || []
      const { data: m } = await ctx.supabase.from('location_warehouse_map').select('*').eq('warehouse_code', selectedCode).order('location_code')
      maps = m || []
    }

    v.innerHTML = `
      <div style="flex:0 0 auto; margin-bottom:12px;">
        <h3>仓库管理</h3>
        <div class="row" style="margin-bottom:12px;">
          <input id="w-code" placeholder="仓库代码 *" style="flex:1;" />
          <input id="w-name" placeholder="仓库名称 *" style="flex:2;" />
          <input id="w-region" placeholder="区域" style="flex:1;" />
          <button id="btn-w-add" style="flex:1;">新增</button>
        </div>
        <div id="w-msg"></div>
      </div>
      
      <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px; margin-bottom:16px; max-height:200px;">
        <table>
          <tr><th>代码</th><th>名称</th><th>区域</th><th>默认门店</th><th>状态</th><th>操作</th></tr>
          <tbody>${list.map(r=>`<tr ${r.warehouse_code===selectedCode?'style="background:#e6f4ff;"':''}>
            <td><a href="javascript:;" data-pick-wh="${r.warehouse_code}" style="color:#1677ff; font-weight:bold;">${r.warehouse_code}</a></td>
            <td>${r.warehouse_name}</td><td>${r.region||''}</td>
            <td>${r.default_store_code||'-'}</td>
            <td>${r.status===1?'启用':'停用'}</td>
            <td>${isSuper() ? `<button class="small danger" data-del-wh="${r.id}" data-code="${r.warehouse_code}">删除</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>

      <div class="row" style="margin-bottom:16px;">
        <div style="flex:1; background:#fafafa; padding:16px; border-radius:4px; border:1px solid #ebeef5;">
          <h3>当前仓库仓位：${sel ? sel.warehouse_code : '未选择'}</h3>
          <div class="row" style="margin-bottom:12px;">
            <input id="l-code" placeholder="仓位代码 *" style="flex:1;" />
            <input id="l-name" placeholder="仓位名称" style="flex:1;" />
            <button id="btn-l-add" style="flex:0 0 auto;">新增仓位</button>
          </div>
          <div id="l-msg"></div>
          <div class="scroll" style="max-height:200px; border:1px solid #ebeef5; background:#fff;">
            <table>
              <tr><th>仓位代码</th><th>名称</th><th>操作</th></tr>
              <tbody>${locs.map(r=>`<tr>
                <td>${r.location_code}</td><td>${r.location_name||''}</td>
                <td>${isSuper() ? `<button class="small danger" data-del-loc="${r.id}" data-code="${r.location_code}">删除</button>` : ''}</td>
              </tr>`).join('') || '<tr><td colspan="3">无数据</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div style="flex:1; background:#fafafa; padding:16px; border-radius:4px; border:1px solid #ebeef5;">
          <h3>仓位映射（只读）</h3>
          <div class="scroll" style="max-height:200px; border:1px solid #ebeef5; background:#fff;">
            <table>
              <tr><th>仓位代码</th><th>仓库代码</th><th>仓库名称</th></tr>
              <tbody>${maps.map(r=>`<tr>
                <td>${r.location_code}</td><td>${r.warehouse_code}</td><td>${r.warehouse_name||''}</td>
              </tr>`).join('') || '<tr><td colspan="3">无数据</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`

    v.querySelectorAll('[data-pick-wh]').forEach(a => { a.onclick = () => { selectedCode = a.dataset.pickWh; renderAll() } })

    document.getElementById('btn-w-add').onclick = async () => {
      const code = document.getElementById('w-code').value.trim()
      const name = document.getElementById('w-name').value.trim()
      const region = document.getElementById('w-region').value.trim() || null
      if (!code || !name) return
      const { error } = await ctx.supabase.from('warehouse').insert({ warehouse_code: code, warehouse_name: name, region })
      if (error) return document.getElementById('w-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      await logOp('create_warehouse', '仓库 ' + code)
      document.getElementById('w-msg').innerHTML = ctx.msg('已新增', true)
      renderWh(v)
    }

    document.getElementById('btn-l-add').onclick = async () => {
      if (!selectedCode) return
      const code = document.getElementById('l-code').value.trim()
      const name = document.getElementById('l-name').value.trim() || null
      if (!code) return
      const { error } = await ctx.supabase.from('location_config').insert({ warehouse_code: selectedCode, location_code: code, location_name: name, created_by: ctx.operatorName })
      if (error) return document.getElementById('l-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      await ctx.supabase.from('location_warehouse_map').insert({ location_code: code, warehouse_code: selectedCode, warehouse_name: sel?.warehouse_name || null })
      await logOp('create_location', '仓位 ' + selectedCode + '/' + code)
      document.getElementById('l-msg').innerHTML = ctx.msg('已新增', true)
      renderAll()
    }

    v.querySelectorAll('[data-del-wh]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.delWh; const code = b.dataset.code
        const { data: cnt } = await ctx.supabase.from('location_config').select('id').eq('warehouse_code', code).limit(1)
        if (cnt && cnt.length) return alert('该仓库下还有仓位，请先删除仓位')
        if (!confirm('确定删除该仓库？')) return
        await ctx.supabase.from('warehouse').delete().eq('id', id)
        await logOp('delete_warehouse', '仓库 ' + code)
        renderWh(v)
      }
    })

    v.querySelectorAll('[data-del-loc]').forEach(b => {
      b.onclick = async () => {
        const code = b.dataset.code
        if (!confirm('确定删除该仓位？')) return
        await ctx.supabase.from('location_config').delete().eq('id', b.dataset.delLoc)
        await logOp('delete_location', '仓位 ' + code)
        renderAll()
      }
    })
  }
  renderAll()
}

// ===== 5.2 门店 =====
async function renderStore(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data } = await ctx.supabase.from('store_config_detail').select('*')
  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row" style="margin-bottom:12px;">
        <select id="s-wh" style="flex:1;"><option value="">全部仓库</option>${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <input id="s-code" placeholder="门店代码 *" style="flex:1;" />
        <input id="s-name" placeholder="门店名称" style="flex:2;" />
        <button id="btn-s-add" style="flex:1;">新增</button>
      </div>
      <div id="s-msg"></div>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table><tr><th>仓库</th><th>门店代码</th><th>名称</th><th>单据数</th><th>操作</th></tr>
        <tbody>${(data||[]).map(r=>`<tr>
          <td>${r.warehouse_name||''}</td><td>${r.store_code}</td><td>${r.store_name||''}</td>
          <td>${r.bill_count||0}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-code="${r.store_code}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>`
  document.getElementById('btn-s-add').onclick = async () => {
    const code = document.getElementById('s-code').value.trim()
    if (!code) return
    const { error } = await ctx.supabase.from('store_config').insert({ warehouse_code: document.getElementById('s-wh').value || null, store_code: code, store_name: document.getElementById('s-name').value.trim() || null, created_by: ctx.operatorName })
    if (error) return document.getElementById('s-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
    await logOp('create_store', '门店 ' + code)
    document.getElementById('s-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('store')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      await ctx.supabase.from('store_config').delete().eq('id', b.dataset.del)
      await logOp('delete_store', '门店 ' + b.dataset.code)
      renderBaseSub('store')
    }
  })
}

// ===== 5.3 商品主数据 =====
async function renderProduct(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data } = await ctx.supabase.from('product_master').select('*').order('id', { ascending: false }).limit(200)
  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row" style="margin-bottom:12px;">
        <select id="p-wh" style="flex:1;">${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <input id="p-file" type="file" accept=".xlsx,.xls" style="flex:2;" />
        <button id="btn-p-import" style="flex:1;">Excel 导入</button>
      </div>
      <div id="p-msg"></div>
    </div>
    
    <div style="flex:0 0 auto; margin-bottom:12px; padding:12px; background:#fafafa; border:1px solid #ebeef5; border-radius:4px;">
      <h3 style="margin-bottom:8px;">手动新增商品</h3>
      <div class="row" style="margin-bottom:8px;">
        <select id="pm-wh" style="flex:1;">${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <input id="pm-code" placeholder="商品代码 *" style="flex:1;" />
        <input id="pm-vendor" placeholder="厂编 *" style="flex:1;" />
        <input id="pm-name" placeholder="品名 *" style="flex:1;" />
        <input id="pm-spec" placeholder="规格 * (1*1*X)" style="flex:1;" />
      </div>
      <div class="row" style="margin-bottom:8px;">
        <input id="pm-length" type="number" placeholder="长 (cm) *" style="flex:1;" />
        <input id="pm-width"  type="number" placeholder="宽 (cm) *" style="flex:1;" />
        <input id="pm-height" type="number" placeholder="高 (cm) *" style="flex:1;" />
        <input id="pm-weight" type="number" placeholder="重量 (kg) *" style="flex:1;" />
        <button id="btn-pm-add" style="flex:0 0 auto;">新增商品</button>
      </div>
      <div id="pm-msg"></div>
    </div>

    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table>
        <thead><tr><th>仓库</th><th>商品代码</th><th>商品名称</th><th>规格</th><th>长×宽×高</th><th>重量</th><th>默认厂编</th><th>操作</th></tr></thead>
        <tbody>${(data||[]).map(r=>`<tr>
          <td>${r.warehouse_code||''}</td><td>${r.product_code}</td><td>${r.product_name||''}</td>
          <td>${r.spec||''}</td>
          <td>${r.length ?? ''}×${r.width ?? ''}×${r.height ?? ''} cm</td>
          <td>${r.weight ?? ''} kg</td>
          <td>${r.default_vendor_code||''}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-code="${r.product_code}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`

  document.getElementById('btn-p-import').onclick = async () => {
    const file = document.getElementById('p-file').files[0]
    if (!file) return document.getElementById('p-msg').innerHTML = ctx.msg('请选择文件', false)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const products = rows.map(r => ({
      product_code: r['商品代码'] || r['product_code'],
      product_name: r['商品名称'] || r['商品标识'] || r['product_name'],
      spec: r['包装规格'] || r['spec'],
      length: r['长'] || r['length'],
      width: r['宽'] || r['width'],
      height: r['高'] || r['height'],
      weight: r['重量'] || r['weight'],
      default_vendor_code: r['默认厂编'] || r['default_vendor_code'],
      default_owner_code: r['默认货主'] || r['default_owner_code']
    })).filter(p => p.product_code)
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/import-products`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ warehouse_code: document.getElementById('p-wh').value, products })
    })
    const json = await res.json()
    if (res.ok) {
      let h = ctx.msg(`导入 ${json.count} 条`, true)
      if (json.fail_count > 0) h += `<div style="color:#cf1322;font-size:12px;margin-top:8px;">${json.errors.join('<br>')}</div>`
      document.getElementById('p-msg').innerHTML = h
      setTimeout(() => renderBaseSub('product'), 1000)
    } else {
      document.getElementById('p-msg').innerHTML = ctx.msg(ctx.translateError(json.error || '导入失败'), false)
    }
  }

  document.getElementById('btn-pm-add').onclick = async () => {
    const msgEl = document.getElementById('pm-msg')
    const wh = document.getElementById('pm-wh').value
    const code = document.getElementById('pm-code').value.trim()
    const vendor = document.getElementById('pm-vendor').value.trim()
    const name = document.getElementById('pm-name').value.trim()
    const spec = document.getElementById('pm-spec').value.trim()
    const length = document.getElementById('pm-length').value.trim()
    const width = document.getElementById('pm-width').value.trim()
    const height = document.getElementById('pm-height').value.trim()
    const weight = document.getElementById('pm-weight').value.trim()

    if (!code || !vendor || !name || !spec) return msgEl.innerHTML = ctx.msg('商品代码、厂编、品名、规格为必填', false)
    if (!isValidSpec(spec)) return msgEl.innerHTML = ctx.msg('包装规格格式错误，必须是 1*1*X', false)
    if (!length || !width || !height || !weight) return msgEl.innerHTML = ctx.msg(SIZE_EMPTY_MSG, false)

    const { error } = await ctx.supabase.from('product_master').insert({
      warehouse_code: wh, product_code: code, product_name: name, spec,
      length: Number(length), width: Number(width), height: Number(height), weight: Number(weight),
      default_vendor_code: vendor, default_owner_code: vendor
    })
    if (error) return msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
    await logOp('create_product', '商品 ' + code)
    msgEl.innerHTML = ctx.msg('新增成功', true)
    setTimeout(() => renderBaseSub('product'), 1000)
  }

  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      await ctx.supabase.from('product_master').delete().eq('id', b.dataset.del)
      await logOp('delete_product', '商品 ' + b.dataset.code)
      renderBaseSub('product')
    }
  })
}

// ===== 5.4 预约时间段 =====
async function renderDeadline(v) {
  const { data } = await ctx.supabase.from('deadline_config').select('*').order('id')
  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row">
        <input id="d-vendor" placeholder="厂编（空=全部）" style="flex:1;" />
        <input id="d-wh" placeholder="仓库（空=全部）" style="flex:1;" />
        <select id="d-type" style="flex:1;"><option value="weekday">工作日</option><option value="weekend">周末</option><option value="all">全部</option></select>
        <input id="d-value" placeholder="如 07:00-15:00 *" style="flex:2;" />
        <button id="btn-d-add" style="flex:1;">新增</button>
      </div>
      <div id="d-msg"></div>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table><tr><th>厂编</th><th>仓库</th><th>日类型</th><th>时间段</th><th>操作</th></tr>
        <tbody>${(data||[]).map(r=>`<tr>
          <td>${r.vendor_code||'（全部）'}</td><td>${r.warehouse_code||'（全部）'}</td>
          <td>${r.day_type === 'weekday' ? '工作日' : r.day_type === 'weekend' ? '周末' : '全部'}</td><td>${r.config_value}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-value="${r.config_value}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>`
  document.getElementById('btn-d-add').onclick = async () => {
    const configValue = document.getElementById('d-value').value.trim()
    if (!configValue) return
    const { error } = await ctx.supabase.from('deadline_config').insert({
      vendor_code: document.getElementById('d-vendor').value.trim() || null,
      warehouse_code: document.getElementById('d-wh').value.trim() || null,
      day_type: document.getElementById('d-type').value,
      config_value: configValue, updated_by: ctx.operatorName
    })
    if (error) return document.getElementById('d-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
    await logOp('create_deadline', '预约时间段 ' + configValue)
    document.getElementById('d-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('deadline')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      await ctx.supabase.from('deadline_config').delete().eq('id', b.dataset.del)
      await logOp('delete_deadline', '预约时间段 ' + b.dataset.value)
      renderBaseSub('deadline')
    }
  })
}

// ===== 5.5 节假日 =====
async function renderHoliday(v) {
  const { data } = await ctx.supabase.from('holiday_config').select('*').order('holiday_date')
  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row">
        <input id="h-date" type="date" style="flex:1;" />
        <input id="h-desc" placeholder="说明" style="flex:2;" />
        <button id="btn-h-add" style="flex:1;">新增</button>
      </div>
      <div id="h-msg"></div>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table><tr><th>日期</th><th>说明</th><th>操作</th></tr>
        <tbody>${(data||[]).map(r=>`<tr>
          <td>${r.holiday_date}</td><td>${r.description||''}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-date="${r.holiday_date}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>`
  document.getElementById('btn-h-add').onclick = async () => {
    const date = document.getElementById('h-date').value
    if (!date) return
    const { error } = await ctx.supabase.from('holiday_config').insert({ holiday_date: date, description: document.getElementById('h-desc').value.trim() || null })
    if (error) return document.getElementById('h-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
    await logOp('create_holiday', '节假日 ' + date)
    document.getElementById('h-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('holiday')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      await ctx.supabase.from('holiday_config').delete().eq('id', b.dataset.del)
      await logOp('delete_holiday', '节假日 ' + b.dataset.date)
      renderBaseSub('holiday')
    }
  })
}

// ===== 5.6 强制放行 =====
async function renderBypass(v) {
  const { data } = await ctx.supabase.from('bypass_list').select('*').order('bypass_date', { ascending: false })
  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:12px;">
      <div class="row">
        <input id="b-vendor" placeholder="厂编 *" style="flex:1;" />
        <input id="b-wh" placeholder="仓库（空=全部）" style="flex:1;" />
        <input id="b-date" type="date" style="flex:1;" />
        <input id="b-reason" placeholder="原因" style="flex:2;" />
        <button id="btn-b-add" style="flex:1;">新增</button>
      </div>
      <div id="b-msg"></div>
    </div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table><tr><th>厂编</th><th>仓库</th><th>日期</th><th>原因</th><th>操作</th></tr>
        <tbody>${(data||[]).map(r=>`<tr>
          <td>${r.vendor_code}</td><td>${r.warehouse_code||'（全部）'}</td>
          <td>${r.bypass_date}</td><td>${r.reason||''}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-vendor="${r.vendor_code}" data-date="${r.bypass_date}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>`
  document.getElementById('btn-b-add').onclick = async () => {
    const vendor = document.getElementById('b-vendor').value.trim()
    const date = document.getElementById('b-date').value
    if (!vendor || !date) return
    const { error } = await ctx.supabase.from('bypass_list').insert({
      vendor_code: vendor, warehouse_code: document.getElementById('b-wh').value.trim() || null, bypass_date: date, reason: document.getElementById('b-reason').value.trim() || null, created_by: ctx.operatorName
    })
    if (error) return document.getElementById('b-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
    await logOp('create_bypass', '强制放行 ' + vendor, { bypass_date: date })
    document.getElementById('b-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('bypass')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      await ctx.supabase.from('bypass_list').delete().eq('id', b.dataset.del)
      await logOp('delete_bypass', '强制放行 ' + b.dataset.vendor, { bypass_date: b.dataset.date })
      renderBaseSub('bypass')
    }
  })
}

// ================= 7. 日志 =================
async function renderLogs(v) {
  const { data: ops } = await ctx.supabase.from('operation_log').select('*').order('id', { ascending: false }).limit(200)
  const { data: edits } = await ctx.supabase.from('vendor_edit_log').select('*').order('id', { ascending: false }).limit(200)
  const { data: batches } = await ctx.supabase.from('export_batch_detail').select('*').order('id', { ascending: false }).limit(200)
  const { data: qcs } = await ctx.supabase.from('qc_upload_log').select('*').order('id', { ascending: false }).limit(200)

  v.innerHTML = `
    <div class="tabs" id="log-tabs">
      <button data-t="op" class="active">操作日志</button>
      <button data-t="edit">厂商修改记录</button>
      <button data-t="batch">导出批次</button>
      <button data-t="qc">质检上传记录</button>
    </div>
    <div id="log-view" style="flex:1; overflow:hidden; display:flex; flex-direction:column;"></div>`

  const renderOp = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
        <table><tr><th>操作时间</th><th>操作用户</th><th>操作动作</th><th>目标对象</th><th>详细内容</th></tr>
          <tbody>${(ops||[]).map(r=>`<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.operator_name||''}</td>
            <td>${r.action||''}</td>
            <td>${r.target||''}</td>
            <td><button class="small secondary" data-detail="${r.id}">查看详情</button></td>
          </tr>`).join('') || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody></table>
      </div>
      <div id="log-detail-panel"></div>`
    document.querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.detail)
        const r = (ops||[]).find(x => x.id === id)
        if (!r) return
        const d = r.detail || {}
        let html = `<div class="card" style="margin-top:12px;border:2px solid #1677ff;">
          <h2>详情 · ${r.action}</h2>
          <p style="font-size:13px;color:#666;margin-bottom:8px;">操作人：${r.operator_name||''} ｜ 目标：${r.target||''} ｜ 时间：${new Date(r.created_at).toLocaleString()}</p>`
        if (Array.isArray(d.success_list) || Array.isArray(d.failed_list)) {
          html += `<div style="margin-bottom:8px;"><strong>成功 ${d.success || 0} 条：</strong>${(d.success_list||[]).join(', ') || '无'}</div>`
          html += `<div><strong>失败 ${d.failed || 0} 条：</strong>`
          if ((d.failed_list||[]).length) {
            html += `<table style="margin-top:6px;"><tr><th>厂编</th><th>失败原因</th></tr>${d.failed_list.map(f => `<tr><td>${f.vendor_code||''}</td><td style="color:#cf1322;">${f.error||''}</td></tr>`).join('')}</table>`
          } else html += ' 无'
          html += '</div>'
        } else {
          html += `<pre style="font-size:12px;background:#fafafa;padding:8px;border-radius:4px;overflow:auto;">${JSON.stringify(d, null, 2)}</pre>`
        }
        html += `<button class="secondary" id="btn-close-detail" style="margin-top:8px;">关闭</button></div>`
        document.getElementById('log-detail-panel').innerHTML = html
        document.getElementById('btn-close-detail').onclick = () => { document.getElementById('log-detail-panel').innerHTML = '' }
      }
    })
  }

  const renderEdit = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
        <table><tr><th>修改时间</th><th>单据ID</th><th>厂编</th><th>修改字段</th><th>操作</th></tr>
          <tbody>${(edits||[]).map(r=>`<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.bill_id}</td>
            <td>${r.vendor_code||''}</td>
            <td style="font-size:11px;">${(r.changed_fields||[]).join(', ')}</td>
            <td><button class="small secondary" data-detail="${r.id}">查看详情</button></td>
          </tr>`).join('') || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody></table>
      </div>`
    document.querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.detail)
        const r = (edits||[]).find(x => x.id === id)
        if (!r) return
        const before = r.before_data || {}; const after = r.after_data || {}; const fields = r.changed_fields || []
        let html = `<div class="card" style="margin-top:12px;"><h2>修改详情（单据 #${r.bill_id}）</h2><table><tr><th>字段名</th><th>修改前</th><th>修改后</th></tr>`
        fields.forEach(f => {
          html += `<tr><td>${f}</td><td style="color:#cf1322;">${JSON.stringify(before[f] ?? '')}</td><td style="color:#389e0d;">${JSON.stringify(after[f] ?? '')}</td></tr>`
        })
        html += `</table></div>`
        document.getElementById('log-view').insertAdjacentHTML('beforeend', html)
      }
    })
  }

  const renderBatch = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
        <table><tr><th>批次号</th><th>仓库</th><th>开始日期</th><th>结束日期</th><th>类型</th><th>条数</th><th>操作人</th><th>时间</th></tr>
          <tbody>${(batches||[]).map(r=>`<tr>
            <td>${r.batch_no}</td><td>${r.warehouse_code||''}</td>
            <td>${r.start_date||''}</td><td>${r.end_date||''}</td>
            <td>${r.bill_type||''}</td>
            <td>${r.bill_count_snapshot ?? r.count ?? 0}（实际 ${r.actual_count||0}）</td>
            <td>${r.operator||''}</td><td>${new Date(r.created_at).toLocaleString()}</td>
          </tr>`).join('') || '<tr><td colspan="8">暂无数据</td></tr>'}</tbody></table>
      </div>`
  }

  const renderQC = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
        <table><tr><th>上传时间</th><th>厂编</th><th>厂商名称</th><th>文件名</th><th>操作</th></tr>
          <tbody>${(qcs||[]).map(q=>`<tr>
            <td>${new Date(q.created_at).toLocaleString()}</td>
            <td>${q.vendor_code}</td><td>${q.vendor_name}</td><td>${q.file_name}</td>
            <td><a href="${q.file_key}" target="_blank" style="color:#1677ff;text-decoration:none;">下载 PDF</a></td>
          </tr>`).join('') || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody></table>
      </div>`
  }

  document.querySelectorAll('#log-tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#log-tabs button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      if (b.dataset.t === 'op') renderOp()
      else if (b.dataset.t === 'edit') renderEdit()
      else if (b.dataset.t === 'batch') renderBatch()
      else renderQC()
    }
  })
  renderOp()
}

// ================= 8. 系统配置 =================
const CONFIG_CN = { app_version: '系统版本', app_name: '系统名称', release_notes: '更新说明', release_date: '发布日期', maintenance_mode: '维护模式', cleanup_days: '清理保留天数', cleanup_time: '清理执行时间' }
function formatConfigValue(key, val) {
  if (key === 'maintenance_mode') return val === 'true' ? '开启' : '关闭'
  if (key === 'cleanup_days') return (val || '') + ' 天'
  if (key === 'cleanup_time') return '每天 ' + (val || '')
  return val || ''
}

async function renderSys(v) {
  const { data: cfgs } = await ctx.supabase.from('system_config').select('*').order('config_key')
  const { data: vers } = await ctx.supabase.from('version_history').select('*').order('id', { ascending: false }).limit(50)
  const cfgMap = {}
  ;(cfgs||[]).forEach(x => cfgMap[x.config_key] = x.config_value)
  const cleanupDays = cfgMap.cleanup_days || '7'
  const cleanupTime = cfgMap.cleanup_time || '03:00'
  const isMaintenance = cfgMap.maintenance_mode === 'true'

  v.innerHTML = `
    <div style="flex:0 0 auto; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; background:${isMaintenance ? '#fff2f0' : '#f6ffed'}; border:1px solid ${isMaintenance ? '#ffccc7' : '#b7eb8f'}; padding:16px; border-radius:4px;">
      <div>
        <h3 style="margin:0; color:${isMaintenance ? '#cf1322' : '#389e0d'};">维护模式：${isMaintenance ? '已开启' : '关闭'}</h3>
        <p style="margin:4px 0 0; font-size:13px; color:#666;">开启后，非超管账号将被强制踢出，无法操作。</p>
      </div>
      <button id="btn-toggle-maintenance" style="${isMaintenance ? 'background:#389e0d' : 'background:#ff4d4f'}">${isMaintenance ? '关闭维护' : '开启维护'}</button>
    </div>

    <div style="flex:0 0 auto; margin-bottom:16px; border:2px dashed #91caff; padding:16px; border-radius:4px;">
      <h3>定时清理配置（仅超管）</h3>
      <p style="font-size:12px;color:#666;margin:8px 0;">清理 <strong>${cleanupDays}</strong> 天前已导出单据和质检记录；每天 <strong>${cleanupTime}</strong> 执行。</p>
      <div class="row">
        <div><label>保留天数</label><input id="cleanup-days" type="number" min="1" max="365" value="${cleanupDays}" /></div>
        <div><label>每天执行时间</label><input id="cleanup-time" type="time" value="${cleanupTime}" /></div>
        <button id="btn-save-cleanup" ${isSuper() ? '' : 'disabled'} style="align-self:flex-end;">保存（立即生效）</button>
      </div>
      <div id="cleanup-msg"></div>
    </div>
    
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table><tr><th>配置项</th><th>值</th><th>更新时间</th><th>操作</th></tr>
        <tbody>${(cfgs||[]).map(r=>`<tr>
          <td>${CONFIG_CN[r.config_key] || r.config_key}</td><td>${formatConfigValue(r.config_key, r.config_value)}</td>
          <td>${new Date(r.updated_at).toLocaleString()}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-key="${r.config_key}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>`

  document.getElementById('btn-toggle-maintenance').onclick = async () => {
    const newStatus = isMaintenance ? 'false' : 'true'
    if (!confirm(`确定要${isMaintenance ? '关闭' : '开启'}维护模式吗？`)) return
    await ctx.supabase.from('system_config').upsert({ config_key: 'maintenance_mode', config_value: newStatus }, { onConflict: 'config_key' })
    renderTab('sys')
  }

  document.getElementById('btn-save-cleanup').onclick = async () => {
    if (!isSuper()) return
    const d = Number(document.getElementById('cleanup-days').value)
    const t = document.getElementById('cleanup-time').value
    if (!d || d < 1 || d > 365 || !t) return document.getElementById('cleanup-msg').innerHTML = ctx.msg('参数不合法', false)
    const { error } = await ctx.supabase.rpc('save_cleanup_config', { p_days: d, p_time: t })
    if (error) return document.getElementById('cleanup-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
    document.getElementById('cleanup-msg').innerHTML = ctx.msg('已保存，新配置立即生效', true)
    setTimeout(() => renderTab('sys'), 1000)
  }

  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      await ctx.supabase.from('system_config').delete().eq('id', b.dataset.del)
      renderTab('sys')
    }
  })
}