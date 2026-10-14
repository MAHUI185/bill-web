// admin.js — 管理后台

let ctx = null

export async function renderAdmin(view, context) {
  ctx = context
  view.innerHTML = `
    <div class="card">
      <h2>管理后台</h2>
      <div class="tabs" id="admin-tabs">
        <button data-t="progress" class="active">提报进度</button>
        <button data-t="bills">单据管理</button>
        <button data-t="vendors">厂商管理</button>
        <button data-t="logistics">物流商管理</button>
        <button data-t="admins">管理员管理</button>
        <button data-t="base">基础数据</button>
        <button data-t="rules">提报规则</button>
        <button data-t="batches">导出批次</button>
        <button data-t="logs">操作日志</button>
        <button data-t="sys">系统配置</button>
      </div>
      <div id="admin-view"></div>
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
    if (key === 'rules') return renderRules(v)
    if (key === 'batches') return renderBatches(v)
    if (key === 'logs') return renderLogs(v)
    if (key === 'sys') return renderSys(v)
  } catch (e) {
    v.innerHTML = ctx.msg('加载失败，请刷新重试', false)
  }
}

function isSuper() {
  return ctx.currentRole === 'super_admin'
}

// ================= 1. 提报进度 =================
async function renderProgress(v) {
  const { data } = await ctx.supabase.from('vendor_report_status').select('*')
  v.innerHTML = `
    <div class="row" style="margin-bottom:12px;">
      <input id="p-search" placeholder="搜索厂编/名称" />
      <select id="p-status">
        <option value="">全部</option>
        <option value="reported">今日已提报</option>
        <option value="not">今日未提报</option>
        <option value="nologin">今日未登录</option>
      </select>
    </div>
    <div class="scroll">
      <table>
        <tr>
          <th>厂编</th><th>厂商名称</th><th>仓库</th><th>联系人</th><th>手机</th>
          <th>今日登录</th><th>今日提报</th><th>今日条数</th><th>最后提报</th>
        </tr>
        <tbody id="p-body"></tbody>
      </table>
    </div>`
  const render = () => {
    const kw = (document.getElementById('p-search').value || '').toLowerCase()
    const st = document.getElementById('p-status').value
    let list = data || []
    if (kw) list = list.filter(r =>
      (r.vendor_code || '').toLowerCase().includes(kw) ||
      (r.vendor_name || '').toLowerCase().includes(kw))
    if (st === 'reported') list = list.filter(r => r.reported_today)
    if (st === 'not') list = list.filter(r => !r.reported_today)
    if (st === 'nologin') list = list.filter(r => !r.logged_in_today)
    document.getElementById('p-body').innerHTML = list.map(r => `<tr>
      <td>${r.vendor_code || ''}</td>
      <td>${r.vendor_name || ''}</td>
      <td>${r.warehouse_name || r.warehouse_code || ''}</td>
      <td>${r.contact_name || ''}</td>
      <td>${r.contact_phone || ''}</td>
      <td>${r.logged_in_today ? '<span class="stat ok">已登录</span>' : '<span class="stat no">未登录</span>'}</td>
      <td>${r.reported_today ? '<span class="stat ok">已提报</span>' : '<span class="stat no">未提报</span>'}</td>
      <td>${r.today_count || 0}</td>
      <td>${r.last_report_at ? new Date(r.last_report_at).toLocaleString() : '-'}</td>
    </tr>`).join('') || '<tr><td colspan="9">无数据</td></tr>'
  }
  document.getElementById('p-search').oninput = render
  document.getElementById('p-status').onchange = render
  render()
}

// ================= 2. 单据管理 =================
async function renderBills(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>Excel 导入单据</h2>
      <div class="row">
        <select id="imp-type">
          <option value="vmi_in">VMI入库</option>
          <option value="dsp_in">DSP入库</option>
          <option value="vmi_out">VMI出库</option>
          <option value="dsp_out">DSP出库</option>
        </select>
        <input id="imp-file" type="file" accept=".xlsx,.xls" />
        <button id="btn-import">开始导入</button>
        <button type="button" class="secondary" id="btn-show-rule">查看填写规则</button>
      </div>
      <div id="rule-display" style="display:none;margin-top:12px;padding:12px;background:#fafafa;border-radius:4px;white-space:pre-wrap;font-size:13px;line-height:1.8;"></div>
      <div id="import-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>导出 WMS 模板</h2>
      <div class="row">
        <select id="exp-wh">${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <input id="exp-start" type="date" />
        <input id="exp-end" type="date" />
        <button id="btn-export">导出</button>
        <label style="display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;min-width:auto;">
          <input type="checkbox" id="exp-include" style="width:auto;margin:0;" />
          包含已导出
        </label>
      </div>
      <div id="export-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>单据查询</h2>
      <div class="row">
        <input id="b-search" placeholder="来源单号/商品代码" />
        <select id="b-wh"><option value="">全部仓库</option>${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <select id="b-exported"><option value="">全部</option><option value="0">未导出</option><option value="1">已导出</option></select>
        <button id="btn-b-search" class="secondary">查询</button>
      </div>
      <div class="scroll">
        <table>
          <tr><th>ID</th><th>来源单号</th><th>类型</th><th>厂编</th><th>仓库</th><th>商品</th><th>数量</th><th>已导出</th><th>时间</th></tr>
          <tbody id="b-body"></tbody>
        </table>
      </div>
    </div>`

  document.getElementById('btn-show-rule').onclick = async () => {
    const type = document.getElementById('imp-type').value
    const { data } = await ctx.supabase.from('import_rule')
      .select('rule_text').eq('import_type', type).maybeSingle()
    const el = document.getElementById('rule-display')
    if (el.style.display === 'none') {
      el.textContent = data?.rule_text || '暂无规则说明'
      el.style.display = 'block'
    } else {
      el.style.display = 'none'
    }
  }

  document.getElementById('btn-import').onclick = async () => {
    const file = document.getElementById('imp-file').files[0]
    if (!file) return document.getElementById('import-msg').innerHTML = ctx.msg('请选择文件', false)
    const importType = document.getElementById('imp-type').value
    document.getElementById('import-msg').innerHTML = ctx.msg('导入中...', true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const sheetMap = {
        vmi_in: 'VMI入库', dsp_in: 'DSP入库',
        vmi_out: 'VMI出库', dsp_out: 'DSP出库'
      }
      const sheetName = wb.SheetNames.find(n => n === sheetMap[importType]) ||
                        wb.SheetNames.find(n => {
                          const isOut = importType.endsWith('_out')
                          return isOut ? (n.includes('出库') && !n.includes('说明'))
                                       : (n.includes('入库') && !n.includes('说明'))
                        }) || wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
      const rows = rawRows.filter((r, idx) => {
        if (idx === 1) return false
        const key = String(r['来源单号'] || r['配单类型'] || '')
        if (key.includes('如上') || key.includes('固定') || key.includes('说明')) return false
        return true
      })
      const { data: { session } } = await ctx.supabase.auth.getSession()
      const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/import-bills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          import_type: importType,
          rows,
          operator_name: ctx.currentProfile?.vendor_name || 'admin'
        })
      })
      const json = await res.json()
      if (json.ok) {
        let h = ctx.msg(`成功 ${json.success_count} 条，失败 ${json.fail_count} 条`, true)
        if (json.errors?.length) {
          h += `<div class="scroll" style="font-size:12px;color:#cf1322;">
            ${json.errors.map(e => `<div>${e}</div>`).join('')}</div>`
        }
        document.getElementById('import-msg').innerHTML = h
      } else {
        document.getElementById('import-msg').innerHTML = ctx.msg(
          json.error || `导入失败，请检查文件格式`, false)
      }
    } catch (e) {
      document.getElementById('import-msg').innerHTML = ctx.msg('导入失败，请检查文件格式', false)
    }
  }

  document.getElementById('btn-export').onclick = async () => {
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/export-bills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        warehouse_code: document.getElementById('exp-wh').value,
        start_date: document.getElementById('exp-start').value,
        end_date: document.getElementById('exp-end').value,
        include_exported: document.getElementById('exp-include')?.checked || false
      })
    })
    if (!res.ok) {
      const txt = await res.text()
      let msgText = '导出失败'
      try {
        const j = JSON.parse(txt)
        msgText = ctx.translateError(j.error || '导出失败')
      } catch (e) {}
      document.getElementById('export-msg').innerHTML = ctx.msg(msgText, false)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export_${Date.now()}.xlsx`
    a.click()
    document.getElementById('export-msg').innerHTML = ctx.msg('导出成功', true)
  }

  const search = async () => {
    let q = ctx.supabase.from('bill_order').select('*').order('id', { ascending: false }).limit(200)
    const kw = document.getElementById('b-search').value.trim()
    const wh = document.getElementById('b-wh').value
    const ex = document.getElementById('b-exported').value
    if (kw) q = q.or(`source_no.ilike.%${kw}%,product_code.ilike.%${kw}%`)
    if (wh) q = q.eq('warehouse_code', wh)
    if (ex === '0') q = q.eq('exported', false)
    if (ex === '1') q = q.eq('exported', true)
    const { data } = await q
    document.getElementById('b-body').innerHTML = (data||[]).map(b => `<tr>
      <td>${b.id}</td><td>${b.source_no||''}</td><td>${b.bill_type||''}</td>
      <td>${b.vendor_code||''}</td><td>${b.warehouse_name||b.warehouse_code||''}</td>
      <td>${b.product_code||''}</td><td>${b.quantity||''}</td>
      <td>${b.exported ? '是' : '否'}</td>
      <td>${new Date(b.created_at).toLocaleString()}</td>
    </tr>`).join('') || '<tr><td colspan="9">无数据</td></tr>'
  }
  document.getElementById('btn-b-search').onclick = search
  search()
}

// ================= 3. 厂商管理 =================
async function renderVendors(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data: vpsRaw } = await ctx.supabase.from('vendor_profile')
    .select('*')
    .eq('account_type', 'vendor')
    .order('created_at', { ascending: false })

  const { data: adminList } = await ctx.supabase.from('admin_users').select('id')
  const adminIdSet = new Set((adminList||[]).map(a => a.id))
  const vps = (vpsRaw||[]).filter(p =>
    !adminIdSet.has(p.id) && !(p.vendor_code || '').startsWith('ADMIN_')
  )

  const { data: vws } = await ctx.supabase.from('vendor_warehouse').select('*')
  const vwMap = {}
  ;(vws||[]).forEach(x => { (vwMap[x.vendor_id] ||= []).push(x.warehouse_code) })

  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>创建厂商</h2>
      <div class="row">
        <input id="v-code" placeholder="厂编 *" />
        <input id="v-name" placeholder="厂商名称 *" />
        <input id="v-contact" placeholder="联系人 *" />
        <input id="v-phone" placeholder="手机号 *" />
        <input id="v-pwd" placeholder="初始密码 *" />
      </div>
      <div class="row">
        <select id="v-wh" multiple style="height:80px;">
          ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
        </select>
      </div>
      <button id="btn-create-vendor">创建厂商</button>
      <div id="vendor-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0 0 16px;border:2px dashed #91caff;">
      <h2>批量导入厂商</h2>
      <div class="row">
        <div style="flex:2;">
          <label>选择 Excel 文件（列：厂编 / 厂商名称 / 联系人 / 联系电话）</label>
          <input id="batch-file" type="file" accept=".xlsx,.xls" />
        </div>
      </div>
      <p style="font-size:12px;color:#666;margin:8px 0;">
        统一初始密码：<strong>888888</strong>；授权仓库：<strong>2608</strong>
      </p>
      <button id="btn-batch-import">开始批量导入</button>
      <div id="batch-msg"></div>
      <div id="batch-preview" style="margin-top:12px;"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>厂商列表（${vps.length}）</h2>
      <div class="scroll">
        <table>
          <tr><th>厂编</th><th>名称</th><th>联系人</th><th>手机</th><th>授权仓库</th><th>状态</th><th>操作</th></tr>
          <tbody>${vps.map(p => `<tr>
            <td>${p.vendor_code||''}</td>
            <td>${p.vendor_name||''}</td>
            <td>${p.contact_name||''}</td>
            <td>${p.contact_phone||''}</td>
            <td>${(vwMap[p.id]||[]).join(', ')||'-'}</td>
            <td>${p.status===1?'<span class="stat ok">启用</span>':'<span class="stat no">禁用</span>'}</td>
            <td>
              <button class="small secondary" data-act="edit" data-id="${p.id}">修改</button>
              <button class="small secondary" data-act="toggle" data-id="${p.id}" data-enable="${p.status===1?'0':'1'}">${p.status===1?'禁用':'启用'}</button>
              <button class="small secondary" data-act="grant" data-id="${p.id}" data-code="${p.vendor_code}">授权</button>
              <button class="small secondary" data-act="reset" data-id="${p.id}">重置密码</button>
              ${isSuper() ? `<button class="small danger" data-act="del" data-id="${p.id}" data-code="${p.vendor_code}">删除</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="7">无数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div id="vendor-edit-panel"></div>`

  document.getElementById('btn-create-vendor').onclick = async () => {
    const whSel = document.getElementById('v-wh')
    const whsSel = Array.from(whSel.selectedOptions).map(o => o.value)
    if (!whsSel.length) return document.getElementById('vendor-msg').innerHTML = ctx.msg('请选择授权仓库', false)
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/create-vendor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        vendor_code: document.getElementById('v-code').value.trim(),
        vendor_name: document.getElementById('v-name').value.trim(),
        contact_name: document.getElementById('v-contact').value.trim(),
        contact_phone: document.getElementById('v-phone').value.trim(),
        password: document.getElementById('v-pwd').value,
        warehouse_codes: whsSel
      })
    })
    const json = await res.json()
    document.getElementById('vendor-msg').innerHTML = res.ok
      ? ctx.msg(`创建成功，登录邮箱：${json.email}`, true)
      : ctx.msg(ctx.translateError(json.error), false)
    if (res.ok) renderTab('vendors')
  }

  // ★ 批量导入厂商
  const btnBatchImport = document.getElementById('btn-batch-import')
  if (btnBatchImport) btnBatchImport.onclick = async () => {
    const file = document.getElementById('batch-file').files[0]
    const msgEl = document.getElementById('batch-msg')
    const previewEl = document.getElementById('batch-preview')

    if (!file) {
      msgEl.innerHTML = ctx.msg('请选择 Excel 文件', false)
      return
    }

    msgEl.innerHTML = ctx.msg('解析文件中...', true)

    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

      const list = rows.map(r => ({
        vendor_code: String(r['厂编'] || r['vendor_code'] || '').trim(),
        vendor_name: String(r['厂商名称'] || r['vendor_name'] || '').trim(),
        contact_name: String(r['联系人'] || r['contact_name'] || '').trim(),
        contact_phone: String(r['联系电话'] || r['手机号'] || r['contact_phone'] || '').trim()
      })).filter(x => x.vendor_code && x.vendor_name)

      if (!list.length) {
        msgEl.innerHTML = ctx.msg('未解析到有效数据（需含「厂编」和「厂商名称」列）', false)
        return
      }

      previewEl.innerHTML = `
        <p style="color:#333;margin-bottom:8px;">
          共解析 <strong>${list.length}</strong> 条，预览前 5 条：
        </p>
        <div class="scroll" style="max-height:200px;">
          <table>
            <tr><th>厂编</th><th>厂商名称</th><th>联系人</th><th>联系电话</th></tr>
            ${list.slice(0, 5).map(x => `<tr>
              <td>${x.vendor_code}</td>
              <td>${x.vendor_name}</td>
              <td>${x.contact_name}</td>
              <td>${x.contact_phone}</td>
            </tr>`).join('')}
          </table>
        </div>
        <p style="color:#d46b08;margin-top:12px;">
          确认无误后，点击下方按钮开始导入。
        </p>
        <button id="btn-batch-confirm">确认导入 ${list.length} 个厂商</button>
      `

      document.getElementById('btn-batch-confirm').onclick = async () => {
        if (!confirm(`确定导入 ${list.length} 个厂商？\n\n统一密码：888888\n授权仓库：2608`)) return

        msgEl.innerHTML = ctx.msg(`导入中（0 / ${list.length}）...`, true)
        previewEl.innerHTML = ''

        const success = []
        const failed = []

        const { data: { session } } = await ctx.supabase.auth.getSession()

        for (let i = 0; i < list.length; i++) {
          const item = list[i]
          msgEl.innerHTML = ctx.msg(`导入中（${i+1} / ${list.length}）：${item.vendor_code} ${item.vendor_name}...`, true)

          try {
            const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/create-vendor`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
              },
              body: JSON.stringify({
                vendor_code: item.vendor_code,
                vendor_name: item.vendor_name,
                contact_name: item.contact_name,
                contact_phone: item.contact_phone,
                password: '888888',
                warehouse_codes: ['2608']
              })
            })

            const json = await res.json()

            if (res.ok && json.ok) {
              success.push(item)
            } else {
              failed.push({ ...item, error: json.error || '未知错误' })
            }
          } catch (e) {
            failed.push({ ...item, error: String(e) })
          }
        }

        let html = `
          <div class="msg ${failed.length === 0 ? 'ok' : 'err'}" style="margin-top:12px;">
            <strong>导入完成</strong><br>
            成功：${success.length} 个<br>
            失败：${failed.length} 个
          </div>
        `

        if (failed.length > 0) {
          html += `
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;color:#cf1322;">查看失败详情</summary>
              <div class="scroll" style="max-height:300px;margin-top:8px;">
                <table>
                  <tr><th>厂编</th><th>厂商名称</th><th>失败原因</th></tr>
                  ${failed.map(f => `<tr>
                    <td>${f.vendor_code}</td>
                    <td>${f.vendor_name}</td>
                    <td style="color:#cf1322;font-size:12px;">${f.error}</td>
                  </tr>`).join('')}
                </table>
              </div>
            </details>
          `
        }

        msgEl.innerHTML = html

        if (success.length > 0) {
          setTimeout(() => renderTab('vendors'), 2000)
        }
      }
    } catch (e) {
      msgEl.innerHTML = ctx.msg('解析失败：' + e.message, false)
    }
  }

  v.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id
      const act = b.dataset.act

      if (act === 'edit') {
        const p = vps.find(x => x.id === id)
        if (!p) return
        const panel = document.getElementById('vendor-edit-panel')
        panel.innerHTML = `
          <div class="card" style="border:2px solid #1677ff;">
            <h2>修改厂商 · ${p.vendor_code}</h2>
            <div id="ve-msg"></div>
            <div class="row">
              <div><label>厂商名称 *</label><input id="ve-name" value="${p.vendor_name||''}" /></div>
              <div><label>联系人 *</label><input id="ve-contact" value="${p.contact_name||''}" /></div>
              <div><label>手机号 *</label><input id="ve-phone" value="${p.contact_phone||''}" /></div>
            </div>
            <button id="btn-ve-save">保存</button>
            <button class="secondary" id="btn-ve-cancel">取消</button>
          </div>`
        document.getElementById('btn-ve-cancel').onclick = () => panel.innerHTML = ''
        document.getElementById('btn-ve-save').onclick = async () => {
          const msgEl = document.getElementById('ve-msg')
          const name = document.getElementById('ve-name').value.trim()
          const contact = document.getElementById('ve-contact').value.trim()
          const phone = document.getElementById('ve-phone').value.trim()
          if (!name || !contact || !phone) {
            msgEl.innerHTML = ctx.msg('厂商名称、联系人、手机号为必填', false); return
          }
          const { error } = await ctx.supabase.from('vendor_profile')
            .update({ vendor_name: name, contact_name: contact, contact_phone: phone })
            .eq('id', id)
          if (error) {
            msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false); return
          }
          alert('已保存')
          renderTab('vendors')
        }
        return
      }

      if (act === 'toggle') {
        const enable = b.dataset.enable === '1'
        const action = enable ? '启用' : '禁用'
        if (!confirm(`确定${action}该厂商？`)) return
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/toggle-user-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ user_id: id, account_type: 'vendor', enable })
        })
        const json = await res.json()
        alert(res.ok ? `已${action}` : `${action}失败：` + ctx.translateError(json.error || '未知错误'))
        if (res.ok) renderTab('vendors')
        return
      }

      if (act === 'grant') {
        const code = b.dataset.code
        const cur = (vwMap[id]||[]).join(',')
        const input = prompt(`输入授权仓库代码（逗号分隔），当前：${cur}`, cur)
        if (input === null) return
        const codes = input.split(',').map(s => s.trim()).filter(Boolean)
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/grant-warehouse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ vendor_id: id, vendor_code: code, warehouse_codes: codes })
        })
        alert(res.ok ? '授权成功' : '授权失败，请重试')
        if (res.ok) renderTab('vendors')
      }

      if (act === 'reset') {
        const pwd = prompt('输入新密码（至少 6 位）')
        if (!pwd || pwd.length < 6) return alert('密码太短')
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/reset-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ user_id: id, new_password: pwd })
        })
        alert(res.ok ? '重置成功' : '重置失败，请重试')
      }

      if (act === 'del') {
        const code = b.dataset.code
        if (!confirm(`确定删除厂商「${code}」？\n\n会同时删除：\n- Auth 用户\n- 厂商档案\n- 仓库授权\n\n此操作不可撤销！`)) return

        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/delete-vendor`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ vendor_id: id })
        })
        const json = await res.json()
        alert(res.ok ? '已删除' : '删除失败：' + ctx.translateError(json.error || '未知错误'))
        if (res.ok) renderTab('vendors')
      }
    }
  })
}

