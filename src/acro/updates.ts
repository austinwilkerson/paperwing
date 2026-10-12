/**
 * Update check against the project's GitHub Releases. Works for every
 * install type (installer, portable, zip, dmg): it only tells the user a new
 * version exists and opens the release page.
 */

declare const __PAPERWING_VERSION__: string;
declare const __PAPERWING_REPO__: string;

type Toast = (
  msg: string,
  action?: { label: string; onClick: () => void }
) => void;

const LAST_CHECK_KEY = 'paperwing:lastUpdateCheck';
const DAY = 24 * 60 * 60 * 1000;

function newer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export async function checkForUpdates(
  toast: Toast,
  manual = false
): Promise<void> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${__PAPERWING_REPO__}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const release = (await res.json()) as {
      tag_name: string;
      html_url: string;
    };
    try {
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    if (newer(release.tag_name, __PAPERWING_VERSION__)) {
      toast(`Paperwing ${release.tag_name.replace(/^v/, '')} is available`, {
        label: 'Download',
        onClick: () => window.open(release.html_url, '_blank', 'noopener'),
      });
    } else if (manual) {
      toast(`You're up to date (version ${__PAPERWING_VERSION__})`);
    }
  } catch {
    if (manual) toast("Couldn't check for updates. Are you online?");
  }
}

/** Check quietly at most once a day, a few seconds after startup */
export function scheduleUpdateCheck(toast: Toast) {
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  } catch {
    /* storage unavailable */
  }
  if (Date.now() - last < DAY) return;
  setTimeout(() => void checkForUpdates(toast), 8000);
}
