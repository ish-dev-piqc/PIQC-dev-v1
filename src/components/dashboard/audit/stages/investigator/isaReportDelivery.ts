// =============================================================================
// isaReportDelivery — browser-side delivery helpers shared by Report drafting
// (the draft exports) and Review & export (the recorded export): a rich
// clipboard write with the selection fallback, and a blob download. Moved
// verbatim out of IsaReportWorkspace when the second caller arrived
// (isa-review-export). Not an Api module: nothing here touches Supabase.
// =============================================================================

/** Copy text/html + text/plain so Word and Google Docs paste formatted.
 *  Falls back to the selection-based copy, then to plain text. */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to the selection-based path
  }
  try {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    container.remove();
    if (ok) return true;
  } catch {
    // fall through to plain text
  }
  try {
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