// ================= 3.5 物流商管理 =================
function buildVendorPicker(rootId, allVendors, initialSelected = []) {
  const root = document.getElementById(rootId)
  if (!root) return { getSelected: () => [] }
  let selected = [...initialSelected]

  function render() {
    const selectedSet = new Set(selected)
    root.innerHTML = `
      <div style="position:relative;">
        <input id="${rootId}-input" placeholder="输入厂编开头搜索..." autocomplete="off"
          style="margin-bottom:6px;" />
        <div id="${rootId}-suggest"
          style="position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #eee;border-radius:4px;
                 box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:100;display:none;max-height:200px;overflow:auto;"></div>
      </div>
      <div id="${rootId}-tags" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
        ${selected.map(code => {
          const vd = allVendors.find(x => x.vendor_code === code)
          const name = vd?.vendor_name || ''
          return `<span style="display:inline-flex;align-items:center;gap:6px;background:#e6f4ff;color:#1677ff;
                                border:1px solid #91caff;border-radius:14px;padding:4px 12px;font-size:12px;">
            ${code}${name?' · '+name:''}
            <span data-rm="${code}" style="cursor:pointer;font-weight:bold;color:#1677ff;
                  padding:2px 8px;font-size:14px;line-height:1;user-select:none;border-radius:8px;
                  background:#fff;border:1px solid #91caff;"
                  onmouseover="this.style.background='#1677ff';this.style.color='#fff';"
                  onmouseout="this.style.background='#fff';this.style.color='#1677ff';">×</span>
          </span>`
        }).join('')}
      </div>`

    const input = document.getElementById(`${rootId}-input`)
    const suggest = document.getElementById(`${rootId}-suggest`)

    function doSearch() {
      const kw = input.value.trim()
      if (!kw) { suggest.style.display = 'none'; return }
      const matches = allVendors
        .filter(v => !selectedSet.has(v.vendor_code) && v.vendor_code.startsWith(kw))
        .slice(0, 3)
      if (!matches.length) { suggest.style.display = 'none'; return }
      suggest.innerHTML = matches.map(v =>
        `<div data-pick="${v.vendor_code}"
              style="padding:8px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5;user-select:none;"
              onmouseover="this.style.background='#f5f5f5'"
              onmouseout="this.style.background='#fff'">
          ${v.vendor_code} - ${v.vendor_name||''}
        </div>`
      ).join('')
      suggest.style.display = 'block'

      suggest.querySelectorAll('[data-pick]').forEach(el => {
        el.onmousedown = (e) => {
          e.preventDefault()
          e.stopPropagation()
          const code = el.dataset.pick
          if (!selected.includes(code)) selected.push(code)
          input.value = ''
          render()
          document.getElementById(`${rootId}-input`)?.focus()
        }
      })
    }

    input.oninput = doSearch
    input.onfocus = doSearch
    input.onblur = () => {
      setTimeout(() => { suggest.style.display = 'none' }, 300)
    }

    root.querySelectorAll('[data-rm]').forEach(el => {
      el.onmousedown = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const code = el.dataset.rm
        selected = selected.filter(c => c !== code)
        render()
      }
    })
  }

  render()
  return {
    getSelected: () => selected
  }
}

