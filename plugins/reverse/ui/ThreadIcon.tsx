// SPDX-License-Identifier: AGPL-3.0-only
// The Thread key's picture, drawn on the app's icon grid to its rules (see
// src/ui/icons.tsx): the round bar in ink, the thread the feature cuts round
// it in blue, standing a little proud of the bar, its axis a centre line.

export function ThreadIcon({ size = 24 }: { size?: number }) {
  return (
    <svg className={size <= 16 ? 'icon small' : 'icon'} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="i-g" d="M7.5 3h9v18h-9Z" />
      <path className="i-a" d="m6 8.5 12-3M6 12.5l12-3M6 16.5l12-3M6 20.5l12-3" />
      <path className="i-a i-ax" d="M12 1v22" />
    </svg>
  )
}
