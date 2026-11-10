// admin.js — 管理后台（2026-11-07 终极完整版：含财务对账、网络降级、单据多选汇总）

let ctx = null
let operatorName = '未知'

function isValidSpec(spec) {
  if (!spec) return false
  return /^1\*1\*[1-9]\d*$/.test(String(spec).trim())
}
const SIZE_EMPTY_MSG = '长、宽、高、重量为必填，请到「商品资料」补全'

// ★ 全局请求容错机制：优先走代理，失败或超时自动切直连
async function safeFetch(path, options = {}) {
  const primaryUrl = `https://api.mahui.pw${path}`
  const fallbackUrl = `https://gpjdzgakvqhnpykuqbfr.supabase.co${path}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

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
      <button data-t="progress" class="active">提报进度</button>
      <button data-t="bills">单据管理</button>
      <button data-t="billing">财务对账</button>
      <button data-t="qc">质检报告</button>
      <button data-t="vendors">厂商管理</button>
      <button data-t="logistics">物流商管理</button>
      <button data-t="admins">管理员管理</button>
      <button data-t="base">基础数据</button>
      <button data-t="logs">日志</button>
      <button data-t="ann">公告管理</button>
      <button data-t="sys">系统配置</button>
    `
  } else if (context.currentRole === 'admin') {
    menuHtml = `
      <button data-t="progress" class="active">提报进度</button>
      <button data-t="bills">单据管理</button>
      <button data-t="qc">质检报告</button>
      <button data-t="vendors">厂商管理</button>
      <button data-t="logistics">物流商管理</button>
    `
  } else {
    menuHtml = `
      <button data-t="progress" class="active">提报进度</button>
      <button data-t="bills">单据管理</button>
    `
  }

  view.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0;">管理后台</h2>
        <button class="secondary" id="btn-goto-fill">去代报数据</button>
      </div>
      <div class="tabs" id="admin-tabs">
        ${menuHtml}
      </div>
      <div id="admin-view"></div>
    </div>`

  document.getElementById('btn-goto-fill').onclick = () => {
    const navFillBtn = document.querySelector('#nav button[data-k="fill"]')
    if (navFillBtn) navFillBtn.click()
  }

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
    if (key === 'billing') return renderBillingAdmin(v) // ★ 新增财务对账
    if (key === 'qc') return renderQCAdmin(v)
    if (key === 'vendors') return renderVendors(v)
    if (key === 'logistics') return renderLogistics(v)
    if (key === 'admins') return renderAdmins(v)
    if (key === 'base') return renderBase(v)
    if (key === 'logs') return renderLogs(v)
    if (key === 'ann') return renderAnnouncements(v)
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
      action,
      target,
      detail
    })
  } catch (e) {
    console.warn('写操作日志失败', e)
  }
}

const ACTION_CN = {
  create_vendor: '创建厂商', batch_import_vendor: '批量导入厂商', update_vendor: '修改厂商',
  delete_vendor: '删除厂商', toggle_vendor: '启用/禁用厂商', grant_vendor_warehouse: '授权厂商仓库',
  reset_vendor_pwd: '重置厂商密码', create_logistics: '创建物流商', delete_logistics: '删除物流商',
  grant_logistics_vendors: '修改物流商负责厂商', reset_logistics_pwd: '重置物流商密码',
  create_admin: '创建管理员', update_admin: '修改管理员', delete_admin: '删除管理员',
  toggle_admin: '启用/禁用管理员', reset_admin_pwd: '重置管理员密码',
  import_bills: '导入单据', export_bills: '导出单据', export_bills_admin: '导出代报单据',
  update_bill: '修改单据', delete_bill: '删除单据', delete_qc: '删除质检报告', export_qc: '导出质检报告',
  create_warehouse: '新增仓库', delete_warehouse: '删除仓库', create_location: '新增仓位', delete_location: '删除仓位',
  create_store: '新增门店', delete_store: '删除门店', create_product: '新增商品', delete_product: '删除商品',
  create_deadline: '新增提报时间段', delete_deadline: '删除提报时间段', create_holiday: '新增节假日', delete_holiday: '删除节假日',
  create_bypass: '新增强制放行', delete_bypass: '删除强制放行', save_cleanup_config: '修改清理配置',
  save_system_config: '保存系统配置', delete_system_config: '删除系统配置', add_version: '新增版本记录',
  publish_announcement: '发布公告', archive_announcement: '下线公告'
}

// ================= 1. 提报进度 =================
async function renderProgress(v) {
  const { data } = await ctx.supabase.from('vendor_report_status').select('*')

  const nowBj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const todayStr = nowBj.toISOString().slice(0, 10)
  const startOfToday = new Date(todayStr + 'T00:00:00+08:00').toISOString()

  const { data: qcs } = await ctx.supabase.from('qc_report').select('vendor_code').gte('created_at', startOfToday)
  const qcSet = new Set((qcs || []).map(q => q.vendor_code))

  v.innerHTML = `
    <div class="row" style="margin-bottom:12px;">
      <input id="p-search" placeholder="搜索厂编/名称" />
      <select id="p-status">
        <option value="">全部状态</option>
        <option value="reported">今日已提报</option>
        <option value="not">今日未提报</option>
        <option value="nologin">今日未登录</option>
        <option value="qc_uploaded">今日已传质检</option>
        <option value="qc_missing">今日未传质检</option>
      </select>
    </div>
    <div class="scroll">
      <table>
        <tr>
          <th>厂编</th><th>厂商名称</th><th>仓库</th><th>联系人</th><th>手机</th>
          <th>登录状态</th><th>今日提报</th><th>今日条数</th><th>今日质检</th><th>最后提报</th><th>最后活跃</th>
        </tr>
        <tbody id="p-body"></tbody>
      </table>
    </div>`

  const render = () => {
    const tbody = document.getElementById('p-body')
    if (!tbody) return

    const kw = (document.getElementById('p-search').value || '').toLowerCase()
    const st = document.getElementById('p-status').value
    let list = data || []

    if (kw) list = list.filter(r => (r.vendor_code || '').toLowerCase().includes(kw) || (r.vendor_name || '').toLowerCase().includes(kw))
    if (st === 'reported') list = list.filter(r => r.reported_today)
    if (st === 'not') list = list.filter(r => !r.reported_today)
    if (st === 'nologin') list = list.filter(r => !r.logged_in_today)
    if (st === 'qc_uploaded') list = list.filter(r => qcSet.has(r.vendor_code))
    if (st === 'qc_missing') list = list.filter(r => !qcSet.has(r.vendor_code))

    tbody.innerHTML = list.map(r => {
      const hasQc = qcSet.has(r.vendor_code)
      return `<tr>
        <td>${r.vendor_code || ''}</td>
        <td>${r.vendor_name || ''}</td>
        <td>${r.warehouse_name || r.warehouse_code || ''}</td>
        <td>${r.contact_name || ''}</td>
        <td>${r.contact_phone || ''}</td>
        <td>${r.login_status === '在线' ? '<span class="stat ok" style="background:#e6f4ff;color:#1677ff;">● 在线</span>' : r.login_status === '今日已登录' ? '<span class="stat ok">已登录</span>' : '<span class="stat no">未登录</span>'}</td>
        <td>${r.reported_today ? '<span class="stat ok">已提报</span>' : '<span class="stat no">未提报</span>'}</td>
        <td>${r.today_count || 0}</td>
        <td>${hasQc ? '<span class="stat ok" style="background:#e6f4ff;color:#1677ff;border:1px solid #91caff;">✅ 已传</span>' : '<span class="stat no" style="background:#f5f5f5;color:#999;border:1px solid #ddd;">❌ 未传</span>'}</td>
        <td>${r.last_report_at ? new Date(r.last_report_at).toLocaleString() : '-'}</td>
        <td>${r.last_active_at ? new Date(r.last_active_at).toLocaleString() : '-'}</td>
      </tr>`
    }).join('') || '<tr><td colspan="11" style="text-align:center;color:#999;">无数据</td></tr>'
  }

  const searchEl = document.getElementById('p-search')
  const statusEl = document.getElementById('p-status')
  if (searchEl) searchEl.oninput = render
  if (statusEl) statusEl.onchange = render
  render()
}

// ================= 2. 单据管理 =================
async function renderBills(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data: vendors } = await ctx.supabase.from('vendor_profile').select('vendor_code, vendor_name').eq('account_type', 'vendor')
  const vMap = {}
  ;(vendors || []).forEach(x => { vMap[x.vendor_code] = x.vendor_name })

  v.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr; gap:16px; margin-bottom:16px;">
      <div class="card" style="box-shadow:none; margin:0; padding:16px;">
        <h2 style="margin-bottom:12px; font-size:16px;">导出 WMS 模板</h2>
        <div style="display:flex; gap:12px; margin-bottom:12px; align-items:center; flex-wrap:wrap;">
          <select id="exp-wh" style="flex:1; min-width:120px; margin:0;">
            ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
          </select>
          <input id="exp-start" type="date" style="flex:1; min-width:130px; margin:0;" />
          <span style="color:#666; font-size:13px;">至</span>
          <input id="exp-end" type="date" style="flex:1; min-width:130px; margin:0;" />
          <label style="display:flex; align-items:center; gap:6px; margin:0; font-size:13px; color:#666; cursor:pointer; white-space:nowrap;">
            <input type="checkbox" id="exp-include" style="width:auto; margin:0;" /> 包含已导出
          </label>

          <select id="exp-type" style="flex:0 0 140px; margin:0; font-weight:bold; color:#1677ff;" onchange="document.getElementById('multi-select-wrap').style.display = this.value === 'summary' ? 'inline-block' : 'none'">
            <option value="wms">WMS 标准模板</option>
            <option value="summary">出库配单汇总表</option>
          </select>

          <div id="multi-select-wrap" style="position:relative; display:none; margin:0;">
            <button id="ms-btn" class="secondary" style="height:32px; padding:0 12px; background:#fff7e6; border-color:#ffd591; color:#d46b08; font-weight:bold;">
              <span id="ms-btn-text">全部出库类型</span> <span style="font-size:10px;">▼</span>
            </button>
            <div id="ms-dropdown" style="position:absolute; top:36px; left:0; background:#fff; border:1px solid #d9d9d9; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.1); padding:8px; z-index:100; width:200px; display:none;">
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px; border-bottom:1px solid #eee; margin-bottom:4px; color:#1677ff; font-weight:bold;">
                <input type="checkbox" id="chk-all" style="width:14px; height:14px; margin:0;" onchange="toggleAll(this.checked)"> 全部出库类型
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="type-chk" value="VMI出库" style="width:14px; height:14px; margin:0;"> VMI出库
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="type-chk" value="DSP出库" style="width:14px; height:14px; margin:0;"> DSP出库
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px; color:#1677ff; font-weight:bold; border-top:1px dashed #eee; margin-top:4px;">
                <input type="checkbox" id="chk-jzx" style="width:14px; height:14px; margin:0;" onchange="toggleJzx(this.checked)"> 全部济转西
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="type-chk jzx-chk" value="济转西RT(留库)" style="width:14px; height:14px; margin:0;"> 济转西RT(留库)
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="type-chk jzx-chk" value="济转西RT(越库)" style="width:14px; height:14px; margin:0;"> 济转西RT(越库)
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="type-chk jzx-chk" value="济转西DSP(留库)" style="width:14px; height:14px; margin:0;"> 济转西DSP(留库)
              </label>
              <label style="display:flex; align-items:center; gap:8px; padding:6px 8px; cursor:pointer; font-size:13px;">
                <input type="checkbox" class="type-chk jzx-chk" value="济转西DSP(越库)" style="width:14px; height:14px; margin:0;"> 济转西DSP(越库)
              </label>
            </div>
          </div>
          
          <button id="btn-export" style="flex:0 0 80px;">导出</button>
          <button id="btn-export-admin" class="secondary" style="flex:0 0 100px; background:#e6f4ff; border-color:#91caff; color:#1677ff;">导出代报</button>
        </div>
        <div id="export-msg"></div>
      </div>
    </div>

    <div class="card" style="box-shadow:none; padding:16px; margin:0;" id="bill-query-card">
      <h2 style="margin-bottom:12px; font-size:16px;">单据查询</h2>
      
      <div style="display:flex; gap:12px; margin-bottom:12px; align-items:center;">
        <input id="b-search" placeholder="输入厂商名称/厂编/单号查询" style="flex:2; margin:0;" />
        <select id="b-wh" style="flex:1; margin:0;">
          <option value="">全部仓库</option>
          ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
        </select>
        <select id="b-exported" style="flex:1; margin:0;">
          <option value="">全部状态</option>
          <option value="0">未导出</option>
          <option value="1">已导出</option>
        </select>
        <button id="btn-b-search" class="secondary" style="flex:0 0 auto;">查询明细</button>
      </div>

      <div style="display:flex; align-items:center; background:#f8f9fa; padding:8px 12px; border-radius:6px; border:1px solid #eee; margin-bottom:12px;">
        <span style="font-size:13px; color:#666; margin-right:8px;">统计区间：</span>
        <input id="stat-start" type="date" style="width:130px; margin:0; padding:4px 8px;" />
        <span style="font-size:13px; color:#666; margin:0 8px;">至</span>
        <input id="stat-end" type="date" style="width:130px; margin:0; padding:4px 8px;" />
        
        <div id="stat-result-display" style="flex:1; display:flex; align-items:center; padding-left:16px; margin-left:16px; border-left:1px solid #ddd; min-height:24px;">
          <span style="color:#999; font-size:13px;">未统计</span>
        </div>
        
        <button id="btn-stat" class="secondary" style="flex:0 0 auto; background:#e6f4ff; border-color:#91caff; color:#1677ff;">统计箱数</button>
      </div>

      <div class="scroll" id="query-result-box" style="max-height: calc(100vh - 400px); overflow: auto;">
        <table>
          <tr><th>ID</th><th>来源单号</th><th>类型</th><th>厂编</th><th>厂商名称</th><th>仓库</th><th>商品</th><th>数量</th><th>已导出</th><th>时间</th><th>操作</th></tr>
          <tbody id="b-body"></tbody>
        </table>
      </div>
      
      <div id="bill-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;">
      </div>
    </div>
    <div id="admin-edit-bill-panel"></div>`

  const msBtn = document.getElementById('ms-btn')
  const msDropdown = document.getElementById('ms-dropdown')
  
  if (msBtn && msDropdown) {
    msBtn.onclick = (e) => {
      e.preventDefault()
      msDropdown.style.display = msDropdown.style.display === 'block' ? 'none' : 'block'
    }
    document.addEventListener('click', function closeDropdown(e) {
      if (!document.getElementById('multi-select-wrap')?.contains(e.target)) {
        if(msDropdown) msDropdown.style.display = 'none'
      }
    })
  }

  window.toggleAll = (checked) => {
    document.querySelectorAll('.type-chk').forEach(chk => chk.checked = checked)
    document.getElementById('chk-jzx').checked = checked
    updateMsBtnText()
  }
  window.toggleJzx = (checked) => {
    document.querySelectorAll('.jzx-chk').forEach(chk => chk.checked = checked)
    syncAllState()
  }
  document.querySelectorAll('.type-chk').forEach(chk => {
    chk.onchange = () => {
      const jzxChks = document.querySelectorAll('.jzx-chk')
      document.getElementById('chk-jzx').checked = Array.from(jzxChks).every(c => c.checked)
      syncAllState()
    }
  })
  function syncAllState() {
    const allChks = document.querySelectorAll('.type-chk')
    document.getElementById('chk-all').checked = Array.from(allChks).every(c => c.checked)
    updateMsBtnText()
  }
  function updateMsBtnText() {
    const checkedCount = document.querySelectorAll('.type-chk:checked').length
    const totalCount = document.querySelectorAll('.type-chk').length
    const textEl = document.getElementById('ms-btn-text')
    if (checkedCount === 0 || checkedCount === totalCount) textEl.innerText = "全部出库类型"
    else textEl.innerText = `已选 ${checkedCount} 项`
  }

  const doExport = async (submitterType = null, isDelegate = false) => {
    const warehouse_code = document.getElementById('exp-wh').value
    const start_date = document.getElementById('exp-start').value
    const end_date = document.getElementById('exp-end').value
    if (!start_date || !end_date) return alert('请选择完整的开始和结束日期')
    
    const include_exported = document.getElementById('exp-include')?.checked || false
    const btn = isDelegate ? document.getElementById('btn-export-admin') : document.getElementById('btn-export')
    const originalText = btn.innerText
    btn.disabled = true
    btn.innerText = '查询数据中...'
    const msgEl = document.getElementById('export-msg')
    msgEl.innerHTML = '<span style="color:#1677ff;font-size:13px;">正在拉取数据，请稍候...</span>'

    try {
      let allBills = []
      let page = 0
      const pageSize = 1000
      let hasMore = true

      while (hasMore) {
        let q = ctx.supabase.from('bill_order').select('*')
          .eq('warehouse_code', warehouse_code)
          .gte('created_at', start_date + 'T00:00:00+08:00')
          .lte('created_at', end_date + 'T23:59:59+08:00')
          .order('id', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1)
        
        if (!include_exported) q = q.eq('exported', false)
        if (submitterType) q = q.eq('submitter_type', submitterType)
        
        const { data, error } = await q
        if (error) throw error
        
        if (data && data.length > 0) {
          allBills = allBills.concat(data)
          page++
          msgEl.innerHTML = `<span style="color:#1677ff;font-size:13px;">已拉取 ${allBills.length} 条数据...</span>`
          if (data.length < pageSize) hasMore = false
        } else {
          hasMore = false
        }
      }

      if (allBills.length === 0) throw new Error('没有可导出的单据')

      msgEl.innerHTML = `<span style="color:#1677ff;font-size:13px;">正在生成 Excel (共 ${allBills.length} 条)...</span>`

      const IN_TYPES = ['VMI入库', 'DSP入库', '济转西RT(入库)', '济转西DSP(入库)']
      const OUT_TYPES = ['VMI出库', 'DSP出库', '济转西RT(留库)', '济转西RT(越库)', '济转西DSP(留库)', '济转西DSP(越库)']
      
      const inBills = allBills.filter(b => IN_TYPES.includes(b.bill_type))
      const outBills = allBills.filter(b => OUT_TYPES.includes(b.bill_type))

      const IN_HEADERS = ['来源单号','单据类型','供应商代码','货主代码','仓位代码','物流模式','商品代码','商品标识','包装规格','数量','单价','订单到效日期','到货日期','整单加工','商品备注','备注','分单标识','分单描述','皮重维度','皮重值','预约线路']
      const OUT_HEADERS = ['配单类型','货主代码','门店代码','物流方式','仓位代码','到效日期','配货日期','备注','来源单号','入库订单单号','商品代码','商品标识','包装规格','数量','单价','商品备注','组别','分单标识','分单描述']
      
      const fmtDate = (d) => { if(!d) return ''; const s=String(d); return s.includes('T')?s.slice(0,10):(s.includes(' ')?s.slice(0,10):s) }

      const inRows = inBills.map(b => [
        b.source_no || '', b.bill_type || '', b.vendor_code || '', b.owner_code || '',
        b.location_code || '', b.logistics_mode || '', b.product_code || '',
        null, // ★ 强制置空「商品标识」
        b.spec || '', b.quantity ?? '', b.price ?? '',
        fmtDate(b.effective_date), fmtDate(b.arrival_date), b.whole_process || '',
        b.product_remark || b.product_code || '无', b.remark || '', b.split_flag || '',
        b.split_desc || '', b.tare_dimension || null, b.tare_value ?? null, b.route || ''
      ])

      const outRows = outBills.map(b => {
        let storeCode = b.store_code || ''
        if (b.bill_type.includes('济转西')) {
          storeCode = '8205'
        }
        return [
          b.bill_type || '', b.owner_code || '', storeCode,
          b.logistics_mode || '', b.location_code || '',
          fmtDate(b.effective_date), fmtDate(b.pick_date), b.remark || '',
          b.source_no || '', b.inbound_order_no || '', b.product_code || '',
          null, // ★ 强制置空「商品标识」
          b.spec || '', b.quantity ?? '', b.price ?? '',
          b.product_remark || b.product_code || '无', b.group_name || '', b.split_flag || '', b.split_desc || ''
        ]
      })

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([IN_HEADERS, ...inRows]), '入库')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([OUT_HEADERS, ...outRows]), '出库')
      
      const batchNo = `EXP${Date.now()}`
      XLSX.writeFile(wb, `${isDelegate ? '代报导出' : 'export'}_${batchNo}.xlsx`)

      msgEl.innerHTML = `<span style="color:#1677ff;font-size:13px;">Excel已下载，正在更新数据库状态（请勿关闭页面）...</span>`

      const ids = allBills.map(b => b.id)
      
      const { error: rpcErr } = await ctx.supabase.rpc('mark_bills_as_exported', {
        p_batch_no: batchNo,
        p_ids: ids,
        p_warehouse_code: warehouse_code,
        p_start_date: start_date,
        p_end_date: end_date,
        p_count: allBills.length,
        p_operator: ctx.operatorName || 'admin'
      })

      if (rpcErr) {
        console.error('更新单据状态失败:', rpcErr)
        msgEl.innerHTML = ctx.msg(`Excel已下载，但系统状态更新失败：${rpcErr.message}`, false)
      } else {
        msgEl.innerHTML = ctx.msg(isDelegate ? '代报数据导出成功，状态已更新' : '导出成功，状态已更新', true)
      }

      await logOp(isDelegate ? 'export_bills_admin' : 'export_bills', (isDelegate ? '导出代报 ' : '导出 ') + warehouse_code, { start_date, end_date })
      
      if (typeof search === 'function') search(0)

    } catch (err) {
      console.error('导出异常:', err)
      msgEl.innerHTML = ctx.msg(`导出失败：${err.message}`, false)
    } finally {
      btn.disabled = false
      btn.innerText = originalText
    }
  }

  const doExportSummary = async () => {
    const warehouse_code = document.getElementById('exp-wh').value
    const start_date = document.getElementById('exp-start').value
    const end_date = document.getElementById('exp-end').value
    if (!start_date || !end_date) return alert('请选择完整的开始和结束日期')

    const checkedChks = document.querySelectorAll('.type-chk:checked')
    const selectedTypes = Array.from(checkedChks).map(c => c.value)

    const btn = document.getElementById('btn-export')
    const originalText = btn.innerText
    btn.disabled = true
    btn.innerText = '汇总中...'
    const msgEl = document.getElementById('export-msg')
    msgEl.innerHTML = '<span style="color:#389e0d;font-size:13px;">正在让数据库极速汇总，请稍候...</span>'

    try {
      const { data, error } = await ctx.supabase.rpc('get_outbound_summary', {
        p_warehouse_code: warehouse_code,
        p_start_date: start_date,
        p_end_date: end_date,
        p_bill_types: selectedTypes.length > 0 ? selectedTypes : null
      })

      if (error) throw error
      if (!data || data.length === 0) throw new Error('该时间段没有符合条件的数据')

      const headers = ['配单类型', '货主代码', '商品代码', '品名', '箱数']
      const rows = data.map(r => [r.bill_type, r.owner_code, r.product_code, r.product_name, r.total_boxes])
      
      let totalBoxes = 0
      data.forEach(r => totalBoxes += Number(r.total_boxes))
      
      rows.push(['合计', '', '', '', totalBoxes])

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 10 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '出库配单汇总')
      XLSX.writeFile(wb, `配单汇总_${start_date}_至_${end_date}_${Date.now()}.xlsx`)

      msgEl.innerHTML = ctx.msg(`汇总导出成功！共 ${data.length} 项，总计 ${totalBoxes} 箱。`, true)
    } catch (err) {
      console.error('汇总异常:', err)
      msgEl.innerHTML = ctx.msg(`汇总失败：${err.message}`, false)
    } finally {
      btn.disabled = false
      btn.innerText = originalText
    }
  }

  document.getElementById('btn-export').onclick = () => {
    const type = document.getElementById('exp-type').value
    if (type === 'summary') {
      doExportSummary()
    } else {
      doExport(null, false)
    }
  }

  document.getElementById('btn-export-admin').onclick = () => {
    const typeSelect = document.getElementById('exp-type')
    if (typeSelect) {
      typeSelect.value = 'wms'
      const wrap = document.getElementById('multi-select-wrap')
      if (wrap) wrap.style.display = 'none'
    }
    doExport('admin', true)
  }

  let currentPage = 0;
  const pageSize = 50;

  const search = async (page = 0) => {
    currentPage = page;
    const resultBox = document.getElementById('query-result-box')
    if (!resultBox) return
    
    resultBox.innerHTML = `
      <table>
        <tr><th>ID</th><th>来源单号</th><th>类型</th><th>厂编</th><th>厂商名称</th><th>仓库</th><th>商品</th><th>数量</th><th>已导出</th><th>时间</th><th>操作</th></tr>
        <tbody id="b-body"><tr><td colspan="11" style="text-align:center;color:#999;">加载中...</td></tr></tbody>
      </table>`
    
    const kw = document.getElementById('b-search').value.trim()
    const wh = document.getElementById('b-wh').value
    const ex = document.getElementById('b-exported').value

    let countQuery = ctx.supabase.from('bill_order').select('*', { count: 'exact', head: true })
    if (kw) countQuery = countQuery.or(`vendor_code.ilike.%${kw}%,source_no.ilike.%${kw}%,product_code.ilike.%${kw}%`)
    if (wh) countQuery = countQuery.eq('warehouse_code', wh)
    if (ex === '0') countQuery = countQuery.eq('exported', false)
    if (ex === '1') countQuery = countQuery.eq('exported', true)
    
    const { count, error: countErr } = await countQuery
    if (countErr) {
      alert('查询总数失败：' + countErr.message)
      return
    }

    let q = ctx.supabase.from('bill_order').select('*')
    if (kw) q = q.or(`vendor_code.ilike.%${kw}%,source_no.ilike.%${kw}%,product_code.ilike.%${kw}%`)
    if (wh) q = q.eq('warehouse_code', wh)
    if (ex === '0') q = q.eq('exported', false)
    if (ex === '1') q = q.eq('exported', true)
    
    const from = currentPage * pageSize
    const to = from + pageSize - 1
    q = q.order('id', { ascending: false }).range(from, to)
    
    const { data, error } = await q
    if (error) {
       alert('查询失败：' + error.message)
       return
    }

    const bBody = document.getElementById('b-body')
    if (!bBody) return 

    bBody.innerHTML = (data||[]).map(b => `<tr>
      <td>${b.id}</td><td>${b.source_no||''}</td><td>${b.bill_type||''}</td>
      <td>${b.vendor_code||''}</td><td>${vMap[b.vendor_code] || ''}</td>
      <td>${b.warehouse_name||b.warehouse_code||''}</td>
      <td>${b.product_code||''}</td><td>${b.quantity||''}</td>
      <td>${b.exported ? '是' : '否'}</td>
      <td>${new Date(b.created_at).toLocaleString()}</td>
      <td>
        <button class="small secondary" data-act="edit-bill" data-id="${b.id}">修改</button>
        <button class="small danger" data-act="del-bill" data-id="${b.id}">删除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="11" style="text-align:center;color:#999;">无匹配数据</td></tr>'

    const totalPages = Math.ceil((count || 0) / pageSize)
    const paginationEl = document.getElementById('bill-pagination')
    if (paginationEl) {
      paginationEl.innerHTML = `
        <span style="font-size:13px;color:#666;">共 ${count || 0} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
        <button class="secondary small" id="btn-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
        <button class="secondary small" id="btn-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
      `
      document.getElementById('btn-prev').onclick = () => { if (currentPage > 0) search(currentPage - 1) }
      document.getElementById('btn-next').onclick = () => { if (currentPage < totalPages - 1) search(currentPage + 1) }
    }

    document.querySelectorAll('#b-body button[data-act]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.id)
        const b = (data||[]).find(x => x.id === id)
        if (!b) return

        if (btn.dataset.act === 'edit-bill') {
          const panel = document.getElementById('admin-edit-bill-panel')
          panel.innerHTML = `
            <div class="card" style="border:2px solid #1677ff; margin-top:12px;">
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
              <div class="row">
                <div style="flex:3;"><label>备注</label><input id="ab-remark" value="${b.remark||''}" /></div>
              </div>
              <button id="btn-save-ab">保存</button>
              <button class="secondary" id="btn-cancel-ab">取消</button>
            </div>`

          document.getElementById('btn-cancel-ab').onclick = () => panel.innerHTML = ''

          document.getElementById('btn-save-ab').onclick = async () => {
            const msgEl = document.getElementById('ae-bill-msg')
            const product = document.getElementById('ab-product').value.trim()
            const spec = document.getElementById('ab-spec').value.trim()
            const qty = Number(document.getElementById('ab-qty').value)

            if (!product || !spec || !qty) {
              return msgEl.innerHTML = ctx.msg('商品、规格、数量为必填', false)
            }

            msgEl.innerHTML = ctx.msg('保存中...', true)

            const patch = {
              product_code: product,
              spec: spec,
              quantity: qty,
              owner_code: document.getElementById('ab-owner').value.trim(),
              arrival_date: document.getElementById('ab-arrival').value || null,
              effective_date: document.getElementById('ab-effective').value || null,
              remark: document.getElementById('ab-remark').value.trim()
            }

            const { error } = await ctx.supabase.from('bill_order').update(patch).eq('id', id)

            if (error) {
              msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
              return
            }

            await logOp('update_bill', '修改单据 ' + id)
            panel.innerHTML = ''
            await search(currentPage)
          }
        }

        if (btn.dataset.act === 'del-bill') {
          if (!confirm(`确定删除单据 #${id} 吗？此操作不可撤销！`)) return
          btn.disabled = true
          btn.innerText = '删除中...'

          ;(async () => {
            try {
              const { data: { session } } = await ctx.supabase.auth.getSession()
              const res = await safeFetch(`/functions/v1/delete-bill`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({ bill_id: id })
              })
              const text = await res.text()
              if (!res.ok) {
                alert('删除失败！错误信息：' + text)
                btn.disabled = false
                btn.innerText = '删除'
                return
              }
              await logOp('delete_bill', '删除单据 ' + id)
              alert('已成功删除')
              await search(currentPage)
            } catch (err) {
              alert('网络异常：' + err.message)
              btn.disabled = false
              btn.innerText = '删除'
            }
          })()
        }
      }
    })
  }
  
  document.getElementById('btn-b-search').onclick = () => search(0)
  
  document.getElementById('btn-stat').onclick = async () => {
    const start = document.getElementById('stat-start').value
    const end = document.getElementById('stat-end').value
    if (!start || !end) return alert('请选择完整的开始和结束日期')

    const btn = document.getElementById('btn-stat')
    const displayBox = document.getElementById('stat-result-display')
    const originalText = btn.innerText
    btn.innerText = '统计中...'
    btn.disabled = true
    displayBox.innerHTML = '<span style="color:#999;font-size:13px;">计算中...</span>'

    const { data, error } = await ctx.supabase.from('bill_order')
      .select('bill_type, spec, quantity')
      .gte('created_at', start + 'T00:00:00+08:00')
      .lte('created_at', end + 'T23:59:59+08:00')

    btn.innerText = originalText
    btn.disabled = false

    if (error) {
      displayBox.innerHTML = `<span style="color:#cf1322;font-size:13px;">${ctx.translateError(error.message)}</span>`
      return
    }
    if (!data || !data.length) {
      displayBox.innerHTML = '<span style="color:#999;font-size:13px;">该区间无数据</span>'
      return
    }

    let totalIn = 0
    let totalOut = 0
    data.forEach(b => {
      const isIn = b.bill_type.includes('入库')
      const multiplier = Number(String(b.spec || '1').split('*').pop()) || 1
      const boxes = Math.round(b.quantity / multiplier)
      if (isIn) totalIn += boxes
      else totalOut += boxes
    })

    displayBox.innerHTML = `
      <div style="display:flex; gap:32px; align-items:center;">
        <div>
          <span style="color:#666;font-size:13px;">入库总量：</span>
          <span style="color:#1677ff;font-weight:bold;font-size:18px;">${totalIn}</span>
          <span style="color:#1677ff;font-size:13px;font-weight:bold;">箱</span>
        </div>
        <div>
          <span style="color:#666;font-size:13px;">出库总量：</span>
          <span style="color:#d46b08;font-weight:bold;font-size:18px;">${totalOut}</span>
          <span style="color:#d46b08;font-size:13px;font-weight:bold;">箱</span>
        </div>
      </div>
    `
  }

  search(0)
}

