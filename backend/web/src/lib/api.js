// In dev, requests go to '' (same-origin) and Vite's proxy forwards /api/* to
// the FastAPI backend. Set VITE_API_BASE_URL for production deployments where
// the frontend and backend are on different origins.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

const NETWORK_ERROR_MESSAGE = '백엔드 서버에 연결할 수 없습니다 — 서버가 실행 중인지 확인하세요.'

// FastAPI's own request validation (422, before a route handler even runs)
// returns `detail` as an array of Pydantic error objects, not a string --
// every other error path in this app (HTTPException) already returns a
// plain string. Without this, an array `detail` renders as the useless
// "[object Object]" (Array.toString() on objects) instead of the actual
// per-field validation message.
function detailToMessage(detail, status) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((e) => (typeof e === 'string' ? e : (e.msg ?? JSON.stringify(e)))).join(', ')
  }
  return `요청이 실패했습니다 (HTTP ${status}).`
}

async function handleResponse(res) {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(detailToMessage(body?.detail, res.status))
  }
  return body
}

// fetch() throws a generic TypeError ("Failed to fetch") only for
// network-level failures -- server not running, refused connection, CORS,
// DNS, etc. HTTP error responses (4xx/5xx) resolve normally and are handled
// in handleResponse() with the backend's own detail message. Distinguishing
// the two here means the UI never shows a bare, unexplained "Failed to fetch".
export async function apiGet(path) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`)
  } catch {
    throw new Error(NETWORK_ERROR_MESSAGE)
  }
  return handleResponse(res)
}

export async function apiPost(path, payload) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error(NETWORK_ERROR_MESSAGE)
  }
  return handleResponse(res)
}
