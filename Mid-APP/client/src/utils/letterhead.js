// Gap left between a full-page letterhead's header/footer design and the report.
const HEADER_GAP_MM = 12; // about two lines of space under the header
const FOOTER_GAP_MM = 3;

/** Used when the letterhead can't be analysed (e.g. the image can't be read). */
export const DEFAULT_LETTERHEAD_TOP_MM = 45;
export const DEFAULT_LETTERHEAD_BOTTOM_MM = 25;

const cache = new Map();

/**
 * Looks at an uploaded letterhead image and works out:
 *  - isPage: whether it's a whole A4 page (portrait) rather than a header strip
 *  - topMm / bottomMm: the space its printed header and footer take, so the
 *    report starts just below the header and stops just above the footer.
 * Faint artwork (watermarks) and the outer side edges (coloured stripes) are
 * ignored - only clearly printed rows near the top/bottom count.
 * Resolves to null if the image can't be loaded.
 */
export function analyzeLetterhead(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const isPage = img.naturalHeight / img.naturalWidth >= 1;
        if (!isPage) return resolve({ isPage, topMm: null, bottomMm: null });
        try {
          const w = 300;
          const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const { data } = ctx.getImageData(0, 0, w, h);
          const x0 = Math.round(w * 0.08);
          const x1 = Math.round(w * 0.92);
          // A row belongs to the header/footer design if it has clearly dark
          // printing (text, logos), or if it's tinted across most of its width -
          // a solid pale colour band with no dark text in it (e.g. a light green
          // footer strip). A faint watermark tints only part of a row, so it's ignored.
          const hasInk = (y) => {
            let dark = 0;
            let tint = 0;
            for (let x = x0; x < x1; x += 1) {
              const i = (y * w + x) * 4;
              if (data[i + 3] <= 128) continue;
              const min = Math.min(data[i], data[i + 1], data[i + 2]);
              if (min < 200) dark += 1;
              if (min < 245) tint += 1;
            }
            const span = x1 - x0;
            return dark > span * 0.01 || tint > span * 0.6;
          };
          let headerEnd = -1;
          for (let y = 0; y < h * 0.35; y += 1) if (hasInk(y)) headerEnd = y;
          let footerStart = h;
          for (let y = h - 1; y > h * 0.65; y -= 1) if (hasInk(y)) footerStart = y;
          const mm = (px) => (px / h) * 297;
          resolve({
            isPage,
            topMm: Math.round((headerEnd < 0 ? 0 : mm(headerEnd + 1)) + HEADER_GAP_MM),
            bottomMm: Math.round((footerStart >= h ? 0 : 297 - mm(footerStart)) + FOOTER_GAP_MM),
          });
        } catch {
          // Image from another origin can't be read back - fall back to the defaults.
          resolve({ isPage, topMm: null, bottomMm: null });
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return cache.get(url);
}
