// Runs `fn` once things have been quiet for the longest wait asked for: a short wait never cuts a longer
// one short, so a change elsewhere can't start RAG or a Notion push in the middle of dragging cards.
export function settle(fn) {
  let timer
  let due = 0
  return (wait) => {
    due = Math.max(due, Date.now() + (Number(wait) || 0))
    clearTimeout(timer)
    timer = setTimeout(() => { due = 0; fn() }, due - Date.now())
  }
}
