/** 클립보드 복사 (권한이 없으면 textarea 방식으로) */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
export function openExternal(url: string | null | undefined) {
  if (!url) return;
  window.open(url, url.startsWith('obsidian:') ? '_self' : '_blank', 'noopener');
}
