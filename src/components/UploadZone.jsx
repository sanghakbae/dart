import { useRef, useState } from 'react'
import { ACCEPTED } from '../lib/extract'

export default function UploadZone({ onFiles, onSample, busy, progress, phase, compact }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  const pick = (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        pick(e.dataTransfer.files)
      }}
      style={compact ? { padding: '18px 16px' } : undefined}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />

      {busy ? (
        <div className="stack" style={{ maxWidth: 460, marginInline: 'auto' }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
            <span className="spinner" />
            {phase || '분석 중'}
          </div>
          <div className="progress">
            <i style={{ width: `${Math.round((progress || 0) * 100)}%` }} />
          </div>
        </div>
      ) : (
        <>
          {/* '회사 추가' 카드 안에서는 DART 검색이 주 경로이고 파일 업로드는 보조다.
              큰 제목을 두면 카드 안에 카드가 또 있는 것처럼 보여 한 줄로 줄인다. */}
          {compact ? (
            // 문구와 버튼을 한 줄에 둔다. 세로로 쌓으면 보조 경로가 카드 안에서
            // 주 경로(DART 검색)만큼 자리를 차지한다.
            <div className="drop-row">
              <p className="drop-lead">
                <strong>DART 에 없는 보고서</strong>는 파일로 올리세요 — 끌어다 놓아도 됩니다.
              </p>
              <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()}>
                파일 올리기
              </button>
            </div>
          ) : (
            <>
              <h2>감사보고서를 올려주세요</h2>
              <p>
                파일을 이 영역에 끌어다 놓거나 버튼을 눌러 선택하세요. 감사의견 · 재무제표 · 주석 ·
                재무비율 · 전년 대비 추이를 자동으로 분석하고 전체 내용을 DB에 저장합니다.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()}>
                  파일 선택
                </button>
                {onSample && (
                  <button className="btn" type="button" onClick={onSample}>
                    예시 파일로 먼저 보기
                  </button>
                )}
              </div>
            </>
          )}
          {!compact && (
            <div className="drop-formats">
              <span className="chip">ZIP</span>
              <span className="chip">PDF</span>
              <span className="chip">HTML</span>
              <span className="chip">XLSX / XLS</span>
              <span className="chip">CSV</span>
              <span className="chip">TXT</span>
              <span className="chip">여러 개 동시 업로드</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
