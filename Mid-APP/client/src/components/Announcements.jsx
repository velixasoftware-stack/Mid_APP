import { useEffect, useState } from 'react';
import api from '../api/client';


/**
 * Captions Chief Admin publishes to every client (active, and today within
 * their From/To dates), shown after login as a scrolling ticker across the top
 * of the app. Not dismissible - every client user sees them. Hovering pauses
 * the scroll so a long caption can be read.
 */
export default function Announcements() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api.get('/announcements/active')
      .then(({ data }) => { if (!cancelled) setItems(Array.isArray(data) ? data : []); })
      .catch(() => {}); // a caption is never worth breaking the app over
    return () => { cancelled = true; };
  }, []);

  if (items.length === 0) return null;

  // Scroll speed scales with text length so long captions don't race past.
  const totalChars = items.reduce((n, a) => n + a.message.length, 0);
  const duration = Math.max(18, Math.round(totalChars * 0.22));
  const tone = items.some((a) => a.tone === 'warning') ? 'warning' : (items[0].tone || 'info');

  const run = (copy) => (
    <span className="ticker-run" aria-hidden={copy ? 'true' : undefined}>
      {items.map((a) => (
        <span key={`${copy}-${a.id}`} className={`ticker-item ${a.tone || 'info'}`}>
          {a.message}
        </span>
      ))}
    </span>
  );

  return (
    <div className={`ticker no-print ${tone}`} role="marquee" aria-label="Announcements">
      <span className="ticker-label">📢 Updates</span>
      <div className="ticker-viewport">
        {/* Two identical runs back to back make the loop seamless. */}
        <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
          {run(0)}
          {run(1)}
        </div>
      </div>
    </div>
  );
}
