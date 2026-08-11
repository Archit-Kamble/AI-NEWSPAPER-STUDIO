export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

// A panel appended to document.body (worklist, preflight, bulk-generate) is a
// dialog in everything but name, and a desk expects Escape to close one same
// as its own × button. The listener is document-level and outlives the panel
// unless removed, so the returned close() takes both down together - callers
// bind it to their own close button instead of calling onClose directly.
export function closeOnEscape(onClose) {
  const handler = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", handler);
    onClose();
  };
  document.addEventListener("keydown", handler);
  return close;
}