// ================= 2.5 财务对账 =================
async function renderBillingAdmin(v) {
  if (!isSuper()) return v.innerHTML = ctx.msg('仅超级管理员可操作财务对账', false)

  // 1. 读取已有的费率配置
  const { data: cfg } = await ctx.supabase.from('system_config').select('config_value').eq('config_key', 'billing_rates_config').maybeSingle()
  let currentCfg = {
    rates: { dsp_east: 10, dsp_west: 15, dsp_nm: 15, transit: 7, storage: 3.5, operation: 1.5, unloading: 0.3 },
    taxes: { transport: 0.09, storage: 0.06, unloading: 0.06 }
  }
  if (cfg?.config_value) {
    try { currentCfg = JSON.parse(cfg.config_value) } catch(e) {}
  }

  v.innerHTML = `
    <div class="card" style="box-shadow:none; padding:16px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0;">财务对账中心</h2>
        <button class="secondary small" id="btn-toggle-rate-cfg" style="background:#f6ffed; border-color:#b7eb8f; color:#389e0d;">⚙️ 展开/收起费率与税率配置</button>
      </div>

      <div id="rate-config-box" style="display:none; background:#fafafa; padding:16px; border-radius:8px; border:1px solid #eee; margin-bottom:16px;">
        <h3 style="font-size:15px; margin-bottom:12px; color:#1677ff;">基础计费标准（元）</h3>
        <div class="row" style="margin-bottom:16px;">
          <div><label>DSP省内(箱)</label><input type="number" id="rate-east" value="${currentCfg.rates.dsp_east}" step="0.1" /></div>
          <div><label>DSP省外(箱)</label><input type="number" id="rate-west" value="${currentCfg.rates.dsp_west}" step="0.1" /></div>
          <div><label>内蒙古(箱)</label><input type="number" id="rate-nm" value="${currentCfg.rates.dsp_nm}" step="0.1" /></div>
          <div><label>干线代送(箱)</label><input type="number" id="rate-transit" value="${currentCfg.rates.transit}" step="0.1" /></div>
        </div>
        <div class="row" style="margin-bottom:16px;">
          <div><label>仓储费(板/天)</label><input type="number" id="rate-storage" value="${currentCfg.rates.storage}" step="0.1" /></div>
          <div><label>操作费(箱)</label><input type="number" id="rate-operation" value="${currentCfg.rates.operation}" step="0.1" /></div>
          <div><label>装卸费(箱)</label><input type="number" id="rate-unloading" value="${currentCfg.rates.unloading}" step="0.1" /></div>
        </div>
        <h3 style="font-size:15px; margin-bottom:12px; color:#1677ff;">各项税率（小数）</h3>
        <div class="row" style="margin-bottom:16px;">
          <div><label>运输类</label><input type="number" id="tax-transport" value="${currentCfg.taxes.transport}" step="0.01" /></div>
          <div><label>储存类</label><input type="number" id="tax-storage" value="${currentCfg.taxes.storage}" step="0.01" /></div>
          <div><label>装卸类</label><input type="number" id="tax-unloading" value="${currentCfg.taxes.unloading}" step="0.01" /></div>
        </div>
        <button id="btn-save-rates" style="width:150px; background:#1677ff; color:#fff;">保存配置</button>
        <span id="rate-save-msg" style="margin-left:12px; font-size:13px; color:#389e0d;"></span>
      </div>

      <div style="background:#f8f9fa; padding:20px; border-radius:8px; border:1px solid #eee; margin-bottom:16px;">
        <div style="display:flex; gap:12px; margin-bottom:12px; align-items:center; flex-wrap:wrap;">
          <select id="bill-wh" style="padding:8px; border-radius:4px; border:1px solid #d9d9d9;">
            <option value="济南冻仓">济南冻仓 (默认)</option>
            <option value="西安冻仓">西安冻仓 (默认)</option>
          </select>
          <span style="font-size:12px; color:#999;">* 文件名包含“济南”或“西安”将自动匹配仓库。</span>
          <input type="month" id="bill-month" style="padding:6px; border-radius:4px; border:1px solid #d9d9d9; margin-left:auto;" />
        </div>
        <div style="border: 2px dashed #91caff; background: #f0f7ff; padding: 20px; text-align: center; border-radius: 8px;">
          <input type="file" id="bill-file" accept=".xlsx, .xls" style="display:none;" multiple onchange="window.handleBillingUpload(event)" />
          <label for="bill-file" style="cursor:pointer; color:#1677ff; font-weight:bold; font-size:16px;">📁 点击上传《总表数据源.xlsx》（支持按住 Ctrl 多选）</label>
        </div>
        <div id="billing-msg" style="margin-top:12px; color:#1677ff; font-size:13px; line-height: 1.8;"></div>
      </div>
      
      <div id="billing-list-box" style="display:none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="font-size:16px; margin:0;">已导入账单列表</h3>
          <input id="bill-search" placeholder="搜索厂编/厂商名称" style="width:250px; margin:0; padding:6px 12px;" />
        </div>
        <div class="scroll" style="max-height: 500px;">
          <table id="billing-table">
            <thead>
              <tr>
                <th>厂编</th><th>厂商名称</th><th>仓别</th><th>含税总额(元)</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="billing-list-body"></tbody>
          </table>
        </div>
      </div>
      
      <!-- 预览弹窗容器 -->
      <div id="admin-billing-preview" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9999; padding:40px; overflow-y:auto;">
        <div style="background:#fff; border-radius:8px; max-width:1100px; margin:0 auto; padding:24px; position:relative;">
          <button id="btn-close-preview" style="position:absolute; top:16px; right:16px; background:#ff4d4f; color:#fff; border:none; border-radius:4px; padding:4px 12px; cursor:pointer;">关闭</button>
          <div id="admin-preview-content"></div>
        </div>
      </div>
    </div>
  `

  document.getElementById('btn-toggle-rate-cfg').onclick = () => {
    const box = document.getElementById('rate-config-box')
    box.style.display = box.style.display === 'none' ? 'block' : 'none'
  }

  document.getElementById('btn-save-rates').onclick = async () => {
    const msg = document.getElementById('rate-save-msg')
    msg.innerText = '保存中...'; msg.style.color = '#1677ff'
    const newCfg = {
      rates: {
        dsp_east: Number(document.getElementById('rate-east').value),
        dsp_west: Number(document.getElementById('rate-west').value),
        dsp_nm: Number(document.getElementById('rate-nm').value),
        transit: Number(document.getElementById('rate-transit').value),
        storage: Number(document.getElementById('rate-storage').value),
        operation: Number(document.getElementById('rate-operation').value),
        unloading: Number(document.getElementById('rate-unloading').value)
      },
      taxes: {
        transport: Number(document.getElementById('tax-transport').value),
        storage: Number(document.getElementById('tax-storage').value),
        unloading: Number(document.getElementById('tax-unloading').value)
      }
    }
    const { error } = await ctx.supabase.from('system_config').upsert({
      config_key: 'billing_rates_config', config_value: JSON.stringify(newCfg), updated_by: ctx.operatorName
    }, { onConflict: 'config_key' })
    if (error) {
      msg.innerText = '保存失败：' + error.message; msg.style.color = '#cf1322'
    } else {
      msg.innerText = '✅ 保存成功'; msg.style.color = '#389e0d'
      setTimeout(() => msg.innerText = '', 3000)
    }
  }

  // ================= 上传与解析 (含金额兜底计算) =================
  window.handleBillingUpload = async (e) => {
    const files = Array.from(e.target.files)
    const month = document.getElementById('bill-month').value
    const defaultWh = document.getElementById('bill-wh').value
    const msgEl = document.getElementById('billing-msg')
    
    if (files.length === 0 || !month) return alert('请选择文件并填写月份')

    msgEl.innerHTML = `<span style="color:#1677ff;">开始处理 ${files.length} 个文件，请稍候...</span>`
    let allPayloads = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      let currentWh = defaultWh
      if (file.name.includes('济南')) currentWh = '济南冻仓'
      else if (file.name.includes('西安')) currentWh = '西安冻仓'

      msgEl.innerHTML += `<br><span style="color:#666;">正在解析：${file.name}...</span>`

      try {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf)
        
        let targetWs = null
        for (let sheetName of wb.SheetNames) {
          if (sheetName.includes('总表') || sheetName.includes('汇总')) {
            targetWs = wb.Sheets[sheetName]; break
          }
        }
        if (!targetWs) {
           for (let sheetName of wb.SheetNames) {
              const testWs = wb.Sheets[sheetName]
              const testRows = XLSX.utils.sheet_to_json(testWs, { header: 1, defval: '' })
              if (testRows.length > 5 && testRows.some(r => r.includes('厂编'))) {
                 targetWs = testWs; break
              }
           }
        }
        if (!targetWs) throw new Error('未找到包含「厂编」的表格')

        const rawRows = XLSX.utils.sheet_to_json(targetWs, { header: 1, defval: '' })
        
        let headerRowIndex = -1, dataStartIndex = -1
        for (let r = 0; r < Math.min(15, rawRows.length); r++) {
          if (rawRows[r] && rawRows[r].some(cell => String(cell).trim() === '厂编')) {
            headerRowIndex = r; break
          }
        }
        if (headerRowIndex === -1) throw new Error('未找到「厂编」表头')

        for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
          const val = rawRows[r] && rawRows[r][1]
          if (val && /^\d+$/.test(String(val).trim())) { dataStartIndex = r; break }
        }
        if (dataStartIndex === -1) throw new Error('未找到有效数据行')

        let amountColIndex = 25
        const headerRow = rawRows[headerRowIndex] || []
        const mergeHeaderRow = rawRows[headerRowIndex + 1] || []
        for (let c = 0; c < Math.max(headerRow.length, mergeHeaderRow.length); c++) {
          const text = String(headerRow[c] || '') + String(mergeHeaderRow[c] || '')
          if (text.includes('含税') && (text.includes('金额') || text.includes('合计') || text.includes('总'))) {
            amountColIndex = c; break
          }
        }

        const vendorMap = new Map()
        const initDetails = () => ({ unloading: [], operation: [], storage: [], transit: [], dsp: [], gift: [], return: [] })

        for (let r = dataStartIndex; r < rawRows.length; r++) {
          const row = rawRows[r]
          const codeRaw = row[1]
          if (!codeRaw) continue
          const code = String(codeRaw).trim()
          if (!/^\d+$/.test(code)) continue 

          const getVal = (idx) => idx >= 0 && row[idx] ? Number(row[idx]) || 0 : 0
          
          let dbTotal = getVal(amountColIndex)
          
          // 汇总发生量
          const summary = {
            unloading: getVal(8), storage: getVal(10), operation: getVal(11),
            transit: getVal(15), dsp_east: getVal(16), dsp_west: getVal(17), dsp_nm: getVal(18)
          }

          // 🌟 金额兜底：如果抓取到的金额是 0，就根据费率自动算一个
          if (dbTotal === 0) {
            const r_rates = currentCfg.rates, r_taxes = currentCfg.taxes
            const calc = (qty, rate, tax) => (Number(qty)||0) * rate * (1 + tax)
            dbTotal = calc(summary.dsp_east, r_rates.dsp_east, r_taxes.transport) +
                      calc(summary.dsp_west, r_rates.dsp_west, r_taxes.transport) +
                      calc(summary.dsp_nm, r_rates.dsp_nm, r_taxes.transport) +
                      calc(summary.transit, r_rates.transit, r_taxes.transport) +
                      calc(summary.storage, r_rates.storage, r_taxes.storage) +
                      calc(summary.operation, r_rates.operation, r_taxes.storage) +
                      calc(summary.unloading, r_rates.unloading, r_taxes.unloading)
            dbTotal = Number(dbTotal.toFixed(2))
          }

          vendorMap.set(code, {
            bill_month: month, warehouse_code: currentWh, vendor_code: code,
            vendor_name: String(row[2] || ''), total_amount_tax: dbTotal,
            summary_data: summary,
            details_data: initDetails(), status: 'pending'
          })
        }

        if (vendorMap.size === 0) throw new Error('未提取到有效总表数据')

        const processDetailSheet = (sheetKeyword, dataKey) => {
          const sheetName = wb.SheetNames.find(n => n.includes(sheetKeyword))
          if (!sheetName) return
          const ws = wb.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
          
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r]
            if (!row || row.length === 0) continue
            let foundCode = null
            for (let c = 0; c < row.length; c++) {
              let val = row[c]
              if (val && typeof val === 'object') val = val.v || val.w || ''
              val = String(val).trim()
              const numMatch = val.match(/\d{5,}/)
              if (numMatch && vendorMap.has(numMatch[0])) { foundCode = numMatch[0]; break }
            }
            if (foundCode) {
              const cleanRow = row.map(cell => (cell && typeof cell === 'object') ? (cell.v || cell.w || '') : cell)
              vendorMap.get(foundCode).details_data[dataKey].push(cleanRow)
            }
          }
        }

        processDetailSheet('装卸', 'unloading')
        processDetailSheet('操作费', 'operation')
        processDetailSheet('储存清单', 'storage')
        processDetailSheet('储存板数', 'storage')
        processDetailSheet('西安干线', 'transit')
        processDetailSheet('DSP', 'dsp')
        processDetailSheet('赠品', 'gift')
        processDetailSheet('退货', 'return')

        allPayloads = allPayloads.concat(Array.from(vendorMap.values()))
        msgEl.innerHTML += ` <span style="color:#389e0d;">成功提取 ${vendorMap.size} 家</span>`
      } catch (err) {
        console.error(`解析文件 ${file.name} 失败:`, err)
        msgEl.innerHTML += ` <span style="color:#cf1322;">失败：${err.message}</span>`
      }
    }

    if (allPayloads.length === 0) return msgEl.innerHTML += `<br><br><span style="color:#cf1322; font-size:14px;">❌ 全部文件均未解析到有效数据。</span>`

    msgEl.innerHTML += `<br><span style="color:#1677ff;">正在写入数据库...</span>`
    try {
      const { error } = await ctx.supabase.from('vendor_billings').upsert(allPayloads, { onConflict: 'bill_month,warehouse_code,vendor_code' })
      if (error) throw error
      msgEl.innerHTML += `<br><br><span style="color:#389e0d; font-size:14px; font-weight:bold;">✅ 导入成功！共更新了 ${allPayloads.length} 家厂商。</span>`
      e.target.value = ''; loadBillingList(month)
    } catch (err) {
      msgEl.innerHTML += `<br><br><span style="color:#cf1322;">❌ 写入失败：${err.message}</span>`
    }
  }

  // ================= 列表加载与搜索 =================
  let globalBillingData = [] // 暂存数据用于搜索和预览

  window.loadBillingList = async (month) => {
    const box = document.getElementById('billing-list-box')
    const tbody = document.getElementById('billing-list-body')
    if (!month) { box.style.display = 'none'; return }

    box.style.display = 'block'; tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;">加载中...</td></tr>'
    
    const { data, error } = await ctx.supabase.from('vendor_billings')
      .select('*').eq('bill_month', month).order('warehouse_code').order('vendor_code')
      
    if (error) return tbody.innerHTML = `<tr><td colspan="6" style="color:#cf1322;">加载失败：${error.message}</td></tr>`
    
    globalBillingData = data || []
    renderList(globalBillingData)
  }

  const renderList = (list) => {
    const tbody = document.getElementById('billing-list-body')
    tbody.innerHTML = list.map(r => `<tr>
      <td>${r.vendor_code}</td><td>${r.vendor_name || ''}</td><td>${r.warehouse_code}</td>
      <td style="color:#cf1322; font-weight:bold;">¥ ${Number(r.total_amount_tax || 0).toFixed(2)}</td>
      <td>${r.status === 'confirmed' ? '<span style="color:#389e0d;">✅ 已确认</span>' : '<span style="color:#d46b08;">⏳ 待确认</span>'}</td>
      <td><button class="small secondary" onclick="window.previewAdminBilling('${r.vendor_code}')">查看</button></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;">无匹配数据</td></tr>'
  }

  document.getElementById('bill-search').oninput = (e) => {
    const kw = e.target.value.trim().toLowerCase()
    const filtered = globalBillingData.filter(r => 
      (r.vendor_code || '').includes(kw) || (r.vendor_name || '').toLowerCase().includes(kw)
    )
    renderList(filtered)
  }

  // ================= 管理端预览详情（与厂商端一模一样） =================
  window.previewAdminBilling = (vendorCode) => {
    const bill = globalBillingData.find(b => b.vendor_code === vendorCode)
    if (!bill) return alert('未找到数据')

    const previewBox = document.getElementById('admin-billing-preview')
    const contentBox = document.getElementById('admin-preview-content')
    
    const rates = currentCfg.rates
    const taxes = currentCfg.taxes
    const details = []
    
    const addDetail = (category, item, qty, rate, unit, taxRate, qtyUnit = unit) => {
      const q = Number(qty) || 0
      const untaxed = q * rate
      const tax = untaxed * taxRate
      details.push({ category, item, qty: q, rate, unit, qtyUnit, untaxed, tax, total: untaxed + tax, taxRate })
    }

    const sData = bill.summary_data || {}
    addDetail('运输', 'DSP省内(中/东区)', sData.dsp_east, rates.dsp_east, '箱', taxes.transport)
    addDetail('运输', 'DSP省外(西/西南)', sData.dsp_west, rates.dsp_west, '箱', taxes.transport)
    addDetail('运输', 'DSP省外(内蒙古)', sData.dsp_nm, rates.dsp_nm, '箱', taxes.transport)
    addDetail('运输', '干线代送', sData.transit, rates.transit, '箱', taxes.transport)
    addDetail('储存', '仓储费', sData.storage, rates.storage, '板/天', taxes.storage, '板')
    addDetail('储存', '操作费', sData.operation, rates.operation, '箱', taxes.storage)
    addDetail('装卸', '装卸费', sData.unloading, rates.unloading, '箱', taxes.unloading)

    const calcTotalTaxed = details.reduce((sum, d) => sum + d.total, 0)
    const displayTotal = Number(bill.total_amount_tax) > 0 ? Number(bill.total_amount_tax) : calcTotalTaxed

    contentBox.innerHTML = `
      <h2 style="margin-bottom:20px;">账单预览 - ${bill.vendor_name} (${bill.vendor_code})</h2>
      <div style="display:flex; gap:16px; margin-bottom:20px;">
        <div style="flex:1; background:#f8f9fa; padding:16px; border-radius:8px;"><div style="font-size:13px;color:#666;">月份</div><div style="font-size:16px;font-weight:bold;">${bill.bill_month}</div></div>
        <div style="flex:1; background:#f8f9fa; padding:16px; border-radius:8px;"><div style="font-size:13px;color:#666;">仓库</div><div style="font-size:16px;font-weight:bold;">${bill.warehouse_code}</div></div>
        <div style="flex:1; background:#f8f9fa; padding:16px; border-radius:8px;"><div style="font-size:13px;color:#666;">总金额</div><div style="font-size:20px;color:#cf1322;font-weight:bold;">¥ ${displayTotal.toFixed(2)}</div></div>
        <div style="flex:1; background:${bill.status === 'confirmed' ? '#f6ffed' : '#fff1f0'}; padding:16px; border-radius:8px;"><div style="font-size:13px;color:#666;">状态</div><div style="font-size:16px;font-weight:bold;color:${bill.status === 'confirmed' ? '#389e0d' : '#cf1322'};">${bill.status === 'confirmed' ? '✅ 已确认' : '⏳ 待确认'}</div></div>
      </div>
      
      <table style="margin-bottom:24px;">
        <thead style="background:#fafafa;"><tr><th>大类</th><th>项目</th><th>发生量</th><th>计费标准</th><th>税率</th><th style="text-align:right;">未税金额</th><th style="text-align:right;">税额</th><th style="text-align:right;">含税小计</th></tr></thead>
        <tbody>
          ${details.map(d => `<tr>
            <td>${d.category}</td><td>${d.item}</td><td>${d.qty} ${d.qtyUnit}</td><td>${d.rate} 元/${d.unit}</td><td>${(d.taxRate * 100).toFixed(0)}%</td>
            <td style="text-align:right;">${d.untaxed.toFixed(2)}</td><td style="text-align:right;">${d.tax.toFixed(2)}</td><td style="text-align:right;color:#cf1322;font-weight:bold;">${d.total.toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      
      <div style="text-align:right;">
        <button class="secondary" onclick="window.downloadAdminBillExcel('${vendorCode}')">📥 下载完整对账单</button>
      </div>
    `
    previewBox.style.display = 'block'
  }

  document.getElementById('btn-close-preview').onclick = () => {
    document.getElementById('admin-billing-preview').style.display = 'none'
  }

  // ================= 管理端下载对账单（代码与厂商端相同） =================
  window.downloadAdminBillExcel = (vendorCode) => {
    const bill = globalBillingData.find(b => b.vendor_code === vendorCode)
    if (!bill) return
    
    const rates = currentCfg.rates, taxes = currentCfg.taxes
    const details = []
    const sData = bill.summary_data || {}
    const addDetail = (c, i, q, r, u, t, qu = u) => { const qq=Number(q)||0; details.push({c, i, q: qq, r, u, qu, untaxed: qq*r, tax: qq*r*t, total: qq*r*(1+t), t}) }
    addDetail('运输', 'DSP省内(中/东区)', sData.dsp_east, rates.dsp_east, '箱', taxes.transport)
    addDetail('运输', 'DSP省外(西/西南)', sData.dsp_west, rates.dsp_west, '箱', taxes.transport)
    addDetail('运输', 'DSP省外(内蒙古)', sData.dsp_nm, rates.dsp_nm, '箱', taxes.transport)
    addDetail('运输', '干线代送', sData.transit, rates.transit, '箱', taxes.transport)
    addDetail('储存', '仓储费', sData.storage, rates.storage, '板/天', taxes.storage, '板')
    addDetail('储存', '操作费', sData.operation, rates.operation, '箱', taxes.storage)
    addDetail('装卸', '装卸费', sData.unloading, rates.unloading, '箱', taxes.unloading)

    const wb = XLSX.utils.book_new()
    const aoa = [
      [`应收账款确认单 (${bill.warehouse_code})`],
      [`厂编/厂名：`, bill.vendor_code, bill.vendor_name, '', '', '', '', ''],
      [`结算日期：`, `${bill.bill_month} 月`, '', '', '', '', '', ''],
      [],
      ['名称', '仓别', '计费科目', '单位', '计费标准', '发生量', '计费量', '未税费用']
    ]
    let sumUntaxed = 0
    details.forEach(d => {
      aoa.push([d.i, bill.warehouse_code, d.c, d.qu, d.r, d.q, d.q, d.untaxed.toFixed(2)])
      sumUntaxed += d.untaxed
    })
    aoa.push([], ['小计', '', '', '', '', '', '', sumUntaxed.toFixed(2)], [], ['发票注意事项：', '备注', '', '', '', '', '', ''], [], ['分类', '', '税率', '未税', '税额', '含税', '', ''])

    const tU = details.filter(d=>d.c==='运输').reduce((s,d)=>s+d.untaxed,0)
    const sU = details.filter(d=>d.c==='储存').reduce((s,d)=>s+d.untaxed,0)
    const uU = details.filter(d=>d.c==='装卸').reduce((s,d)=>s+d.untaxed,0)
    const tR = taxes.transport, sR = taxes.storage, uR = taxes.unloading
    aoa.push(['运费', '', tR, tU.toFixed(2), (tU*tR).toFixed(2), (tU*(1+tR)).toFixed(2), '确认人：', ''])
    aoa.push(['储存', '', sR, sU.toFixed(2), (sU*sR).toFixed(2), (sU*(1+sR)).toFixed(2), '审核人：', ''])
    aoa.push(['装卸', '', uR, uU.toFixed(2), (uU*uR).toFixed(2), (uU*(1+uR)).toFixed(2), '', ''])
    aoa.push(['合计', '', '', (tU+sU+uU).toFixed(2), (tU*tR+sU*sR+uU*uR).toFixed(2), (tU*(1+tR)+sU*(1+sR)+uU*(1+uR)).toFixed(2), '', ''])
    aoa.push([], ['', `您好，${bill.bill_month}月份的`, `${bill.warehouse_code}对账单，请核对确认完成后本月15日前回复，谢谢`])
    
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 15 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 15 }]
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, { s: { r: 1, c: 2 }, e: { r: 1, c: 7 } }, { s: { r: 2, c: 2 }, e: { r: 2, c: 7 } }, { s: { r: aoa.length - 1, c: 1 }, e: { r: aoa.length - 1, c: 7 } }]
    XLSX.utils.book_append_sheet(wb, ws, '结算单')

    const addDS = (name, arr, head) => {
      let sd = [head]
      if (arr && arr.length > 0) { const v = arr.filter(r => r && r.some(c => String(c).trim() !== '')); if (v.length > 0) sd = sd.concat(v) }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sd), name)
    }
    const dD = bill.details_data || {}
    addDS('装卸', dD.unloading, ['项目', '细项', '状态', '单号', '日期', '厂商编码', '厂商名称', '店编码', '店别', '商品编码', '商品名称', '规格', '单位', '件数', '数量'])
    addDS('操作费', dD.operation, ['序号', '单号', '领用类型', '行号', '单头备注', '领用日期', '商品代码', '商品名称', '包装规格', '单位', '货位', '容器', '件数', '数量', '生产日期', '批次', '供应商', '厂商名称', '仓位', '货主', '领用对象', '领用人', '状态'])
    addDS('储存清单', dD.storage, ['序号', '日期', '仓位', '货位', '货位用途', '温层', '容器条码', '商品代码', '商品名称', '包装规格', '库存状态', '单位', '库存件数', '库存数量', '生产日期', '批号', '到效期', '批次', '入库时间', '来源单号', '所属供应商', '厂商名称', '所属对象', '所属货主'])
    addDS('西安干线', dD.transit, ['序号', '收货单号', '订单号', '订单来源单号', '订单类型', '整单加工', '订单备注', '收货单状态', '收货人', '仓位', '商品代码', '商品名称', '包装规格', '结算单位', '单位', '收货件数', '收货数量', '金额', '容器', '收货时间', '生产日期', '到效期', '保质期', '上传时间', '供应商', '厂商名称', '卸货方式', '课别', '温层', '总重(kg)'])
    addDS('DSP', dD.dsp, ['序号', '收货单号', '订单号', '订单来源单号', '店号', '区域', '订单类型', '整单加工', '订单备注', '收货单状态', '收货人', '仓位', '商品代码', '商品名称', '包装规格', '单位', '收货件数', '收货数量', '金额', '容器', '收货时间', '生产日期', '到效期', '保质期', '上传时间', '供应商', '厂商名称', '卸货方式', '课别', '总重(kg)'])
    addDS('赠品&专柜', dD.gift, ['类别', '到货时间', '门店号', '要货方', '厂编', '厂商名称', '件数', '备注'])
    addDS('退货', dD.return, ['录单时间', '退货单时间', 'NT订单号', '货号', '商品', '规格', '店号', '店名', '厂编', '厂商', '退货数量（个）', '退货数量（个）2', '差异数量', '件数', '存储板数', '天数', '收费天数>7天', '收费板数', '通知厂商取退货时间', '提货日期', '存储库位', '备注'])

    XLSX.writeFile(wb, `${bill.vendor_code}_${bill.vendor_name}_${bill.bill_month}_对账单.xlsx`)
  }

  document.getElementById('bill-month').onchange = (e) => loadBillingList(e.target.value)
}

