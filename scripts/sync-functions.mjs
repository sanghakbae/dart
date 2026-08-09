// 프록시 핸들러를 Firebase Functions 폴더로 복사한다.
//
// 같은 핸들러를 Cloudflare Worker 와 Functions 가 함께 쓴다. Functions 는 자기
// 폴더 밖을 배포하지 못하므로 배포 직전에 복사한다 — 두 벌로 나눠 두면
// 한쪽만 고쳐져 동작이 갈린다(실제로 겪었다).
//
// firebase.json 의 predeploy 에서 자동으로 돈다. 직접 돌리려면:
//   node scripts/sync-functions.mjs

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FROM = resolve(ROOT, 'server')
const TO = resolve(ROOT, 'functions/server')

// Functions 에서 쓰는 것만 옮긴다. worker.mjs·vite 플러그인은 여기 필요 없다.
const FILES = ['nps-handler.mjs', 'company-name.mjs', 'api-path.mjs']

mkdirSync(TO, { recursive: true })
for (const f of FILES) {
  copyFileSync(resolve(FROM, f), resolve(TO, f))
  console.log(`  server/${f} → functions/server/${f}`)
}
console.log(`핸들러 ${FILES.length}개 복사 완료`)