async function renderLogistics(v) {
  const { data: vps } = await ctx.supabase.from('vendor_profile')
    .select('*')
    .eq('account_type', 'logistics')
    .order('created_at', { ascending: false })

  const { data: lvs } = await ctx.supabase.from('logistics_vendor').select('*')
  const lvMap = {}
  ;(lvs||[]).forEach(x => { (lvMap[x.logistics_id] ||= []).push(x.vendor_code) })

  const { data: allVendors } = await ctx.supabase.from('vendor_profile')
    .select('vendor_code, vendor_name')
    .eq('account_type', 'vendor')
    .order('vendor_code')

  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>创建物流商</h2>
      <div class="row">
        <input id="lg-code" placeholder="物流商编号 *" />
        <input id="lg-name" placeholder="物流商名称 *" />
        <input id="lg-pwd" placeholder="初始密码 *" />
      </div>
      <div class="row">
        <div style="flex:1;">
          <label>负责厂商 *（输入厂编开头搜索，最多 3 条建议）</label>
          <div id="lg-picker"></div>
        </div>
      </div>
      <button id="btn-create-logistics" style="margin-top:8px;">创建物流商</button>
      <div id="lg-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>物流商列表（${(vps||[]).length}）</h2>
      <div class="scroll">
        <table>
          <tr><th>编号</th><th>名称</th><th>负责厂商</th><th>状态</th><th>操作</th></tr>
          <tbody>${(vps||[]).map(p => `<tr>
            <td>${p.vendor_code||''}</td>
            <td>${p.vendor_name||''}</td>
            <td style="font-size:12px;color:#666;">${(lvMap[p.id]||[]).join(', ')||'-'}</td>
            <td>${p.status===1?'<span class="stat ok">启用</span>':'<span class="stat no">禁用</span>'}</td>
            <td>
              <button class="small secondary" data-act="manage-vendors" data-id="${p.id}" data-code="${p.vendor_code}">管理厂商</button>
              <button class="small secondary" data-act="reset" data-id="${p.id}">重置密码</button>
              ${isSuper() ? `<button class="small danger" data-act="del" data-id="${p.id}" data-code="${p.vendor_code}">删除</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="5">无数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div id="modal-root"></div>`

  const lgPicker = buildVendorPicker('lg-picker', allVendors || [], [])

  document.getElementById('btn-create-logistics').onclick = async () => {
    const msgEl = document.getElementById('lg-msg')
    const code = document.getElementById('lg-code').value.trim()
    const name = document.getElementById('lg-name').value.trim()
    const pwd = document.getElementById('lg-pwd').value
    const codes = lgPicker.getSelected()

    if (!code) { msgEl.innerHTML = ctx.msg('请填写物流商编号', false); return }
    if (!name) { msgEl.innerHTML = ctx.msg('请填写物流商名称', false); return }
    if (!pwd || pwd.length < 6) { msgEl.innerHTML = ctx.msg('密码至少 6 位', false); return }
    if (!codes.length) { msgEl.innerHTML = ctx.msg('请至少选择一个负责厂商', false); return }

    msgEl.innerHTML = ctx.msg('创建中...', true)

    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/create-logistics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        logistics_code: code,
        logistics_name: name,
        password: pwd,
        vendor_codes: codes
      })
    })
    const json = await res.json()
    if (res.ok) {
      msgEl.innerHTML = ctx.msg(`创建成功，登录邮箱：${json.email}`, true)
      renderTab('logistics')
    } else {
      msgEl.innerHTML = ctx.msg(ctx.translateError(json.error || '创建失败'), false)
    }
  }

  v.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id
      const act = b.dataset.act

      if (act === 'manage-vendors') {
        const code = b.dataset.code
        const modal = document.getElementById('modal-root')
        modal.innerHTML = `
          <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;">
            <div style="background:#fff;border-radius:8px;padding:24px;max-width:560px;width:90%;max-height:80vh;display:flex;flex-direction:column;">
              <h2 style="margin-bottom:16px;">管理负责厂商 · ${code}</h2>
              <div style="flex:1;overflow:auto;margin-bottom:16px;">
                <label style="font-size:12px;color:#666;">输入厂编开头搜索，最多 3 条建议</label>
                <div id="mv-picker"></div>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button class="secondary" id="btn-modal-cancel">取消</button>
                <button id="btn-modal-save">保存</button>
              </div>
            </div>
          </div>`

        const mvPicker = buildVendorPicker('mv-picker', allVendors || [], lvMap[id] || [])

        document.getElementById('btn-modal-cancel').onclick = () => { modal.innerHTML = '' }

        document.getElementById('btn-modal-save').onclick = async () => {
          const finalCodes = mvPicker.getSelected()

          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/grant-logistics-vendors`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ logistics_id: id, vendor_codes: finalCodes })
          })
          if (res.ok) {
            modal.innerHTML = ''
            renderTab('logistics')
          } else {
            const txt = await res.text()
            let m = '保存失败，请重试'
            try { m = ctx.translateError(JSON.parse(txt).error) } catch(e) {}
            alert(m)
          }
        }
        return
      }

      if (act === 'reset') {
        const pwd = prompt('输入新密码（至少 6 位）')
        if (!pwd || pwd.length < 6) return alert('密码太短')
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/reset-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ user_id: id, new_password: pwd })
        })
        alert(res.ok ? '重置成功' : '重置失败，请重试')
        return
      }

      if (act === 'del') {
        const code = b.dataset.code
        if (!confirm(`确定删除物流商「${code}」？\n\n会同时删除：\n- Auth 用户\n- 物流商档案\n- 负责厂商关联\n\n此操作不可撤销！`)) return

        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/delete-logistics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ logistics_id: id })
        })
        const json = await res.json()
        alert(res.ok ? '已删除' : '删除失败：' + ctx.translateError(json.error || '未知错误'))
        if (res.ok) renderTab('logistics')
        return
      }
    }
  })
}

