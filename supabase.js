import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function getSupabaseUrl() {
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) {
    return 'https://api.mahui.pw' // 手机走代理
  }
  return 'https://gpjdzakvqhnpykuqbfr.supabase.co' // 电脑直连
}

export const supabase = createClient(
  getSupabaseUrl(),
  'sb_publishable_vUAhYoF1D51WyWlPnLzSlA_JDBODtaW'
)