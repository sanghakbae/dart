import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// 개발 중에만 노출하는 일회성 정리 도구.
// 회사명 파서를 고치기 전에 올려 엉뚱하게 갈린 회사를 다시 묶는다. 콘솔에서 __dartRegroup().
if (import.meta.env.DEV) {
  import('./lib/migrate.js').then(({ regroupCompanies }) => {
    window.__dartRegroup = () => regroupCompanies((m) => console.log('[regroup]', m))
  })
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