// ================= 4. 管理员管理 =================
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
              <button class="small secondary" data-act="toggle" data-id="${a.id}" data-enable="${a.status===1?'0':'1'}">${a.status===1?'禁用':'启用'}</button>
              <button class="small secondary" data-act="pwd" data-id="${a.id}">重置密码</button>
              ${isSuper() ? `<button class="small danger" data-act="del" data-id="${a.id}" data-name="${a.name||''}">删除</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="6">无数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div id="admin-edit-panel"></div>`

  const btn = document.getElementById('btn-create-admin')
  if (btn) btn.onclick = async () => {
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ login_name: login, password: pwd, name, phone, role, warehouse_codes: whSel })
    })
    const json = await res.json()
    if (res.ok) {
      msgEl.innerHTML = ctx.msg(`创建成功，登录邮箱：${json.email}`, true)
      renderTab('admins')
    } else {
      msgEl.innerHTML = ctx.msg(ctx.translateError(json.error || '创建失败'), false)
    }
  }

  v.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id
      const act = b.dataset.act

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
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ user_id: id, account_type: 'admin', enable })
        })
        const json = await res.json()
        alert(res.ok ? `已${action}` : `${action}失败：` + ctx.translateError(json.error || '未知错误'))
        if (res.ok) renderTab('admins')
        return
      }

      if (act === 'pwd') {
        const pwd = prompt('输入新密码（至少 6 位）')
        if (!pwd || pwd.length < 6) return alert('密码太短')
        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/reset-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ user_id: id, new_password: pwd })
        })
        alert(res.ok ? '重置成功' : '重置失败，请重试')
      }

      if (act === 'del') {
        if (id === ctx.currentUser.id) return alert('不能删除自己')
        if (!confirm(`确定删除管理员「${b.dataset.name}」？`)) return
        const { error } = await ctx.supabase.from('admin_users').delete().eq('id', id)
        if (error) return alert(ctx.translateError(error.message))
        await ctx.supabase.from('vendor_profile').delete().eq('id', id)
        alert('已删除')
        renderTab('admins')
      }
    }
  })
}