// ================= 3. 质检报告管理 =================
async function renderQCAdmin(v) {
  const { data: vendors } = await ctx.supabase.from('vendor_profile').select('vendor_code, vendor_name')
  const vMap = {}
  ;(vendors || []).forEach(x => { vMap[x.vendor_code] = x.vendor_name })

  let currentPage = 0
  const pageSize = 20
  let keyword = ''

  v.innerHTML = `
    <div class="card" style="box-shadow:none; padding:16px; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0; font-size:16px;">质检报告列表</h2>
        <div style="display:flex; gap:8px;">
          <input id="qc-search" placeholder="搜索厂编/厂商名/文件名" style="width:240px; margin:0;" value="${keyword}" />
          <button class="secondary" id="btn-qc-search">查询</button>
          <button class="secondary" id="btn-qc-export" style="background:#f6ffed; border-color:#b7eb8f; color:#389e0d;">导出 Excel</button>
        </div>
      </div>

      <div class="scroll" style="max-height: calc(100vh - 240px);">
        <table>
          <tr>
            <th>上传时间</th><th>厂编</th><th>厂商名称</th><th>文件名</th>
            <th>大小</th><th>操作</th>
          </tr>
          <tbody id="qc-body"></tbody>
        </table>
      </div>
      <div id="qc-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;"></div>
    </div>`

  const loadData = async (page = 0) => {
    currentPage = page
    const tbody = document.getElementById('qc-body')
    if (!tbody) return
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;">加载中...</td></tr>'

    let matchedCodes = []
    if (keyword) {
      const kw = keyword.toLowerCase()
      const matchVps = (vendors || []).filter(v => 
        (v.vendor_code || '').toLowerCase().includes(kw) || 
        (v.vendor_name || '').toLowerCase().includes(kw)
      )
      matchedCodes = matchVps.map(v => v.vendor_code)
    }

    let q = ctx.supabase.from('qc_report').select('*', { count: 'exact' })
    
    if (keyword) {
      if (matchedCodes.length > 0) {
        q = q.or(`report_name.ilike.%${keyword}%,vendor_code.in.(${matchedCodes.join(',')})`)
      } else {
        q = q.ilike('report_name', `%${keyword}%`)
      }
    }

    const from = currentPage * pageSize
    const to = from + pageSize - 1
    q = q.order('created_at', { ascending: false }).range(from, to)

    const { data, error, count } = await q

    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#cf1322;">加载失败：${error.message}</td></tr>`
      return
    }

    tbody.innerHTML = (data || []).map(r => {
      const sizeMB = ((r.file_size || 0) / 1024 / 1024).toFixed(2)
      const timeStr = new Date(new Date(r.created_at).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)
      return `<tr>
        <td>${timeStr}</td>
        <td>${r.vendor_code}</td>
        <td>${vMap[r.vendor_code] || '-'}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.report_name}">
          <a href="${r.file_url}" target="_blank" style="color:#1677ff; text-decoration:none;">${r.report_name}</a>
        </td>
        <td>${sizeMB} MB</td>
        <td>
          <button class="small secondary" data-download="${r.file_url}" data-name="${r.report_name}">下载</button>
          ${isSuper() ? `<button class="small danger" data-del-id="${r.id}" data-path="${r.file_path}" style="margin-left:8px;">删除</button>` : ''}
        </td>
      </tr>`
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;">无匹配数据</td></tr>'

    const totalPages = Math.ceil((count || 0) / pageSize)
    const pageEl = document.getElementById('qc-pagination')
    if (pageEl) {
      pageEl.innerHTML = `
        <span style="font-size:13px;color:#666;">共 ${count || 0} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
        <button class="secondary small" id="btn-qc-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
        <button class="secondary small" id="btn-qc-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
      `
      document.getElementById('btn-qc-prev').onclick = () => { if (currentPage > 0) loadData(currentPage - 1) }
      document.getElementById('btn-qc-next').onclick = () => { if (currentPage < totalPages - 1) loadData(currentPage + 1) }
    }

    bindActions()
  }

  const bindActions = () => {
    v.querySelectorAll('[data-download]').forEach(btn => {
      btn.onclick = () => {
        const url = btn.dataset.download
        const name = btn.dataset.name
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.target = '_blank'
        a.click()
      }
    })

    v.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.onclick = async () => {
        if (!isSuper()) return alert('只有超级管理员可以删除')
        const id = Number(btn.dataset.delId)
        const path = btn.dataset.path
        if (!confirm(`确定要删除这份质检报告吗？\n\n物理文件也会从 R2 存储中彻底删除！`)) return

        btn.disabled = true
        btn.innerText = '删除中...'

        try {
          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await safeFetch(`/functions/v1/delete-qc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ filePath: path })
          })

          if (!res.ok) throw new Error('R2 文件删除失败')

          const { error } = await ctx.supabase.from('qc_report').delete().eq('id', id)
          if (error) throw new Error('数据库删除失败: ' + error.message)

          await logOp('delete_qc', '删除质检报告 ' + path)
          alert('删除成功')
          loadData(currentPage)
        } catch (err) {
          alert('删除失败：' + err.message)
          btn.disabled = false
          btn.innerText = '删除'
        }
      }
    })
  }

  document.getElementById('btn-qc-search').onclick = () => {
    keyword = document.getElementById('qc-search').value.trim()
    loadData(0)
  }
  document.getElementById('qc-search').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('btn-qc-search').click()
  }

  document.getElementById('btn-qc-export').onclick = async () => {
    try {
      let allReports = []
      let page = 0
      let hasMore = true
      
      while(hasMore) {
        let q = ctx.supabase.from('qc_report').select('*')
          .order('created_at', { ascending: false })
          .range(page * 1000, (page + 1) * 1000 - 1)
        
        if (keyword) {
          let matchedCodes = []
          const kw = keyword.toLowerCase()
          const matchVps = (vendors || []).filter(v => 
            (v.vendor_code || '').toLowerCase().includes(kw) || 
            (v.vendor_name || '').toLowerCase().includes(kw)
          )
          matchedCodes = matchVps.map(v => v.vendor_code)

          if (matchedCodes.length > 0) {
            q = q.or(`report_name.ilike.%${keyword}%,vendor_code.in.(${matchedCodes.join(',')})`)
          } else {
            q = q.ilike('report_name', `%${keyword}%`)
          }
        }

        const { data, error } = await q
        if (error) throw error

        if (data && data.length > 0) {
          allReports = allReports.concat(data)
          page++
          if (data.length < 1000) hasMore = false
        } else {
          hasMore = false
        }
      }

      const listToExport = allReports.map(r => ({
        '上传时间': new Date(new Date(r.created_at).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19),
        '厂编': r.vendor_code,
        '厂商名称': vMap[r.vendor_code] || '',
        '文件名': r.report_name,
        '文件大小(MB)': ((r.file_size || 0) / 1024 / 1024).toFixed(2),
        '下载链接': r.file_url
      }))

      if (!listToExport.length) return alert('无数据可导出')

      const ws = XLSX.utils.json_to_sheet(listToExport)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '质检报告汇总')
      XLSX.writeFile(wb, `质检报告汇总_${new Date().getTime()}.xlsx`)
      logOp('export_qc', '导出质检报告数据')
    } catch(e) {
      alert('导出失败：' + e.message)
    }
  }

  loadData(0)
}

// ================= 4. 厂商管理 =================
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
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="margin:0;">厂商列表（<span id="v-total-count">${vps.length}</span>）</h2>
        <div style="display:flex; align-items:center; gap:8px; width:300px;">
          <input id="v-search" placeholder="输入厂编/名称/联系人/手机/仓库搜索" style="margin:0;" />
          <button class="secondary small" id="btn-v-clear" style="display:none; padding:8px;">清空</button>
        </div>
      </div>
      <div class="scroll">
        <table>
          <tr><th>厂编</th><th>名称</th><th>联系人</th><th>手机</th><th>授权仓库</th><th>状态</th><th>操作</th></tr>
          <tbody id="v-table-body"></tbody>
        </table>
      </div>
      <div id="v-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;"></div>
    </div>
    <div id="vendor-edit-panel"></div>`

  let currentPage = 0
  const pageSize = 20
  let keyword = ''

  const renderVendorTable = () => {
    const kw = keyword.toLowerCase().trim()
    const filtered = vps.filter(p => {
      const whsStr = (vwMap[p.id] || []).join(', ').toLowerCase()
      const matchCode = (p.vendor_code || '').toLowerCase().includes(kw)
      const matchName = (p.vendor_name || '').toLowerCase().includes(kw)
      const matchContact = (p.contact_name || '').toLowerCase().includes(kw)
      const matchPhone = (p.contact_phone || '').includes(kw)
      const matchWh = whsStr.includes(kw)
      return matchCode || matchName || matchContact || matchPhone || matchWh
    })

    const totalEl = document.getElementById('v-total-count')
    if (totalEl) totalEl.innerText = kw ? `${filtered.length}/${vps.length}` : vps.length

    const totalPages = Math.ceil(filtered.length / pageSize)
    const paginated = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

    const tbody = document.getElementById('v-table-body')
    if (!tbody) return
    
    tbody.innerHTML = paginated.map(p => `<tr>
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
        <button class="small secondary" data-act="reset" data-id="${p.id}" data-code="${p.vendor_code}">重置密码</button>
        ${isSuper() ? `<button class="small danger" data-act="del" data-id="${p.id}" data-code="${p.vendor_code}">删除</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;">暂无匹配数据</td></tr>'

    const pageEl = document.getElementById('v-pagination')
    if (pageEl) {
      pageEl.innerHTML = `
        <span style="font-size:13px;color:#666;">共 ${filtered.length} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
        <button class="secondary small" id="btn-v-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
        <button class="secondary small" id="btn-v-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
      `
      document.getElementById('btn-v-prev').onclick = () => { if (currentPage > 0) { currentPage--; renderVendorTable(); } }
      document.getElementById('btn-v-next').onclick = () => { if (currentPage < totalPages - 1) { currentPage++; renderVendorTable(); } }
    }

    bindTableActions()
  }

  const bindTableActions = () => {
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
            await logOp('update_vendor', '厂商 ' + p.vendor_code, {
              fields: ['vendor_name','contact_name','contact_phone']
            })
            alert('已保存')
            renderTab('vendors')
          }
          return
        }

        if (act === 'toggle') {
          const enable = b.dataset.enable === '1'
          const action = enable ? '启用' : '禁用'
          const p = vps.find(x => x.id === id)
          if (!confirm(`确定${action}该厂商？`)) return
          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await safeFetch(`/functions/v1/toggle-user-status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ user_id: id, account_type: 'vendor', enable })
          })
          const json = await res.json()
          if (res.ok) {
            await logOp('toggle_vendor', '厂商 ' + (p?.vendor_code || id), { enable })
            alert(`已${action}`)
            renderTab('vendors')
          } else {
            alert(`${action}失败：` + ctx.translateError(json.error || '未知错误'))
          }
          return
        }

        if (act === 'grant') {
          const code = b.dataset.code
          const cur = (vwMap[id]||[]).join(',')
          const input = prompt(`输入授权仓库代码（逗号分隔），当前：${cur}`, cur)
          if (input === null) return
          const codes = input.split(',').map(s => s.trim()).filter(Boolean)
          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await safeFetch(`/functions/v1/grant-warehouse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ vendor_id: id, vendor_code: code, warehouse_codes: codes })
          })
          if (res.ok) {
            await logOp('grant_vendor_warehouse', '厂商 ' + code, { warehouse_codes: codes })
            alert('授权成功')
            renderTab('vendors')
          } else {
            alert('授权失败，请重试')
          }
          return
        }

        if (act === 'reset') {
          const p = vps.find(x => x.id === id)
          const pwd = prompt('输入新密码（至少 6 位）')
          if (!pwd || pwd.length < 6) return alert('密码太短')
          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await safeFetch(`/functions/v1/reset-password`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ user_id: id, new_password: pwd })
          })
          if (res.ok) {
            await logOp('reset_vendor_pwd', '厂商 ' + (p?.vendor_code || id))
            alert('重置成功')
          } else {
            alert('重置失败，请重试')
          }
          return
        }

        if (act === 'del') {
          const code = b.dataset.code
          if (!confirm(`确定删除厂商「${code}」？\n\n会同时删除：\n- Auth 用户\n- 厂商档案\n- 仓库授权\n\n此操作不可撤销！`)) return

          const { data: { session } } = await ctx.supabase.auth.getSession()
          const res = await safeFetch(`/functions/v1/delete-vendor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ vendor_id: id })
          })
          const json = await res.json()
          if (res.ok) {
            await logOp('delete_vendor', '厂商 ' + code)
            alert('已删除')
            renderTab('vendors')
          } else {
            alert('删除失败：' + ctx.translateError(json.error || '未知错误'))
          }
          return
        }
      }
    })
  }

  const searchInput = document.getElementById('v-search')
  const clearBtn = document.getElementById('btn-v-clear')
  if (searchInput && clearBtn) {
    searchInput.oninput = (e) => {
      const val = e.target.value
      clearBtn.style.display = val ? 'block' : 'none'
      keyword = val
      currentPage = 0
      renderVendorTable()
    }
    clearBtn.onclick = () => {
      searchInput.value = ''
      clearBtn.style.display = 'none'
      keyword = ''
      currentPage = 0
      renderVendorTable()
    }
  }
  renderVendorTable()

  document.getElementById('btn-create-vendor').onclick = async () => {
    const whSel = document.getElementById('v-wh')
    const whsSel = Array.from(whSel.selectedOptions).map(o => o.value)
    if (!whsSel.length) return document.getElementById('vendor-msg').innerHTML = ctx.msg('请选择授权仓库', false)
    const code = document.getElementById('v-code').value.trim()
    const name = document.getElementById('v-name').value.trim()
    const contact = document.getElementById('v-contact').value.trim()
    const phone = document.getElementById('v-phone').value.trim()
    const pwd = document.getElementById('v-pwd').value
    if (!code || !name || !contact || !phone || !pwd) {
      return document.getElementById('vendor-msg').innerHTML = ctx.msg('厂编、名称、联系人、手机号、密码为必填', false)
    }
    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await safeFetch(`/functions/v1/create-vendor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        vendor_code: code, vendor_name: name,
        contact_name: contact, contact_phone: phone,
        password: pwd, warehouse_codes: whsSel
      })
    })
    const json = await res.json()
    if (res.ok) {
      document.getElementById('vendor-msg').innerHTML = ctx.msg(`创建成功，登录邮箱：${json.email}`, true)
      await logOp('create_vendor', '厂商 ' + code, { vendor_name: name, contact_name: contact })
      renderTab('vendors')
    } else {
      document.getElementById('vendor-msg').innerHTML = ctx.msg(ctx.translateError(json.error), false)
    }
  }

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
            const res = await safeFetch(`/functions/v1/create-vendor`, {
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
            if (res.ok && json.ok) success.push(item)
            else failed.push({ ...item, error: json.error || '未知错误' })
          } catch (e) {
            failed.push({ ...item, error: String(e) })
          }
        }

        await logOp('batch_import_vendor', '批量导入厂商', {
          total: list.length,
          success: success.length,
          failed: failed.length,
          success_list: success.map(x => x.vendor_code),
          failed_list: failed.map(x => ({ vendor_code: x.vendor_code, error: x.error }))
        })

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
        if (success.length > 0) setTimeout(() => renderTab('vendors'), 2000)
      }
    } catch (e) {
      msgEl.innerHTML = ctx.msg('解析失败：' + e.message, false)
    }
  }
}

