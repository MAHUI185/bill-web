// supabase.js — Supabase 客户端配置（自动识别设备直连/代理）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 自动识别设备：手机/平板走代理，电脑走直连
function getSupabaseUrl() {
  const ua = navigator.userAgent || ''
  // 检测是否为移动端
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) {
    return 'https://api.mahui.pw'
  }
  // 电脑端直连（速度最快）
  return 'https://gpjdzgakvqhnpykuqbfr.supabase.co'
}

export const supabase = createClient(
  getSupabaseUrl(),
  'sb_publishable_vUAhYoF1D51WyWlPnLzSlA_JDBODtaW'
)