// ================= 5. 基础数据 =================
async function renderBase(v) {
  v.innerHTML = `
    <div class="tabs" id="base-tabs">
      <button data-t="wh" class="active">仓库</button>
      <button data-t="loc">仓位</button>
      <button data-t="store">门店</button>
      <button data-t="mode">物流方式</button>
      <button data-t="product">商品主数据</button>
      <button data-t="map">仓位映射</button>
    </div>
    <div id="base-view"></div>`
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
  if (key === 'loc') return renderLoc(v)
  if (key === 'store') return renderStore(v)
  if (key === 'mode') return renderMode(v)
  if (key === 'product') return renderProduct(v)
  if (key === 'map') return renderMap(v)
}

async function renderWh(v) {
  const { data } = await ctx.supabase.from('warehouse').select('*').order('warehouse_code')
  v.innerHTML = `
    <div class="row">
      <input id="w-code" placeholder="仓库代码 *" />
      <input id="w-name" placeholder="仓库名称 *" />
      <input id="w-region" placeholder="区域" />
      <button id="btn-w-add">新增</button>
    </div>
    <div id="w-msg"></div>
    <table><tr><th>代码</th><th>名称</th><th>区域</th><th>默认门店</th><th>状态</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.warehouse_code}</td><td>${r.warehouse_name}</td><td>${r.region||''}</td>
        <td>${r.default_store_code||'-'}</td>
        <td>${r.status===1?'启用':'停用'}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-w-add').onclick = async () => {
    const { error } = await ctx.supabase.from('warehouse').insert({
      warehouse_code: document.getElementById('w-code').value.trim(),
      warehouse_name: document.getElementById('w-name').value.trim(),
      region: document.getElementById('w-region').value.trim() || null
    })
    document.getElementById('w-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderBaseSub('wh')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('warehouse').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderBaseSub('wh')
    }
  })
}

async function renderLoc(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data } = await ctx.supabase.from('location_config_detail').select('*')
  v.innerHTML = `
    <div class="row">
      <select id="l-wh">${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
      <input id="l-code" placeholder="仓位代码 *" />
      <input id="l-name" placeholder="仓位名称" />
      <button id="btn-l-add">新增</button>
    </div>
    <div id="l-msg"></div>
    <table><tr><th>仓库</th><th>仓位代码</th><th>名称</th><th>单据数</th><th>状态</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.warehouse_name||r.warehouse_code}</td>
        <td>${r.location_code}</td><td>${r.location_name||''}</td><td>${r.bill_count||0}</td>
        <td>${r.status===1?'启用':'停用'}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-l-add').onclick = async () => {
    const { error } = await ctx.supabase.from('location_config').insert({
      warehouse_code: document.getElementById('l-wh').value,
      location_code: document.getElementById('l-code').value.trim(),
      location_name: document.getElementById('l-name').value.trim() || null,
      created_by: ctx.currentProfile?.vendor_name || 'admin'
    })
    document.getElementById('l-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderBaseSub('loc')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('location_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderBaseSub('loc')
    }
  })
}