// ================= 4.5 物流商管理 =================
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
    if (!input || !suggest) return

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
        <input id="lg-code" placeholder="物流商编号 (必须 999 开头) *" />
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
              <button class="small secondary" data-act="reset" data-id="${p.id}" data-code="${p.vendor_code}">重置密码</button>
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
    if (!/^999\d+$/.test(code)) {
      msgEl.innerHTML = ctx.msg('物流商编号必须是以 999 开头的纯数字（如 999001）', false);
      return
    }
    if (!name) { msgEl.innerHTML = ctx.msg('请填写物流商名称', false); return }
    if (!pwd || pwd.length < 6) { msgEl.innerHTML = ctx.msg('密码至少 6 位', false); return }
    if (!codes.length) { msgEl.innerHTML = ctx.msg('请至少选择一个负责厂商', false); return }

    msgEl.innerHTML = ctx.msg('创建中...', true)

    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await safeFetch(`/functions/v1/create-logistics`, {
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
      await logOp('create_logistics', '物流商 ' + code, { vendor_codes: codes })
      renderTab('logistics')
    } else {
      msgEl.innerHTML = ctx.msg(ctx.translateError(json.error || '创建失败'), false)
    }
  }

  v.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id
      const act = b.dataset.act
      const code = b.dataset.code

      if (act === 'manage-vendors') {
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
          const res = await safeFetch(`/functions/v1/grant-logistics-vendors`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ logistics_id: id, vendor_codes: finalCodes })
          })
          if (res.ok) {
            await logOp('grant_logistics_vendors', '物流商 ' + code, { vendor_codes: finalCodes })
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
        const res = await safeFetch(`/functions/v1/reset-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ user_id: id, new_password: pwd })
        })
        if (res.ok) {
          await logOp('reset_logistics_pwd', '物流商 ' + code)
          alert('重置成功')
        } else {
          alert('重置失败，请重试')
        }
        return
      }

      if (act === 'del') {
        if (!confirm(`确定删除物流商「${code}」？\n\n会同时删除：\n- Auth 用户\n- 物流商档案\n- 负责厂商关联\n\n此操作不可撤销！`)) return

        const { data: { session } } = await ctx.supabase.auth.getSession()
        const res = await safeFetch(`/functions/v1/delete-logistics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ logistics_id: id })
        })
        const json = await res.json()
        if (res.ok) {
          await logOp('delete_logistics', '物流商 ' + code)
          alert('已删除')
          renderTab('logistics')
        } else {
          alert('删除失败：' + ctx.translateError(json.error || '未知错误'))
        }
        return
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
    const res = await safeFetch(`/functions/v1/create-admin`, {
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
        const res = await safeFetch(`/functions/v1/toggle-user-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
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
        const res = await safeFetch(`/functions/v1/reset-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
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
    <div class="tabs" id="base-tabs">
      <button data-t="wh" class="active">仓库</button>
      <button data-t="store">门店</button>
      <button data-t="product">商品主数据</button>
      <button data-t="deadline">提报时间段</button>
      <button data-t="holiday">节假日</button>
      <button data-t="bypass">强制放行</button>
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
  if (key === 'store') return renderStore(v)
  if (key === 'product') return renderProduct(v)
  if (key === 'deadline') return renderDeadline(v)
  if (key === 'holiday') return renderHoliday(v)
  if (key === 'bypass') return renderBypass(v)
}

// ===== 6.1 仓库 =====
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
      <div class="card" style="box-shadow:none;padding:0 0 16px;">
        <h2>仓库</h2>
        <div class="row">
          <input id="w-code" placeholder="仓库代码 *" />
          <input id="w-name" placeholder="仓库名称 *" />
          <input id="w-region" placeholder="区域" />
          <button id="btn-w-add">新增</button>
        </div>
        <div id="w-msg"></div>
        <table>
          <tr><th>代码</th><th>名称</th><th>区域</th><th>默认门店</th><th>状态</th><th>操作</th></tr>
          <tbody>${list.map(r=>`<tr ${r.warehouse_code===selectedCode?'style="background:#e6f4ff;"':''}>
            <td><a href="javascript:;" data-pick-wh="${r.warehouse_code}" style="color:#1677ff;">${r.warehouse_code}</a></td>
            <td>${r.warehouse_name}</td><td>${r.region||''}</td>
            <td>${r.default_store_code||'-'}</td>
            <td>${r.status===1?'启用':'停用'}</td>
            <td>${isSuper() ? `<button class="small danger" data-del-wh="${r.id}" data-code="${r.warehouse_code}">删除</button>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="card" style="box-shadow:none;padding:0 0 16px;">
        <h2>当前仓库：${sel ? sel.warehouse_code + ' ' + sel.warehouse_name : '未选择'}</h2>
        <div class="row">
          <input id="l-code" placeholder="仓位代码 *" />
          <input id="l-name" placeholder="仓位名称" />
          <button id="btn-l-add">新增仓位</button>
        </div>
        <div id="l-msg"></div>
        <table>
          <tr><th>仓位代码</th><th>名称</th><th>单据数</th><th>状态</th><th>操作</th></tr>
          <tbody>${locs.map(r=>`<tr>
            <td>${r.location_code}</td><td>${r.location_name||''}</td><td>${r.bill_count||0}</td>
            <td>${r.status===1?'启用':'停用'}</td>
            <td>${isSuper() ? `<button class="small danger" data-del-loc="${r.id}" data-code="${r.location_code}">删除</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="5">无数据</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card" style="box-shadow:none;padding:0;">
        <h2>仓位映射（只读）</h2>
        <div class="scroll">
          <table>
            <tr><th>仓位代码</th><th>仓库代码</th><th>仓库名称</th><th>状态</th></tr>
            <tbody>${maps.map(r=>`<tr>
              <td>${r.location_code}</td><td>${r.warehouse_code}</td>
              <td>${r.warehouse_name||''}</td><td>${r.status===1?'启用':'停用'}</td>
            </tr>`).join('') || '<tr><td colspan="4">无数据</td></tr>'}</tbody>
          </table>
        </div>
      </div>`

    v.querySelectorAll('[data-pick-wh]').forEach(a => {
      a.onclick = () => { selectedCode = a.dataset.pickWh; renderAll() }
    })

    document.getElementById('btn-w-add').onclick = async () => {
      const code = document.getElementById('w-code').value.trim()
      const name = document.getElementById('w-name').value.trim()
      const region = document.getElementById('w-region').value.trim() || null
      if (!code || !name) return
      const { error } = await ctx.supabase.from('warehouse').insert({ warehouse_code: code, warehouse_name: name, region })
      if (error) {
        document.getElementById('w-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
        return
      }
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
      if (error) {
        document.getElementById('l-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
        return
      }
      await ctx.supabase.from('location_warehouse_map').insert({ location_code: code, warehouse_code: selectedCode, warehouse_name: sel?.warehouse_name || null })
      await logOp('create_location', '仓位 ' + selectedCode + '/' + code)
      document.getElementById('l-msg').innerHTML = ctx.msg('已新增', true)
      renderAll()
    }

    v.querySelectorAll('[data-del-wh]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.delWh
        const code = b.dataset.code
        const { data: cnt } = await ctx.supabase.from('location_config').select('id').eq('warehouse_code', code).limit(1)
        if (cnt && cnt.length) return alert('该仓库下还有仓位，请先删除仓位')
        if (!confirm('确定删除该仓库？')) return
        const { error } = await ctx.supabase.from('warehouse').delete().eq('id', id)
        if (error) return alert(ctx.translateError(error.message))
        await logOp('delete_warehouse', '仓库 ' + code)
        renderWh(v)
      }
    })

    v.querySelectorAll('[data-del-loc]').forEach(b => {
      b.onclick = async () => {
        const code = b.dataset.code
        if (!confirm('确定删除该仓位？')) return
        const { error } = await ctx.supabase.from('location_config').delete().eq('id', b.dataset.delLoc)
        if (error) return alert(ctx.translateError(error.message))
        await logOp('delete_location', '仓位 ' + code)
        renderAll()
      }
    })
  }

  renderAll()
}

// ===== 6.2 门店 =====
async function renderStore(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)
  const { data } = await ctx.supabase.from('store_config_detail').select('*')

  let currentPage = 0
  const pageSize = 20
  let keyword = ''

  v.innerHTML = `
    <div class="card" style="box-shadow:none; padding:16px;">
      <div class="row" style="margin-bottom:12px;">
        <select id="s-wh" style="flex:1; margin:0;">
          <option value="">全部仓库</option>
          ${(whs||[]).map(w=>`<option value="${w.warehouse_code}">${w.warehouse_name}</option>`).join('')}
        </select>
        <input id="s-search" placeholder="搜索门店代码/名称" style="flex:2; margin:0;" value="${keyword}" />
        <button id="btn-s-search" class="secondary" style="flex:0 0 80px;">查询</button>
      </div>
      <div class="row" style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid #eee;">
        <input id="s-code" placeholder="门店代码 *" style="flex:1; margin:0;" />
        <input id="s-name" placeholder="门店名称" style="flex:2; margin:0;" />
        <button id="btn-s-add" style="flex:0 0 100px;">新增</button>
      </div>
      <div id="s-msg"></div>
      
      <div class="scroll">
        <table>
          <tr><th>仓库</th><th>门店代码</th><th>名称</th><th>单据数</th><th>操作</th></tr>
          <tbody id="store-body"></tbody>
        </table>
      </div>
      <div id="store-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;"></div>
    </div>`

  const loadData = () => {
    const tbody = document.getElementById('store-body')
    if (!tbody) return

    const whFilter = document.getElementById('s-wh').value
    const kw = keyword.toLowerCase()

    const filtered = (data || []).filter(r => {
      if (whFilter && r.warehouse_code !== whFilter) return false
      if (kw) {
        const matchCode = (r.store_code || '').toLowerCase().includes(kw)
        const matchName = (r.store_name || '').toLowerCase().includes(kw)
        if (!matchCode && !matchName) return false
      }
      return true
    })

    const totalPages = Math.ceil(filtered.length / pageSize)
    const paginated = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

    tbody.innerHTML = paginated.map(r => `<tr>
      <td>${r.warehouse_name||''}</td><td>${r.store_code}</td><td>${r.store_name||''}</td>
      <td>${r.bill_count||0}</td>
      <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-code="${r.store_code}">删除</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;">无匹配数据</td></tr>'

    const pageEl = document.getElementById('store-pagination')
    if (pageEl) {
      pageEl.innerHTML = `
        <span style="font-size:13px;color:#666;">共 ${filtered.length} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
        <button class="secondary small" id="btn-s-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
        <button class="secondary small" id="btn-s-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
      `
      document.getElementById('btn-s-prev').onclick = () => { if (currentPage > 0) { currentPage--; loadData(); } }
      document.getElementById('btn-s-next').onclick = () => { if (currentPage < totalPages - 1) { currentPage++; loadData(); } }
    }

    v.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('确定删除？')) return
        const { error } = await ctx.supabase.from('store_config').delete().eq('id', b.dataset.del)
        if (error) return alert(ctx.translateError(error.message))
        await logOp('delete_store', '门店 ' + b.dataset.code)
        renderStore(v)
      }
    })
  }

  document.getElementById('btn-s-search').onclick = () => {
    keyword = document.getElementById('s-search').value.trim()
    currentPage = 0
    loadData()
  }
  document.getElementById('s-search').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('btn-s-search').click()
  }
  document.getElementById('s-wh').onchange = () => {
    currentPage = 0
    loadData()
  }

  document.getElementById('btn-s-add').onclick = async () => {
    const code = document.getElementById('s-code').value.trim()
    if (!code) return
    const { error } = await ctx.supabase.from('store_config').insert({
      warehouse_code: document.getElementById('s-wh').value || null,
      store_code: code,
      store_name: document.getElementById('s-name').value.trim() || null,
      created_by: ctx.operatorName
    })
    if (error) {
      document.getElementById('s-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    await logOp('create_store', '门店 ' + code)
    document.getElementById('s-msg').innerHTML = ctx.msg('已新增', true)
    renderStore(v)
  }

  loadData()
}

// ===== 6.3 商品主数据 =====
async function renderProduct(v) {
  const { data: whs } = await ctx.supabase.from('warehouse').select('*').eq('status', 1)

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
        <input id="pm-code" placeholder="货号 *" />
        <input id="pm-vendor" placeholder="厂编 *" />
      </div>
      <div class="row">
        <input id="pm-name" placeholder="品名 *" />
        <input id="pm-spec" placeholder="规格 * (1*1*X)" />
      </div>
      <div class="row">
        <input id="pm-length" type="number" step="0.01" min="0.01" placeholder="长 (cm) *" />
        <input id="pm-width"  type="number" step="0.01" min="0.01" placeholder="宽 (cm) *" />
        <input id="pm-height" type="number" step="0.01" min="0.01" placeholder="高 (cm) *" />
        <input id="pm-weight" type="number" step="0.01" min="0.01" placeholder="重量 (kg) *" />
      </div>
      <button id="btn-pm-add">新增商品</button>
      <div id="pm-msg"></div>
    </div>
    
    <div class="card" style="box-shadow:none;padding:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:16px;">
          <h2 style="margin:0;">商品列表</h2>
          <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#cf1322; cursor:pointer; font-weight:bold;">
            <input type="checkbox" id="chk-invalid" style="width:auto; margin:0;" /> 仅显示资料不完善的商品
          </label>
        </div>
        <div style="display:flex; gap:8px;">
          <input id="prod-search" placeholder="搜索货号/品名/厂编" style="width:200px; margin:0;" />
          <button class="secondary" id="btn-prod-search">查询</button>
          <button class="secondary" id="btn-export-products" style="background:#f6ffed; border-color:#b7eb8f; color:#389e0d;">导出 Excel</button>
        </div>
      </div>
      <div class="scroll" style="max-height: calc(100vh - 500px);">
        <table>
          <tr><th>仓库</th><th>货号</th><th>商品名称</th><th>规格</th><th>长×宽×高</th><th>重量</th><th>默认厂编</th><th>操作</th></tr>
          <tbody id="prod-body">
            <tr><td colspan="8" style="text-align:center;color:#999;">加载中...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="prod-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;"></div>
    </div>`

  let currentPage = 0
  const pageSize = 50
  let keyword = ''
  let onlyInvalid = false

  const loadProducts = async (page = 0) => {
    currentPage = page
    const prodBody = document.getElementById('prod-body')
    if (!prodBody) return
    prodBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;">加载中...</td></tr>'
    
    let q = ctx.supabase.from('product_master').select('*', { count: 'exact' })
    if (keyword) {
      q = q.or(`product_code.ilike.%${keyword}%,product_name.ilike.%${keyword}%,default_vendor_code.ilike.%${keyword}%`)
    }
    if (onlyInvalid) {
      q = q.or('length.is.null,length.lte.0,width.is.null,width.lte.0,height.is.null,height.lte.0,weight.is.null,weight.lte.0')
    }

    const from = page * pageSize
    const to = from + pageSize - 1
    q = q.order('id', { ascending: false }).range(from, to)

    const { data, error, count } = await q
    
    const currentProdBody = document.getElementById('prod-body')
    if (!currentProdBody) return
    
    if (error) {
      currentProdBody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#cf1322;">加载失败：${error.message}</td></tr>`
      return
    }

    currentProdBody.innerHTML = (data || []).map(r => {
      const isSpecValid = r.spec && /^1\*1\*[1-9]\d*$/.test(String(r.spec).trim())
      const isSizeValid = r.length > 0 && r.width > 0 && r.height > 0 && r.weight > 0
      const isNameValid = r.product_name && r.product_name.trim() !== ''
      const invalid = !(isSpecValid && isSizeValid && isNameValid)

      return `<tr style="${invalid ? 'background:#fff1f0;' : ''}">
        <td>${r.warehouse_code||''}</td>
        <td>${r.product_code}</td>
        <td>${r.product_name||'<span style="color:#cf1322;">缺失</span>'}</td>
        <td>${r.spec||'<span style="color:#cf1322;">缺失</span>'}</td>
        <td>${r.length ?? '0'}×${r.width ?? '0'}×${r.height ?? '0'} cm</td>
        <td>${r.weight ?? '0'} kg</td>
        <td>${r.default_vendor_code||''}</td>
        <td>
          ${isSuper() ? `<button class="small danger" data-del="${r.id}" data-code="${r.product_code}">删除</button>` : ''}
        </td>
      </tr>`
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无数据</td></tr>'

    const totalPages = Math.ceil((count || 0) / pageSize)
    const pageEl = document.getElementById('prod-pagination')
    if (pageEl) {
      pageEl.innerHTML = `
        <span style="font-size:13px;color:#666;">共 ${count || 0} 条记录，第 ${totalPages === 0 ? 0 : page + 1} / ${totalPages} 页</span>
        <button class="secondary small" id="btn-page-prev" ${page === 0 ? 'disabled' : ''} style="${page === 0 ? 'opacity:0.5;' : ''}">上一页</button>
        <button class="secondary small" id="btn-page-next" ${page >= totalPages - 1 ? 'disabled' : ''} style="${page >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
      `
      document.getElementById('btn-page-prev').onclick = () => { if (page > 0) loadProducts(page - 1) }
      document.getElementById('btn-page-next').onclick = () => { if (page < totalPages - 1) loadProducts(page + 1) }
    }
    
    v.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('确定删除？')) return
        const { error } = await ctx.supabase.from('product_master').delete().eq('id', b.dataset.del)
        if (error) return alert(ctx.translateError(error.message))
        await logOp('delete_product', '商品 ' + b.dataset.code)
        loadProducts(currentPage)
      }
    })
  }

  document.getElementById('chk-invalid').onchange = (e) => {
    onlyInvalid = e.target.checked
    loadProducts(0)
  }
  
  document.getElementById('btn-prod-search').onclick = () => {
    keyword = document.getElementById('prod-search').value.trim()
    loadProducts(0)
  }
  document.getElementById('prod-search').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('btn-prod-search').click()
  }

  document.getElementById('btn-export-products').onclick = async () => {
    try {
      let allProducts = []
      let page = 0
      let hasMore = true

      while(hasMore) {
        let q = ctx.supabase.from('product_master').select('*')
          .order('id', { ascending: false })
          .range(page * 1000, (page + 1) * 1000 - 1)
        
        if (keyword) {
          q = q.or(`product_code.ilike.%${keyword}%,product_name.ilike.%${keyword}%,default_vendor_code.ilike.%${keyword}%`)
        }
        if (onlyInvalid) {
          q = q.or('length.is.null,length.lte.0,width.is.null,width.lte.0,height.is.null,height.lte.0,weight.is.null,weight.lte.0')
        }

        const { data, error } = await q
        if (error) throw error

        if (data && data.length > 0) {
          allProducts = allProducts.concat(data)
          page++
          if (data.length < 1000) hasMore = false
        } else {
          hasMore = false
        }
      }

      if (!allProducts.length) return alert('无数据可导出')

      const listToExport = allProducts.map(r => ({
        '仓库代码': r.warehouse_code,
        '货号': r.product_code,
        '商品名称': r.product_name,
        '包装规格': r.spec,
        '长(cm)': r.length,
        '宽(cm)': r.width,
        '高(cm)': r.height,
        '重量(kg)': r.weight,
        '默认厂编': r.default_vendor_code
      }))

      const ws = XLSX.utils.json_to_sheet(listToExport)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '商品主数据')
      XLSX.writeFile(wb, `商品主数据_${new Date().getTime()}.xlsx`)
    } catch(e) {
      alert('导出失败：' + e.message)
    }
  }

  document.getElementById('btn-pm-add').onclick = async () => {
    const msgEl = document.getElementById('pm-msg')
    const wh     = document.getElementById('pm-wh').value
    const code   = document.getElementById('pm-code').value.trim()
    const vendor = document.getElementById('pm-vendor').value.trim()
    const name   = document.getElementById('pm-name').value.trim()
    const spec   = document.getElementById('pm-spec').value.trim()
    const length = document.getElementById('pm-length').value.trim()
    const width  = document.getElementById('pm-width').value.trim()
    const height = document.getElementById('pm-height').value.trim()
    const weight = document.getElementById('pm-weight').value.trim()

    if (!code || !vendor || !name) {
      msgEl.innerHTML = ctx.msg('货号、厂编、品名为必填', false); return
    }
    if (!/^\d+$/.test(code)) {
      msgEl.innerHTML = ctx.msg('货号必须是纯数字，不能包含字母或空格', false); return
    }
    if (!spec) {
      msgEl.innerHTML = ctx.msg('包装规格为必填', false); return
    }
    if (!isValidSpec(spec)) {
      msgEl.innerHTML = ctx.msg('包装规格格式错误，必须是 1*1*X（X 为正整数，如 1*1*24）', false); return
    }
    if (!length || !width || !height || !weight) {
      msgEl.innerHTML = ctx.msg(SIZE_EMPTY_MSG, false); return
    }
    const nums = [length, width, height, weight].map(v => Number(v))
    if (nums.some(v => isNaN(v) || v <= 0)) {
      msgEl.innerHTML = ctx.msg('长、宽、高、重量必须为正数', false); return
    }

    const { data: exist } = await ctx.supabase.from('product_master')
      .select('id').eq('warehouse_code', wh).eq('product_code', code).eq('default_vendor_code', vendor).maybeSingle()

    if (exist) {
      msgEl.innerHTML = ctx.msg(`同仓库「${wh}」同厂编「${vendor}」下货号「${code}」已存在`, false)
      return
    }

    const { error } = await ctx.supabase.from('product_master').insert({
      warehouse_code: wh, product_code: code, product_name: name, spec,
      length: Number(length), width: Number(width), height: Number(height), weight: Number(weight),
      default_vendor_code: vendor, default_owner_code: vendor
    })

    if (error) {
      msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false); return
    }
    await logOp('create_product', '商品 ' + code, { warehouse_code: wh, vendor })
    msgEl.innerHTML = ctx.msg('新增成功', true)
    
    document.getElementById('pm-code').value = ''
    document.getElementById('pm-name').value = ''
    document.getElementById('pm-spec').value = ''
    document.getElementById('pm-length').value = ''
    document.getElementById('pm-width').value = ''
    document.getElementById('pm-height').value = ''
    document.getElementById('pm-weight').value = ''
    
    loadProducts(0)
  }

  document.getElementById('btn-p-import').onclick = async () => {
    const file = document.getElementById('p-file').files[0]
    if (!file) return document.getElementById('p-msg').innerHTML = ctx.msg('请选择文件', false)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    
    let hasInvalidCode = false
    let invalidCodeMsg = ''

    const products = rows.map((r, i) => {
      const codeStr = String(r['货号'] || r['商品代码'] || r['product_code'] || '').trim()
      if (codeStr && !/^\d+$/.test(codeStr)) {
        hasInvalidCode = true
        invalidCodeMsg = `第 ${i+2} 行的货号 [${codeStr}] 不是纯数字`
      }
      return {
        product_code: codeStr,
        product_name: r['商品名称'] || r['product_name'],
        spec: r['包装规格'] || r['spec'],
        length: r['长'] || r['length'],
        width: r['宽'] || r['width'],
        height: r['高'] || r['height'],
        weight: r['重量'] || r['weight'],
        default_vendor_code: r['默认厂编'] || r['default_vendor_code'],
        default_owner_code: r['默认货主'] || r['default_owner_code'],
        default_location_code: r['默认仓位'] || r['default_location_code'],
        default_logistics_mode: r['默认物流'] || r['default_logistics_mode'],
        store_code: r['门店代码'] || r['store_code'],
        store_name: r['门店名称'] || r['store_name']
      }
    }).filter(p => p.product_code)

    if (hasInvalidCode) {
      document.getElementById('p-msg').innerHTML = ctx.msg('导入失败：' + invalidCodeMsg, false)
      return
    }

    const { data: { session } } = await ctx.supabase.auth.getSession()
    const res = await safeFetch(`/functions/v1/import-products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ warehouse_code: document.getElementById('p-wh').value, products })
    })
    const json = await res.json()
    if (res.ok) {
      let h = ctx.msg(`导入 ${json.count} 条`, true)
      if (json.fail_count > 0 && json.errors?.length) {
        h += `<div class="scroll" style="max-height:200px;font-size:12px;color:#cf1322;margin-top:8px;">
          <div style="margin-bottom:4px;">失败 ${json.fail_count} 条：</div>
          ${json.errors.map(e => `<div>${e}</div>`).join('')}
        </div>`
      }
      document.getElementById('p-msg').innerHTML = h
      loadProducts(0)
    } else {
      document.getElementById('p-msg').innerHTML = ctx.msg(ctx.translateError(json.error || '导入失败'), false)
    }
  }

  loadProducts(0)
}

// ===== 6.4 提报时间段 =====
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
        <td>${r.day_type === 'weekday' ? '工作日' : r.day_type === 'weekend' ? '周末' : '全部'}</td><td>${r.config_value}</td>
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-value="${r.config_value}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-d-add').onclick = async () => {
    const configValue = document.getElementById('d-value').value.trim()
    if (!configValue) return
    const { error } = await ctx.supabase.from('deadline_config').insert({
      vendor_code: document.getElementById('d-vendor').value.trim() || null,
      warehouse_code: document.getElementById('d-wh').value.trim() || null,
      day_type: document.getElementById('d-type').value,
      config_value: configValue,
      updated_by: ctx.operatorName
    })
    if (error) {
      document.getElementById('d-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    await logOp('create_deadline', '提报时间段 ' + configValue)
    document.getElementById('d-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('deadline')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('deadline_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      await logOp('delete_deadline', '提报时间段 ' + b.dataset.value)
      renderBaseSub('deadline')
    }
  })
}

// ===== 6.5 节假日 =====
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
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-date="${r.holiday_date}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-h-add').onclick = async () => {
    const date = document.getElementById('h-date').value
    if (!date) return
    const { error } = await ctx.supabase.from('holiday_config').insert({
      holiday_date: date,
      description: document.getElementById('h-desc').value.trim() || null
    })
    if (error) {
      document.getElementById('h-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    await logOp('create_holiday', '节假日 ' + date)
    document.getElementById('h-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('holiday')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('holiday_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      await logOp('delete_holiday', '节假日 ' + b.dataset.date)
      renderBaseSub('holiday')
    }
  })
}

// ===== 6.6 强制放行 =====
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
        <td>${isSuper() ? `<button class="small danger" data-del="${r.id}" data-vendor="${r.vendor_code}" data-date="${r.bypass_date}">删除</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`
  document.getElementById('btn-b-add').onclick = async () => {
    const vendor = document.getElementById('b-vendor').value.trim()
    const date = document.getElementById('b-date').value
    if (!vendor || !date) return
    const { error } = await ctx.supabase.from('bypass_list').insert({
      vendor_code: vendor,
      warehouse_code: document.getElementById('b-wh').value.trim() || null,
      bypass_date: date,
      reason: document.getElementById('b-reason').value.trim() || null,
      created_by: ctx.operatorName
    })
    if (error) {
      document.getElementById('b-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    await logOp('create_bypass', '强制放行 ' + vendor, { bypass_date: date })
    document.getElementById('b-msg').innerHTML = ctx.msg('已新增', true)
    renderBaseSub('bypass')
  }
  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('bypass_list').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      await logOp('delete_bypass', '强制放行 ' + b.dataset.vendor, { bypass_date: b.dataset.date })
      renderBaseSub('bypass')
    }
  })
}

// ================= 7. 日志 =================
async function renderLogs(v) {
  const { data: ops } = await ctx.supabase.from('operation_log').select('*').order('id', { ascending: false }).limit(200)
  const { data: edits } = await ctx.supabase.from('vendor_edit_log').select('*').order('id', { ascending: false }).limit(200)

  v.innerHTML = `
    <div class="tabs" id="log-tabs">
      <button data-t="op" class="active">操作日志</button>
      <button data-t="edit">厂商修改记录</button>
      <button data-t="batch">导出批次</button>
    </div>
    <div id="log-view"></div>`

  const renderOp = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll">
        <table>
          <tr><th>操作时间</th><th>操作用户</th><th>操作动作</th><th>目标对象</th><th>详细内容</th></tr>
          <tbody>${(ops||[]).map(r=>`<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.operator_name||''}</td>
            <td>${ACTION_CN[r.action] || r.action || ''}</td>
            <td>${r.target||''}</td>
            <td><button class="small secondary" data-detail="${r.id}">查看详情</button></td>
          </tr>`).join('') || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody>
        </table>
      </div>
      <div id="log-detail-panel"></div>`

    document.querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.detail)
        const r = (ops||[]).find(x => x.id === id)
        if (!r) return
        const d = r.detail || {}
        let html = `<div class="card" style="margin-top:12px;border:2px solid #1677ff;">
          <h2>日志详情 · ${ACTION_CN[r.action] || r.action}</h2>
          <p style="font-size:13px;color:#666;margin-bottom:8px;">
            操作用户：${r.operator_name||''} ｜ 目标对象：${r.target||''} ｜ 操作时间：${new Date(r.created_at).toLocaleString()}
          </p>`

        if (Array.isArray(d.success_list) || Array.isArray(d.failed_list)) {
          html += `<div style="margin-bottom:8px;"><strong>成功 ${d.success || 0} 条：</strong>
            ${(d.success_list||[]).join(', ') || '无'}</div>`
          html += `<div><strong>失败 ${d.failed || 0} 条：</strong>`
          if ((d.failed_list||[]).length) {
            html += `<table style="margin-top:6px;"><tr><th>厂编</th><th>失败原因</th></tr>
              ${d.failed_list.map(f => `<tr><td>${f.vendor_code||''}</td><td style="color:#cf1322;">${f.error||''}</td></tr>`).join('')}
            </table>`
          } else {
            html += ' 无'
          }
          html += '</div>'
        } else {
          html += `<pre style="font-size:12px;background:#fafafa;padding:8px;border-radius:4px;overflow:auto;">${JSON.stringify(d, null, 2)}</pre>`
        }

        html += `<button class="secondary" id="btn-close-detail" style="margin-top:8px;">关闭</button></div>`
        document.getElementById('log-detail-panel').innerHTML = html
        document.getElementById('btn-close-detail').onclick = () => {
          document.getElementById('log-detail-panel').innerHTML = ''
        }
      }
    })
  }

  const renderEdit = () => {
    document.getElementById('log-view').innerHTML = `
      <div class="scroll">
        <table>
          <tr><th>修改时间</th><th>单据ID</th><th>厂编</th><th>修改字段</th><th>操作</th></tr>
          <tbody>${(edits||[]).map(r=>`<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${r.bill_id}</td>
            <td>${r.vendor_code||''}</td>
            <td style="font-size:11px;">${(r.changed_fields||[]).join(', ')}</td>
            <td><button class="small secondary" data-detail="${r.id}">查看详情</button></td>
          </tr>`).join('') || '<tr><td colspan="5">暂无数据</td></tr>'}</tbody>
        </table>
      </div>`

    document.querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.dataset.detail)
        const r = (edits||[]).find(x => x.id === id)
        if (!r) return
        const before = r.before_data || {}
        const after = r.after_data || {}
        const fields = r.changed_fields || []
        let html = `<div class="card" style="margin-top:12px;"><h2>修改详情（单据 #${r.bill_id}）</h2><table>
          <tr><th>字段名</th><th>修改前</th><th>修改后</th></tr>`
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

  const renderBatch = () => {
    let currentPage = 0
    const pageSize = 20
    let keyword = ''

    document.getElementById('log-view').innerHTML = `
      <div class="row" style="margin-bottom:12px;">
        <input id="batch-search" placeholder="搜索批次号/仓库代码" style="flex:2; margin:0;" value="${keyword}" />
        <button id="btn-batch-search" class="secondary" style="flex:0 0 80px;">查询</button>
      </div>
      <div class="scroll">
        <table>
          <tr><th>批次号</th><th>仓库</th><th>开始日期</th><th>结束日期</th><th>类型</th><th>条数</th><th>操作人</th><th>时间</th></tr>
          <tbody id="batch-body"></tbody>
        </table>
      </div>
      <div id="batch-pagination" style="display:flex; justify-content:flex-end; align-items:center; margin-top:12px; gap:12px;"></div>`

    const loadBatches = async (page = 0) => {
      currentPage = page
      const tbody = document.getElementById('batch-body')
      if (!tbody) return
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;">加载中...</td></tr>'

      let q = ctx.supabase.from('export_batch_detail').select('*', { count: 'exact' })
      if (keyword) {
        q = q.or(`batch_no.ilike.%${keyword}%,warehouse_code.ilike.%${keyword}%`)
      }

      const from = currentPage * pageSize
      const to = from + pageSize - 1
      q = q.order('id', { ascending: false }).range(from, to)

      const { data, error, count } = await q

      if (error) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#cf1322;">加载失败：${error.message}</td></tr>`
        return
      }

      tbody.innerHTML = (data||[]).map(r=>`<tr>
        <td>${r.batch_no}</td><td>${r.warehouse_code||''}</td>
        <td>${r.start_date||''}</td><td>${r.end_date||''}</td>
        <td>${r.bill_type||''}</td>
        <td>${r.bill_count_snapshot ?? r.count ?? 0}（实际 ${r.actual_count||0}）</td>
        <td>${r.operator||''}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无数据</td></tr>'

      const totalPages = Math.ceil((count || 0) / pageSize)
      const pageEl = document.getElementById('batch-pagination')
      if (pageEl) {
        pageEl.innerHTML = `
          <span style="font-size:13px;color:#666;">共 ${count || 0} 条记录，第 ${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages} 页</span>
          <button class="secondary small" id="btn-batch-prev" ${currentPage === 0 ? 'disabled' : ''} style="${currentPage === 0 ? 'opacity:0.5;' : ''}">上一页</button>
          <button class="secondary small" id="btn-batch-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''} style="${currentPage >= totalPages - 1 ? 'opacity:0.5;' : ''}">下一页</button>
        `
        document.getElementById('btn-batch-prev').onclick = () => { if (currentPage > 0) loadBatches(currentPage - 1) }
        document.getElementById('btn-batch-next').onclick = () => { if (currentPage < totalPages - 1) loadBatches(currentPage + 1) }
      }
    }

    document.getElementById('btn-batch-search').onclick = () => {
      keyword = document.getElementById('batch-search').value.trim()
      loadBatches(0)
    }
    document.getElementById('batch-search').onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('btn-batch-search').click()
    }

    loadBatches(0)
  }

  document.querySelectorAll('#log-tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#log-tabs button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      if (b.dataset.t === 'op') renderOp()
      else if (b.dataset.t === 'edit') renderEdit()
      else renderBatch()
    }
  })

  renderOp()
}

// ================= 8. 系统配置 =================
const CONFIG_CN = {
  app_version: '系统版本',
  app_name: '系统名称',
  release_notes: '更新说明',
  release_date: '发布日期',
  maintenance_mode: '维护模式',
  cleanup_days: '清理保留天数',
  cleanup_time: '清理执行时间',
  dingtalk_qc_webhook: '钉钉质检推送 Webhook',
  dingtalk_qc_secret: '钉钉质检推送 Secret',
  dingtalk_qc_push_time: '钉钉推送时间',
  cleanup_qc_days: '质检清理保留天数'
}

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
  
  let dingConfigs = []
  try {
    if (cfgMap.dingtalk_qc_multi_configs) {
      dingConfigs = JSON.parse(cfgMap.dingtalk_qc_multi_configs)
    }
  } catch(e) {}
  if (dingConfigs.length === 0 && cfgMap.dingtalk_qc_webhook) {
    dingConfigs.push({ name: '默认群', webhook: cfgMap.dingtalk_qc_webhook, secret: cfgMap.dingtalk_qc_secret || '' })
  }
  const dingTime = cfgMap.dingtalk_qc_push_time || '08:00'

  const hiddenKeys = ['maintenance_mode', 'dingtalk_qc_webhook', 'dingtalk_qc_secret', 'dingtalk_qc_multi_configs']
  const displayCfgs = (cfgs || []).filter(c => !hiddenKeys.includes(c.config_key))

  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px; ${isMaintenance ? 'border:2px solid #ff4d4f;' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0; color:${isMaintenance ? '#cf1322' : '#333'};">
            维护模式：${isMaintenance ? '⚠️ 已开启（全站拦截）' : '正常运行中'}
          </h2>
          <p style="font-size:12px;color:#666;margin-top:8px;">
            开启后，所有正在进行操作的账号将被强制踢出，并无法提交任何单据。
          </p>
        </div>
        <button id="btn-toggle-maintenance" style="${isMaintenance ? 'background:#389e0d;' : 'background:#ff4d4f;'}">
          ${isMaintenance ? '关闭维护模式' : '开启维护模式'}
        </button>
      </div>
      <div id="maintenance-msg" style="margin-top:12px;"></div>
    </div>

    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>系统配置（手动修改）</h2>
      <div class="row">
        <input id="c-key" placeholder="配置键 *" style="flex:1;" />
        <input id="c-val" placeholder="配置值" style="flex:2;" />
        <button id="btn-c-save" style="flex:0 0 100px;">保存</button>
      </div>
      <div id="c-msg"></div>
      
      <div class="scroll" style="max-height: 400px; overflow: auto;">
        <table>
          <tr><th>配置项</th><th>值</th><th>更新时间</th><th>操作</th></tr>
          <tbody>${displayCfgs.map(r=>`<tr>
            <td style="white-space:nowrap;">${CONFIG_CN[r.config_key] || r.config_key}</td>
            <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.config_value || ''}">
              ${formatConfigValue(r.config_key, r.config_value)}
            </td>
            <td style="white-space:nowrap;">${new Date(r.updated_at).toLocaleString()}</td>
            <td style="white-space:nowrap;">
              <button class="small secondary" data-copy="${r.config_value || ''}" style="margin-right:4px;">复制</button>
              ${isSuper() ? `<button class="small danger" data-del="${r.id}" data-key="${r.config_key}">删除</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="box-shadow:none;padding:0 0 16px;border:2px dashed #91caff;">
      <h2>钉钉质检推送配置（仅超管）</h2>
      <p style="font-size:12px;color:#666;margin:8px 0;">
        配置每日质检报告的推送时间与多个钉钉群。不填写加签 Secret 则不启用加签。
      </p>
      
      <div class="row" style="margin-bottom:12px;">
        <div>
          <label>每日推送时间 *</label>
          <input id="ding-time" type="time" value="${dingTime}" />
        </div>
      </div>

      <table style="width:100%; margin-bottom:12px;">
        <thead>
          <tr>
            <th style="width:20%;">群名称 (必填)</th>
            <th style="width:45%;">Webhook 地址 (必填)</th>
            <th style="width:25%;">加签 Secret (选填)</th>
            <th style="width:10%; text-align:center;">操作</th>
          </tr>
        </thead>
        <tbody id="ding-config-body">
          ${dingConfigs.map(c => `
            <tr>
              <td><input type="text" class="ding-name" value="${c.name||''}" placeholder="如：质检一区群" style="width:100%; padding:6px;" /></td>
              <td><input type="text" class="ding-webhook" value="${c.webhook||''}" placeholder="https://oapi.dingtalk.com/..." style="width:100%; padding:6px;" /></td>
              <td><input type="text" class="ding-secret" value="${c.secret||''}" placeholder="SECxxx" style="width:100%; padding:6px;" /></td>
              <td style="text-align:center;"><button class="small danger btn-del-ding" style="padding:6px 12px;">删除</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <button id="btn-add-ding" class="secondary" style="margin-bottom:16px; border-style:dashed;">+ 添加一个钉钉群</button>
      <div id="ding-msg"></div>
      <button id="btn-save-ding" ${isSuper() ? '' : 'disabled'}>保存钉钉配置</button>
    </div>

    <div class="card" style="box-shadow:none;padding:0 0 16px;border:2px dashed #91caff;">
      <h2>定时清理配置（仅超管）</h2>
      <p style="font-size:12px;color:#666;margin:8px 0;">
        清理 <strong>${cleanupDays}</strong> 天前已导出单据及相关记录；每天 <strong>${cleanupTime}</strong> 执行。
      </p>
      <div class="row">
        <div>
          <label>保留天数（1–365）</label>
          <input id="cleanup-days" type="number" min="1" max="365" value="${cleanupDays}" />
        </div>
        <div>
          <label>每天执行时间</label>
          <input id="cleanup-time" type="time" value="${cleanupTime}" />
        </div>
      </div>
      <button id="btn-save-cleanup" ${isSuper() ? '' : 'disabled'}>保存（立即生效）</button>
      <div id="cleanup-msg"></div>
    </div>
    
    <div class="card" style="box-shadow:none;padding:0;">
      <details>
        <summary style="cursor:pointer;font-size:16px;font-weight:600;padding:8px 0;">版本历史（点击展开）</summary>
        <div style="margin-top:12px;">
          <div class="row">
            <input id="v-version" placeholder="版本号 *" style="flex:1;" />
            <input id="v-notes" placeholder="更新说明" style="flex:2;" />
            <button id="btn-v-add" style="flex:0 0 100px;">新增</button>
          </div>
          <div id="v-msg"></div>
          <table><tr><th>版本</th><th>说明</th><th>发布时间</th></tr>
            <tbody>${(vers||[]).map(r=>`<tr>
              <td>${r.version}</td><td>${r.notes||''}</td>
              <td>${new Date(r.released_at).toLocaleString()}</td>
            </tr>`).join('')}</tbody></table>
        </div>
      </details>
    </div>`

  document.getElementById('btn-toggle-maintenance').onclick = async () => {
    const newStatus = isMaintenance ? 'false' : 'true'
    const action = isMaintenance ? '关闭' : '开启'
    if (!confirm(`确定要${action}维护模式吗？\n\n开启会强制踢出所有在线用户！`)) return

    const msgEl = document.getElementById('maintenance-msg')
    msgEl.innerHTML = ctx.msg('切换中...', true)

    const { error } = await ctx.supabase.from('system_config')
      .upsert({ config_key: 'maintenance_mode', config_value: newStatus, updated_by: ctx.operatorName }, { onConflict: 'config_key' })
    
    if (error) {
      msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    
    await logOp('save_system_config', `维护模式-${action}`, { value: newStatus })
    renderTab('sys')
  }

  const dingBody = document.getElementById('ding-config-body')
  
  document.getElementById('btn-add-ding').onclick = () => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><input type="text" class="ding-name" placeholder="如：质检二区群" style="width:100%; padding:6px;" /></td>
      <td><input type="text" class="ding-webhook" placeholder="https://oapi.dingtalk.com/..." style="width:100%; padding:6px;" /></td>
      <td><input type="text" class="ding-secret" placeholder="SECxxx" style="width:100%; padding:6px;" /></td>
      <td style="text-align:center;"><button class="small danger btn-del-ding" style="padding:6px 12px;">删除</button></td>
    `
    dingBody.appendChild(tr)
    bindDelDing()
  }

  const bindDelDing = () => {
    dingBody.querySelectorAll('.btn-del-ding').forEach(btn => {
      btn.onclick = () => btn.closest('tr').remove()
    })
  }
  bindDelDing()

  document.getElementById('btn-save-ding').onclick = async () => {
    if (!isSuper()) return alert('只有超级管理员可以修改')
    const time = document.getElementById('ding-time').value
    const msgEl = document.getElementById('ding-msg')
    
    if (!time) return msgEl.innerHTML = ctx.msg('请选择推送时间', false)

    const rows = dingBody.querySelectorAll('tr')
    const configs = []
    let hasError = false

    rows.forEach(tr => {
      const name = tr.querySelector('.ding-name').value.trim()
      const webhook = tr.querySelector('.ding-webhook').value.trim()
      const secret = tr.querySelector('.ding-secret').value.trim()

      if (name || webhook || secret) {
        if (!name || !webhook) hasError = true
        if (!webhook.startsWith('https://oapi.dingtalk.com')) hasError = true
        configs.push({ name, webhook, secret })
      }
    })

    if (hasError) return msgEl.innerHTML = ctx.msg('群名称与 Webhook 为必填，且 Webhook 必须以 https://oapi.dingtalk.com 开头', false)

    msgEl.innerHTML = ctx.msg('保存中...', true)

    const upserts = [
      { config_key: 'dingtalk_qc_multi_configs', config_value: JSON.stringify(configs), updated_by: ctx.operatorName },
      { config_key: 'dingtalk_qc_push_time', config_value: time, updated_by: ctx.operatorName }
    ]

    const { error } = await ctx.supabase.from('system_config').upsert(upserts, { onConflict: 'config_key' })
    if (error) return msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)

    const { error: rpcErr } = await ctx.supabase.rpc('reschedule_dingtalk_qc_push', { p_time: time })
    if (rpcErr) {
      console.warn('刷新定时器失败', rpcErr)
      msgEl.innerHTML = ctx.msg('配置已保存，但定时器刷新失败，请手动检查数据库 cron 任务', false)
    } else {
      msgEl.innerHTML = ctx.msg('保存成功，定时任务已更新生效', true)
    }

    await logOp('save_system_config', '钉钉多群推送配置', { count: configs.length, time })
    setTimeout(() => renderTab('sys'), 1000)
  }

  document.getElementById('btn-save-cleanup').onclick = async () => {
    if (!isSuper()) return alert('只有超级管理员可以修改')
    const d = Number(document.getElementById('cleanup-days').value)
    const t = document.getElementById('cleanup-time').value
    if (!d || d < 1 || d > 365) {
      return document.getElementById('cleanup-msg').innerHTML = ctx.msg('天数需在 1–365', false)
    }
    if (!t) {
      return document.getElementById('cleanup-msg').innerHTML = ctx.msg('请选择时间', false)
    }

    const msgEl = document.getElementById('cleanup-msg')
    msgEl.innerHTML = ctx.msg('保存中...', true)

    const { error } = await ctx.supabase.rpc('save_cleanup_config', { p_days: d, p_time: t })
    if (error) {
      msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }

    const { error: rpcErr } = await ctx.supabase.rpc('reschedule_cleanup_job', { p_time: t })
    if (rpcErr) {
      console.warn('刷新清理定时器失败', rpcErr)
      msgEl.innerHTML = ctx.msg('天数已保存，但定时器刷新失败，请检查日志', false)
    } else {
      msgEl.innerHTML = ctx.msg('保存成功，清理任务执行时间已更新', true)
    }

    await logOp('save_cleanup_config', '清理配置', { days: d, time: t })
    setTimeout(() => renderTab('sys'), 1000)
  }

  document.getElementById('btn-c-save').onclick = async () => {
    const key = document.getElementById('c-key').value.trim()
    const val = document.getElementById('c-val').value
    if (!key) return
    const { error } = await ctx.supabase.from('system_config')
      .upsert({ config_key: key, config_value: val, updated_by: ctx.operatorName }, { onConflict: 'config_key' })
    if (error) {
      document.getElementById('c-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    await logOp('save_system_config', '配置 ' + (CONFIG_CN[key] || key), { value: val })
    document.getElementById('c-msg').innerHTML = ctx.msg('已保存', true)
    renderTab('sys')
  }

  document.getElementById('btn-v-add').onclick = async () => {
    const version = document.getElementById('v-version').value.trim()
    if (!version) return
    const { error } = await ctx.supabase.from('version_history').insert({
      version,
      notes: document.getElementById('v-notes').value.trim() || null,
      released_by: ctx.operatorName
    })
    if (error) {
      document.getElementById('v-msg').innerHTML = ctx.msg(ctx.translateError(error.message), false)
      return
    }
    await logOp('add_version', '版本 ' + version)
    document.getElementById('v-msg').innerHTML = ctx.msg('已新增', true)
    renderTab('sys')
  }

  v.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => {
      const val = b.dataset.copy
      if (!val) return alert('值为空')
      navigator.clipboard.writeText(val).then(() => {
        alert('已复制到剪贴板')
      }).catch(err => {
        alert('复制失败，请手动选择复制')
      })
    }
  })

  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定删除？')) return
      const { error } = await ctx.supabase.from('system_config').delete().eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      await logOp('delete_system_config', '配置 ' + (CONFIG_CN[b.dataset.key] || b.dataset.key))
      renderTab('sys')
    }
  })
}

