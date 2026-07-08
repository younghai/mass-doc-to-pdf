/**
 * Guard a destructive job delete behind a native confirmation. Deleting a job
 * permanently removes its source, PDF, and quality report, so an accidental click
 * must not go through unchallenged. Returns true when the user chooses to proceed.
 *
 * A native `window.confirm` keeps this a small, dependency-free safety net; it can
 * be swapped for a styled modal later without changing the call sites.
 */
export function confirmDelete(name?: string): boolean {
  const subject = name ? `"${name}"` : "이 작업";
  return window.confirm(
    `${subject}을(를) 삭제하면 원본과 변환 결과가 영구 삭제됩니다. 계속할까요?`,
  );
}
