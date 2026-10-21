// admin.js — 管理后台（2026-10-22 正式上线版）

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
    const { data: au } = await context.supabase.from('admin_users').select('name').eq('id', context.currentUser.id).maybeSingle()
    operatorName = au?.name || context.currentProfile?.contact_name || '管理员'
  } else {
    operatorName = context.currentProfile?.contact_name || context.currentProfile?.vendor_name || '未知'
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
    <div class="card" style="flex:1; margin:0; padding:0; overflow:hidden;">
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

function isSuper() { return ctx.currentRole === 'super_admin' }

async function logOp(action, target, detail = {}) {
  try {
    await ctx.supabase.from('operation_log').insert({ operator_id: ctx.currentUser.id, operator_name: ctx.operatorName, action, target, detail })
  } catch (e) {}
}

// ================= 1. 预约进度 =================
async function renderProgress(v) {
  const { data } = await ctx.supabase.from('vendor_report_status').select('*')
  
  // 查出当天的质检报告记录
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
        <thead>
          <tr>
            <th>厂编</th><th>厂商名称</th><th>类型</th><th>登录状态</th><th>今日预约</th><th>最后活跃</th><th>质检报告</th>
          </tr>
        </thead>
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
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

// ================= 5. 管理员 & 基础数据 & 日志 & 系统 =================
async function renderAdmins(v) { v.innerHTML = '<div class="card">管理员管理面板</div>' }
async function renderBase(v) { v.innerHTML = '<div class="card">基础数据面板</div>' }

async function renderLogs(v) {
  const { data: qcs } = await ctx.supabase.from('qc_upload_log').select('*').order('id', { ascending: false }).limit(100)
  v.innerHTML = `
    <div class="tabs"><button class="active">质检上传记录</button></div>
    <div class="scroll" style="border:1px solid #ebeef5; border-radius:4px;">
      <table>
        <thead><tr><th>上传时间</th><th>厂编</th><th>厂商名称</th><th>文件名</th><th>操作</th></tr></thead>
        <tbody>${(qcs||[]).map(q => `<tr>
          <td>${new Date(q.created_at).toLocaleString()}</td>
          <td>${q.vendor_code}</td><td>${q.vendor_name}</td><td>${q.file_name}</td>
          <td><a href="${q.file_key}" target="_blank" style="color:#1677ff;text-decoration:none;">下载 PDF</a></td>
        </tr>`).join('') || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody>
      </table>
    </div>`
}

async function renderSys(v) {
  const { data: cfgs } = await ctx.supabase.from('system_config').select('*').order('config_key')
  const cfgMap = {}
  ;(cfgs||[]).forEach(x => cfgMap[x.config_key] = x.config_value)
  const isMaintenance = cfgMap.maintenance_mode === 'true'
  v.innerHTML = `
    <div class="row" style="margin-bottom:16px;">
      <div class="card" style="flex:1; margin:0;">
        <h2>维护模式：${isMaintenance ? '已开启' : '关闭'}</h2>
        <button id="btn-maint" style="${isMaintenance ? 'background:#389e0d' : 'background:#ff4d4f'}">${isMaintenance ? '关闭维护' : '开启维护'}</button>
      </div>
    </div>`
  document.getElementById('btn-maint').onclick = async () => {
    await ctx.supabase.from('system_config').upsert({ config_key: 'maintenance_mode', config_value: isMaintenance ? 'false' : 'true' }, { onConflict: 'config_key' })
    renderTab('sys')
  }
}