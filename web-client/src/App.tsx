import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type StatusState = 'idle' | 'creating' | 'waiting' | 'connected' | 'error'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

interface SessionStatus {
  connected: boolean
  user?: {
    id?: string
    name?: string
  }
}

interface ApiError {
  error?: string
  message?: string
}

const MAX_LOGS = 200

function App() {
  const [sessionIdInput, setSessionIdInput] = useState('')
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusState>('idle')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [phone, setPhone] = useState('962791234567')
  const [message, setMessage] = useState('Hello from the new web dashboard!')
  const [isSending, setIsSending] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [sessionInfo, setSessionInfo] = useState<SessionStatus | null>(null)

  const apiBase = useMemo(() => API_BASE.replace(/\/$/, ''), [])

  const appendLog = useCallback((text: string) => {
    setLogs((prev) => {
      const next = [...prev, `[${new Date().toLocaleTimeString()}] ${text}`]
      if (next.length > MAX_LOGS) {
        next.shift()
      }
      return next
    })
  }, [])

  const handleCreateSession = async (event: FormEvent) => {
    event.preventDefault()
    if (!sessionIdInput.trim()) {
      appendLog('⚠️ يرجى إدخال معرف جلسة صالح')
      return
    }

    setStatus('creating')
    appendLog(`⏳ إنشاء جلسة جديدة: ${sessionIdInput}`)

    try {
      const response = await fetch(`${apiBase}/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdInput.trim() })
      })

      if (!response.ok) {
        const data = (await response.json()) as ApiError
        throw new Error(data.error || data.message || 'فشل إنشاء الجلسة')
      }

      setActiveSession(sessionIdInput.trim())
      setStatus('waiting')
      appendLog('✅ تم إنشاء الجلسة، يرجى مسح رمز QR')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خطأ غير متوقع'
      setStatus('error')
      appendLog(`❌ ${message}`)
    }
  }

  useEffect(() => {
    if (!activeSession || status === 'connected') {
      return
    }

    let isMounted = true
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${apiBase}/qr/${activeSession}`)
        if (!response.ok) {
          return
        }
        const data = await response.json()
        if (isMounted && data.qrImage) {
          setQrImage((prev) => {
            if (!prev) {
              appendLog('📱 رمز QR جاهز للمسح')
            }
            return data.qrImage
          })
        }
      } catch (error) {
        console.error('QR fetch error', error)
      }
    }, 2000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [activeSession, apiBase, status, appendLog])

  useEffect(() => {
    if (!activeSession) {
      return
    }

    let isMounted = true
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${apiBase}/status/${activeSession}`)
        if (!response.ok) {
          if (status !== 'idle') {
            setStatus('error')
          }
          return
        }
        const data = (await response.json()) as SessionStatus
        if (!isMounted) {
          return
        }
        setSessionInfo(data)
        if (data.connected) {
          setStatus('connected')
          setQrImage(null)
        } else if (status !== 'creating') {
          setStatus('waiting')
        }
      } catch (error) {
        console.error('Status fetch error', error)
      }
    }, 3000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [activeSession, apiBase, status])

  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeSession || !phone.trim() || !message.trim()) {
      appendLog('⚠️ يرجى إدخال رقم الهاتف والرسالة')
      return
    }

    setIsSending(true)
    appendLog(`✉️ إرسال رسالة إلى ${phone}`)
    try {
      const response = await fetch(`${apiBase}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession,
          number: phone.trim(),
          message: message.trim()
        })
      })

      if (!response.ok) {
        const data = (await response.json()) as ApiError
        throw new Error(data.error || data.message || 'فشل إرسال الرسالة')
      }

      appendLog('✅ تم إرسال الرسالة بنجاح')
      setMessage('')
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'خطأ غير متوقع'
      appendLog(`❌ ${messageText}`)
    } finally {
      setIsSending(false)
    }
  }

  const handleResetSession = async () => {
    if (!activeSession) {
      return
    }

    setIsResetting(true)
    appendLog(`🧹 حذف جلسة ${activeSession} وإعادة التهيئة`)
    try {
      const response = await fetch(`${apiBase}/session/${activeSession}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const data = (await response.json()) as ApiError
        throw new Error(data.error || data.message || 'تعذر حذف الجلسة')
      }

      appendLog('✅ تم حذف الجلسة. يمكنك إنشاء واحدة جديدة الآن')
      setActiveSession(null)
      setSessionInfo(null)
      setStatus('idle')
      setQrImage(null)
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'خطأ غير متوقع'
      appendLog(`❌ ${messageText}`)
    } finally {
      setIsResetting(false)
    }
  }

  const statusLabel = (() => {
    switch (status) {
      case 'creating':
        return { text: 'جاري إنشاء الجلسة...', tone: 'info' }
      case 'waiting':
        return { text: 'بانتظار مسح رمز QR', tone: 'warning' }
      case 'connected':
        return { text: 'متصل ✅', tone: 'success' }
      case 'error':
        return { text: 'حدث خطأ ⚠️', tone: 'danger' }
      default:
        return { text: 'غير متصل', tone: 'muted' }
    }
  })()

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">WhatsApp Session Manager</p>
          <h1>لوحة إدارة واتساب</h1>
          <p className="subtitle">
            أنشئ الجلسات، امسح رمز QR، وأرسل الرسائل مباشرة من المتصفح بالاعتماد على واجهة Baileys الحالية.
          </p>
        </div>
        <div className={`status-chip status-${statusLabel.tone}`}>
          {statusLabel.text}
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <h2>١. إنشاء الجلسة</h2>
          <form className="form" onSubmit={handleCreateSession}>
            <label>
              معرف الجلسة
              <input
                type="text"
                placeholder="مثال: marketing-team"
                value={sessionIdInput}
                onChange={(event) => setSessionIdInput(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={status === 'creating'}>
              {status === 'creating' ? 'جاري الإنشاء...' : 'إنشاء الجلسة'}
            </button>
          </form>
          {activeSession && (
            <div className="session-actions">
              <p className="hint">الجلسة الحالية: {activeSession}</p>
              <button
                type="button"
                className="ghost-btn"
                onClick={handleResetSession}
                disabled={isResetting}
              >
                {isResetting ? 'جاري الحذف...' : 'إعادة تعيين الجلسة'}
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h2>٢. رمز QR</h2>
          <div className="qr-panel">
            {qrImage && status !== 'connected' ? (
              <img src={qrImage} alt="رمز QR" />
            ) : (
              <div className="qr-placeholder">
                {status === 'connected'
                  ? 'تم الاتصال بنجاح'
                  : 'سيظهر رمز QR هنا بعد إنشاء الجلسة'}
              </div>
            )}
          </div>
          <p className="hint">افتح واتساب &gt; الأجهزة المرتبطة لمسح الرمز.</p>
        </section>

        <section className="card">
          <h2>٣. إرسال رسالة</h2>
          <form className="form" onSubmit={handleSendMessage}>
            <label>
              رقم الهاتف مع مفتاح الدولة
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={status !== 'connected'}
                placeholder="96279xxxxxxx"
              />
            </label>
            <label>
              الرسالة
              <textarea
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={status !== 'connected'}
              />
            </label>
            <button type="submit" disabled={status !== 'connected' || isSending}>
              {isSending ? 'جاري الإرسال...' : 'إرسال الآن'}
            </button>
          </form>
          {sessionInfo?.user && (
            <p className="hint">متصل بالمستخدم: {sessionInfo.user.name || sessionInfo.user.id}</p>
          )}
        </section>

        <section className="card log-card">
          <h2>السجل المباشر</h2>
          <div className="log-list">
            {logs.length === 0 ? (
              <p className="hint">ستظهر رسائل الحالة هنا.</p>
            ) : (
              logs.map((entry, index) => <div key={index}>{entry}</div>)
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