async function renderStore(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data } = await ctx.supabase.from('store_config_detail').select('*')
  v.innerHTML = `
    <div class="row">
      <select id="s-wh"><option value="">全部仓库</option>${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
      <input id="s-code" placeholder="门店代码 *" />
      <input id="s-name" placeholder="门店名称" />
      <button id="btn-s-add">新增</button>
    </div>
    <div id="s-msg"></div>
    <table><tr><th>仓库</th><th>门店代码</th><th>名称</th><th>单据数</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.warehouse_name||''}</td><td>${r.store_code}</td><td>${r.store_name||''}</td>
        <td>${r.bill_count||0}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-s-add').onclick = async () => {
    const { error } = await ctx.supabase.from('store_config').insert({
      warehouse_code: document.getElementById('s-wh').value || null,
      store_code: document.getElementById('s-code').value.trim(),
      store_name: document.getElementById('s-name').value.trim() || null,
      created_by: ctx.currentProfile?.vendor_name || 'admin'
    })
    document.getElementById('s-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderBaseSub('store')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('store_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderBaseSub('store')
    }
  })
}

async function renderMode(v) {
  const { data } = await ctx.supabase.from('logistics_mode_config_detail').select('*').order('sort_order')
  v.innerHTML = `
    <div class="row">
      <input id="m-code" placeholder="模式代码 *" />
      <input id="m-name" placeholder="模式名称 *" />
      <input id="m-sort" type="number" placeholder="排序" value="0" />
      <button id="btn-m-add">新增</button>
    </div>
    <div id="m-msg"></div>
    <table><tr><th>代码</th><th>名称</th><th>排序</th><th>单据数</th><th>状态</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.mode_code}</td><td>${r.mode_name}</td><td>${r.sort_order||0}</td>
        <td>${r.bill_count||0}</td><td>${r.status===1?'启用':'停用'}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-m-add').onclick = async () => {
    const { error } = await ctx.supabase.from('logistics_mode_config').insert({
      mode_code: document.getElementById('m-code').value.trim(),
      mode_name: document.getElementById('m-name').value.trim(),
      sort_order: Number(document.getElementById('m-sort').value) || 0,
      created_by: ctx.currentProfile?.vendor_name || 'admin'
    })
    document.getElementById('m-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderBaseSub('mode')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('logistics_mode_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderBaseSub('mode')
    }
  })
}

