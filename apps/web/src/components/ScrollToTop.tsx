import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Resets scroll position when the route changes.
 *
 * Without this, navigating from a scrolled page keeps the previous offset. Going
 * from a scrolled Team list into a goal renders what looks like a completely
 * blank screen — the content is there, several hundred pixels above the
 * viewport. It reads as a broken page, and it happens most on exactly the
 * screens with the most content.
 *
 * React Router only restores scroll on its own in a data router, via
 * <ScrollRestoration />. This app uses BrowserRouter with <Routes>, so the
 * behaviour has to be supplied here.
 *
 * Two deliberate exceptions:
 *
 *   POP — back and forward. The browser has its own saved offset for those
 *   entries and returning someone to the top of a list they just backed out of
 *   would lose their place, which is worse than the bug being fixed.
 *
 *   A hash — the fragment target owns the scroll position; jumping to the top
 *   would defeat the link that was just followed.
 */
export function ScrollToTop(): null {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') return;
    if (hash) return;
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname, hash, navigationType]);

  return null;
}