// ================= 9. 公告管理 =================
async function renderAnnouncements(v) {
  if (!isSuper()) return v.innerHTML = ctx.msg('仅超级管理员可查看公告管理', false)

  const { data: anns } = await ctx.supabase.from('announcement').select('*').order('id', { ascending: false })
  const { count: totalUsers } = await ctx.supabase.from('vendor_profile').select('*', { count: 'exact', head: true }).in('account_type', ['vendor', 'logistics']).eq('status', 1)
  const { data: allReads } = await ctx.supabase.from('announcement_read').select('announcement_id, vendor_code')

  const readMap = {}
  ;(allReads || []).forEach(r => {
    (readMap[r.announcement_id] ||= []).push(r.vendor_code)
  })

  v.innerHTML = `
    <div class="card" style="box-shadow:none;padding:0 0 16px;">
      <h2>发布新公告</h2>
      <div id="ann-msg"></div>
      <input id="ann-title" placeholder="公告标题 *" style="width:100%;margin-bottom:12px;" />
      <textarea id="ann-content" placeholder="公告内容 *" rows="4" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;font-family:inherit;margin-bottom:12px;resize:vertical;"></textarea>
      <button id="btn-publish-ann" style="background:#1677ff;color:#fff;">发布公告</button>
    </div>
    <div class="card" style="box-shadow:none;padding:0;">
      <h2>历史公告列表</h2>
      <div class="scroll">
        <table>
          <tr><th>发布时间</th><th>标题</th><th>状态</th><th>已读统计</th><th>操作</th></tr>
          <tbody>${(anns||[]).map(a => {
            const readCount = (readMap[a.id] || []).length
            const isActive = a.status === 'active'
            return `<tr>
              <td>${new Date(a.created_at).toLocaleString()}</td>
              <td>${a.title}</td>
              <td>${isActive ? '<span class="stat ok">生效中</span>' : '<span class="stat no" style="background:#f5f5f5;color:#999;">已下线</span>'}</td>
              <td>${readCount} / ${totalUsers || 0} 人</td>
              <td>
                <button class="small secondary" data-view="${a.id}" data-title="${a.title}">已读名单</button>
                ${isActive ? `<button class="small danger" data-del="${a.id}">下线</button>` : ''}
              </td>
            </tr>`
          }).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无公告</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div id="ann-modal"></div>`

  document.getElementById('btn-publish-ann').onclick = async () => {
    const title = document.getElementById('ann-title').value.trim()
    const content = document.getElementById('ann-content').value.trim()
    const msgEl = document.getElementById('ann-msg')
    
    if (!title || !content) return msgEl.innerHTML = ctx.msg('标题和内容为必填', false)
    
    msgEl.innerHTML = ctx.msg('发布中...', true)
    const { error } = await ctx.supabase.from('announcement').insert({
      title, content, created_by: ctx.operatorName
    })
    
    if (error) return msgEl.innerHTML = ctx.msg(ctx.translateError(error.message), false)
    
    await logOp('publish_announcement', '发布公告 ' + title)
    msgEl.innerHTML = ctx.msg('发布成功', true)
    setTimeout(() => renderTab('ann'), 800)
  }

  v.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('确定要将此公告下线吗？下线后用户登录不再弹出。')) return
      const { error } = await ctx.supabase.from('announcement').update({ status: 'archived' }).eq('id', b.dataset.del)
      if (error) return alert(ctx.translateError(error.message))
      await logOp('archive_announcement', '下线公告 ID ' + b.dataset.del)
      renderTab('ann')
    }
  })

  v.querySelectorAll('[data-view]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.view
      const title = b.dataset.title
      const modal = document.getElementById('ann-modal')
      
      const { data: vps } = await ctx.supabase.from('vendor_profile')
        .select('vendor_code, vendor_name, account_type')
        .in('account_type', ['vendor', 'logistics'])
        .eq('status', 1)
        .order('account_type')
        .order('vendor_code')
        
      const readCodes = new Set(readMap[id] || [])
      const unread = (vps || []).filter(v => !readCodes.has(v.vendor_code))
      const read = (vps || []).filter(v => readCodes.has(v.vendor_code))

      modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;">
          <div style="background:#fff;border-radius:8px;padding:24px;max-width:700px;width:90%;max-height:80vh;display:flex;flex-direction:column;">
            <h2 style="margin-bottom:16px;">公告已读名单 · ${title}</h2>
            <div style="flex:1;overflow:auto;display:flex;gap:16px;">
              <div style="flex:1;">
                <h3 style="color:#389e0d;margin-bottom:8px;">已读 (${read.length})</h3>
                <div style="font-size:13px;background:#f6ffed;border:1px solid #b7eb8f;padding:8px;border-radius:4px;height:350px;overflow-y:auto;">
                  ${read.map(v => `<div style="padding:4px 0;border-bottom:1px dashed #d9f7be;">[${v.account_type === 'vendor' ? '厂商' : '物流'}] ${v.vendor_code} - ${v.vendor_name||''}</div>`).join('') || '无'}
                </div>
              </div>
              <div style="flex:1;">
                <h3 style="color:#cf1322;margin-bottom:8px;">未读 (${unread.length})</h3>
                <div style="font-size:13px;background:#fff2f0;border:1px solid #ffccc7;padding:8px;border-radius:4px;height:350px;overflow-y:auto;">
                  ${unread.map(v => `<div style="padding:4px 0;border-bottom:1px dashed #ffa39e;">[${v.account_type === 'vendor' ? '厂商' : '物流'}] ${v.vendor_code} - ${v.vendor_name||''}</div>`).join('') || '无'}
                </div>
              </div>
            </div>
            <div style="margin-top:16px;text-align:right;">
              <button class="secondary" onclick="document.getElementById('ann-modal').innerHTML=''">关闭</button>
            </div>
          </div>
        </div>`
    }
  })
}