async function renderProduct(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data } = await ctx.supabase.from('product_master').select('*').order('id', { ascending: false }).limit(200)
  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>Excel 导入商品主数据</h2>
      <div class="row">
        <select id="p-wh">${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <input id="p-file" type="file" accept=".xlsx,.xls" />
        <button id="btn-p-import">导入</button>
      </div>
      <div id="p-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>手动新增商品</h2>
      <div class="row">
        <select id="pm-wh">${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}</select>
        <input id="pm-code" placeholder="商品代码 *" />
        <input id="pm-vendor" placeholder="厂编 *" />
      </div>
      <div class="row">
        <input id="pm-name" placeholder="品名 *" />
        <input id="pm-spec" placeholder="规格 *" />
      </div>
      <button id="btn-pm-add">新增商品</button>
      <div id="pm-msg"></div>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>商品列表</h2>
      <div class="scroll">
        <table><tr><th>仓库</th><th>商品代码</th><th>商品名称</th><th>规格</th><th>默认厂编</th><th>默认仓位</th><th>默认物流</th><th>操作</th></tr>
          <tbody>${(data||[]).map(r=>`<tr>
            <td>${r.warehouse_code||''}</td><td>${r.product_code}</td><td>${r.product_name||''}</td>
            <td>${r.spec||''}</td><td>${r.default_vendor_code||''}</td>
            <td>${r.default_location_code||''}</td><td>${r.default_logistics_mode||''}</td>
            <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
          </tr>`).join('')}</tbody></table>
      </div>
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
      default_vendor_code: r['默认厂编'] || r['default_vendor_code'],
      default_owner_code: r['默认货主'] || r['default_owner_code'],
      default_location_code: r['默认仓位'] || r['default_location_code'],
      default_logistics_mode: r['默认物流'] || r['default_logistics_mode'],
      store_code: r['门店代码'] || r['store_code'],
      store_name: r['门店名称'] || r['store_name']
    })).filter(p => p.product_code)
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await fetch(`${ctx.SUPABASE_URL}/functions/v1/import-products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        warehouse_code: document.getElementById('p-wh').value,
        products
      })
    })
    const json = await res.json()
    document.getElementById('p-msg').innerHTML = res.ok      ? ctx.msg(`导入 ${json.count} 条`, true) : ctx.msg(ctx.translateError(json.error || '导入失败'), false)
    if (res.ok) renderBaseSub('product')
  }

  document.getElementById('btn-pm-add').onclick = async () => {
    const msgEl = document.getElementById('pm-msg')
    const wh = document.getElementById('pm-wh').value
    const code = document.getElementById('pm-code').value.trim()
    const vendor = document.getElementById('pm-vendor').value.trim()
    const name = document.getElementById('pm-name').value.trim()
    const spec = document.getElementById('pm-spec').value.trim()

    if (!code || !vendor || !name || !spec) {
      msgEl.innerHTML = ctx.msg('商品代码、厂编、品名、规格为必填', false); return
    }

    const { data: exist } = await ctx.supabase.from('product_master')
      .select('id')
      .eq('warehouse_code', wh)
      .eq('product_code', code)
      .eq('default_vendor_code', vendor)
      .maybeSingle()

    if (exist) {
      msgEl.innerHTML = ctx.msg(`同仓库「${wh}」同厂编「${vendor}」下商品代码「${code}」已存在`, false)
      return
    }

    const { error } = await ctx.supabase.from('product_master').insert({
      warehouse_code: wh,
      product_code: code,
      product_name: name,
      spec,
      default_vendor_code: vendor,
      default_owner_code: vendor
    })

    if (error) {
      msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    msgEl.innerHTML = ctx.msg('新增成功', true)
    setTimeout(() => renderBaseSub('product'), 600)
  }

  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('product_master').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderBaseSub('product')
    }
  })
}

async function renderMap(v) {
  const { data } = await ctx.supabase.from('location_warehouse_map').select('*').order('location_code')
  v.innerHTML = `
    <div class="row">
      <input id="mp-loc" placeholder="仓位代码 * 如 01" />
      <input id="mp-wh" placeholder="仓库代码 * 如 2608" />
      <input id="mp-name" placeholder="仓库名称 如 济南冻仓" />
      <button id="btn-mp-add">新增</button>
    </div>
    <div id="mp-msg"></div>
    <table><tr><th>仓位代码</th><th>仓库代码</th><th>仓库名称</th><th>状态</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.location_code}</td><td>${r.warehouse_code}</td><td>${r.warehouse_name||''}</td>
        <td>${r.status===1?'启用':'停用'}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-mp-add').onclick = async () => {
    const { error } = await ctx.supabase.from('location_warehouse_map').insert({
      location_code: document.getElementById('mp-loc').value.trim(),
      warehouse_code: document.getElementById('mp-wh').value.trim(),
      warehouse_name: document.getElementById('mp-name').value.trim() || null
    })
    document.getElementById('mp-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderBaseSub('map')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('location_warehouse_map').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderBaseSub('map')
    }
  })
}

// ================= 6. 提报规则 =================
async function renderRules(v) {
  v.innerHTML = `
    <div class="tabs" id="rule-tabs">
      <button data-t="deadline" class="active">提报时间段</button>
      <button data-t="holiday">节假日</button>
      <button data-t="bypass">强制放行</button>
    </div>
    <div id="rule-view"></div>`
  document.querySelectorAll('#rule-tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#rule-tabs button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      renderRuleSub(b.dataset.t)
    }
  })
  renderRuleSub('deadline')
}

async function renderRuleSub(key) {
  const v = document.getElementById('rule-view')
  v.innerHTML = '加载中...'
  if (key === 'deadline') return renderDeadline(v)
  if (key === 'holiday') return renderHoliday(v)
  if (key === 'bypass') return renderBypass(v)
}

async function renderDeadline(v) {
  const { data } = await ctx.supabase.from('deadline_config').select('*').order('id')
  v.innerHTML = `
    <div class="row">
      <input id="d-vendor" placeholder="厂编（空=全部）" />
      <input id="d-wh" placeholder="仓库（空=全部）" />
      <select id="d-type"><option value="weekday">工作日</option><option value="weekend">周末</option><option value="all">全部</option></select>
      <input id="d-value" placeholder="如 07:00-15:00 *" />
      <button id="btn-d-add">新增</button>
    </div>
    <div id="d-msg"></div>
    <table><tr><th>厂编</th><th>仓库</th><th>日类型</th><th>时间段</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.vendor_code||'（全部）'}</td><td>${r.warehouse_code||'（全部）'}</td>
        <td>${r.day_type}</td><td>${r.config_value}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-d-add').onclick = async () => {
    const { error } = await ctx.supabase.from('deadline_config').insert({
      vendor_code: document.getElementById('d-vendor').value.trim() || null,
      warehouse_code: document.getElementById('d-wh').value.trim() || null,
      day_type: document.getElementById('d-type').value,
      config_value: document.getElementById('d-value').value.trim(),
      updated_by: ctx.currentProfile?.vendor_name || 'admin'
    })
    document.getElementById('d-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderRuleSub('deadline')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('deadline_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderRuleSub('deadline')
    }
  })
}

async function renderHoliday(v) {
  const { data } = await ctx.supabase.from('holiday_config').select('*').order('holiday_date')
  v.innerHTML = `
    <div class="row">
      <input id="h-date" type="date" />
      <input id="h-desc" placeholder="说明" />
      <button id="btn-h-add">新增</button>
    </div>
    <div id="h-msg"></div>
    <table><tr><th>日期</th><th>说明</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.holiday_date}</td><td>${r.description||''}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-h-add').onclick = async () => {
    const { error } = await ctx.supabase.from('holiday_config').insert({
      holiday_date: document.getElementById('h-date').value,
      description: document.getElementById('h-desc').value.trim() || null
    })
    document.getElementById('h-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderRuleSub('holiday')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('holiday_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderRuleSub('holiday')
    }
  })
}

async function renderBypass(v) {
  const { data } = await ctx.supabase.from('bypass_list').select('*').order('bypass_date', { ascending: false })
  v.innerHTML = `
    <div class="row">
      <input id="b-vendor" placeholder="厂编 *" />
      <input id="b-wh" placeholder="仓库（空=全部）" />
      <input id="b-date" type="date" />
      <input id="b-reason" placeholder="原因" />
      <button id="btn-b-add">新增</button>
    </div>
    <div id="b-msg"></div>
    <table><tr><th>厂编</th><th>仓库</th><th>日期</th><th>原因</th><th>操作</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.vendor_code}</td><td>${r.warehouse_code||'（全部）'}</td>
        <td>${r.bypass_date}</td><td>${r.reason||''}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-b-add').onclick = async () => {
    const { error } = await ctx.supabase.from('bypass_list').insert({
      vendor_code: document.getElementById('b-vendor').value.trim(),
      warehouse_code: document.getElementById('b-wh').value.trim() || null,
      bypass_date: document.getElementById('b-date').value,
      reason: document.getElementById('b-reason').value.trim() || null,
      created_by: ctx.currentProfile?.vendor_name || 'admin'
    })
    document.getElementById('b-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderRuleSub('bypass')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('bypass_list').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderRuleSub('bypass')
    }
  })
}

// ================= 7. 导出批次 =================
async function renderBatches(v) {
  const { data } = await ctx.supabase.from('export_batch_detail').select('*').order('id', { ascending: false }).limit(100)
  v.innerHTML = `
    <table><tr><th>批次号</th><th>仓库</th><th>开始</th><th>结束</th><th>类型</th><th>条数</th><th>操作人</th><th>时间</th></tr>
      <tbody>${(data||[]).map(r=>`<tr>
        <td>${r.batch_no}</td><td>${r.warehouse_code||''}</td>
        <td>${r.start_date||''}</td><td>${r.end_date||''}</td>
        <td>${r.bill_type||''}</td><td>${r.count||0}（实际 ${r.actual_count||0}）</td>
        <td>${r.operator||''}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>`).join('') || '<tr><td colspan="8">无数据</td></tr>'}</tbody></table>`
}

// ================= 8. 操作日志 =================
async function renderLogs(v) {
  const { data: ops } = await ctx.supabase.from('operation_log')
    .select('*').order('id', { ascending: false }).limit(200)
  const { data: edits } = await ctx.supabase.from('vendor_edit_log')
    .select('*').order('id', { ascending: false }).limit(200)

  v.innerHTML = `
    <div class="tabs" id="log-tabs">
      <button data-t="op" class="active">操作日志</button>
      <button data-t="edit">厂商修改记录</button>
    </div>
    <div id="log-view"></div>`

  const renderOp = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll">
        <table><tr><th>时间</th><th>操作人</th><th>动作</th><th>目标</th><th>详情</th></tr>
          <tbody>${(ops||[]).map(r=>`<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.operator_name||''}</td>
            <td>${r.action}</td>
            <td>${r.target||''}</td>
            <td style="font-size:11px;">${JSON.stringify(r.detail||{})}</td>
          </tr>`).join('') || '<tr><td colspan="5">无数据</td></tr>'}</tbody></table>
      </div>`
  }

  const renderEdit = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll">
        <table><tr><th>时间</th><th>单据ID</th><th>厂编</th><th>修改字段</th><th>操作</th></tr>
          <tbody>${(edits||[]).map(r=>`<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.bill_id}</td>
            <td>${r.vendor_code||''}</td>
            <td style="font-size:11px;">${(r.changed_fields||[]).join(', ')}</td>
            <td><button class="small secondary" data-detail="${r.id}">详情</button></td>
          </tr>`).join('') || '<tr><td colspan="5">无数据</td></tr>'}</tbody></table>
      </div>`

    document.querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.detail)
        const r = (edits||[]).find(x => x.id === id)
        if (!r) return
        const before = r.before_data || {}
        const after = r.after_data || {}
        const fields = r.changed_fields || []
        let html = `<div class="card" style="margin-top:12px;"><h2>修改详情 #${r.bill_id}</h2><table>
          <tr><th>字段</th><th>修改前</th><th>修改后</th></tr>`
        fields.forEach(f => {
          html += `<tr>
            <td>${f}</td>
            <td style="color:#cf1322;">${JSON.stringify(before[f] ?? '')}</td>
            <td style="color:#389e0d;">${JSON.stringify(after[f] ?? '')}</td>
          </tr>`
        })
        html += `</table></div>`
        document.getElementById('log-view').insertAdjacentHTML('beforeend', html)
      }
    })
  }

  document.querySelectorAll('#log-tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#log-tabs button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      if (b.dataset.t === 'op') renderOp()
      else renderEdit()
    }
  })

  renderOp()
}

// ================= 9. 系统配置 =================
async function renderSys(v) {
  const { data: cfgs } = await ctx.supabase.from('system_config').select('*').order('config_key')
  const { data: vers } = await ctx.supabase.from('version_history').select('*').order('id', { ascending: false }).limit(50)
  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>系统配置</h2>
      <div class="row">
        <input id="c-key" placeholder="配置键 *" />
        <input id="c-val" placeholder="配置值" />
        <button id="btn-c-save">保存</button>
      </div>
      <div id="c-msg"></div>
      <table><tr><th>键</th><th>值</th><th>更新时间</th><th>操作</th></tr>
        <tbody>${(cfgs||[]).map(r=>`<tr>
          <td>${r.config_key}</td><td>${r.config_value||''}</td>
          <td>${new Date(r.updated_at).toLocaleString()}</td>
          <td>${isSuper() ? `<button class="small danger" data-del="${r.id}">删除</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>版本历史</h2>
      <div class="row">
        <input id="v-version" placeholder="版本号 *" />
        <input id="v-notes" placeholder="更新说明" />
        <button id="btn-v-add">新增</button>
      </div>
      <div id="v-msg"></div>
      <table><tr><th>版本</th><th>说明</th><th>发布时间</th></tr>
        <tbody>${(vers||[]).map(r=>`<tr>
          <td>${r.version}</td><td>${r.notes||''}</td>
          <td>${new Date(r.released_at).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>
    </div>`
  document.getElementById('btn-c-save').onclick = async () => {
    const key = document.getElementById('c-key').value.trim()
    const val = document.getElementById('c-val').value
    if (!key) return
    const { error } = await ctx.supabase.from('system_config')
      .upsert({ config_key: key, config_value: val, updated_by: ctx.currentProfile?.vendor_name || 'admin' },
              { onConflict: 'config_key' })
    document.getElementById('c-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已保存', true)
    if (!error) renderTab('sys')
  }
  document.getElementById('btn-v-add').onclick = async () => {
    const version = document.getElementById('v-version').value.trim()
    if (!version) return
    const { error } = await ctx.supabase.from('version_history').insert({
      version,
      notes: document.getElementById('v-notes').value.trim() || null,
      released_by: ctx.currentProfile?.vendor_name || 'admin'
    })
    document.getElementById('v-msg').innerHTML = error ? ctx.msg(ctx.translateError(error.message), false) : ctx.msg('已新增', true)
    if (!error) renderTab('sys')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('system_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      renderTab('sys')
    }
  })
}