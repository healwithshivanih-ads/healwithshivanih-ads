import { submitGuideAccess } from './actions'

export const metadata = {
  title: 'Thyroid Root-Cause Guide · Shivani Hari',
}

export default function ThyroidGuidePage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap');
        .guide-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 20px;
          font-family: 'Inter', Arial, sans-serif;
          font-weight: 500;
          color: #0D0D0D;
          -webkit-font-smoothing: antialiased;
        }
        .guide-card {
          background: white;
          border-radius: 8px;
          padding: 52px 48px 48px;
          max-width: 520px;
          width: 100%;
          box-shadow: 0 2px 20px rgba(43,45,66,0.08);
        }
        .guide-brand {
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #5B6580;
          margin-bottom: 28px;
        }
        .guide-brand strong { color: #2B2D42; }
        .guide-tag {
          display: inline-block;
          font-size: 8pt;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #D6A2A2;
          background: #F5EAEA;
          padding: 3px 10px;
          border-radius: 2px;
          margin-bottom: 16px;
        }
        .guide-h1 {
          font-family: 'Libre Baskerville', Georgia, serif;
          font-size: 26pt;
          font-weight: 400;
          color: #2B2D42;
          line-height: 1.15;
          letter-spacing: -0.01em;
          margin-bottom: 10px;
          margin-top: 0;
        }
        .guide-h1 em { font-style: italic; color: #D6A2A2; }
        .guide-subtitle {
          font-family: 'Libre Baskerville', Georgia, serif;
          font-style: italic;
          font-size: 11pt;
          color: #5B6580;
          line-height: 1.45;
          margin-bottom: 28px;
        }
        .guide-divider {
          width: 48px;
          height: 2px;
          background: #D6A2A2;
          margin-bottom: 24px;
          border: none;
        }
        .guide-what-inside {
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #5B6580;
          margin-bottom: 12px;
        }
        .guide-bullets {
          list-style: none;
          padding: 0;
          margin: 0 0 32px 0;
        }
        .guide-bullets li {
          font-size: 10pt;
          line-height: 1.6;
          color: #0D0D0D;
          padding: 6px 0;
          border-bottom: 1px solid rgba(43,45,66,0.07);
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .guide-bullets li:last-child { border-bottom: none; }
        .guide-dot {
          color: #D6A2A2;
          font-weight: 700;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .guide-label {
          display: block;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #2B2D42;
          margin-bottom: 8px;
        }
        .guide-row {
          display: flex;
          gap: 10px;
        }
        .guide-input {
          flex: 1;
          height: 44px;
          padding: 0 14px;
          border: 1.5px solid rgba(43,45,66,0.2);
          border-radius: 4px;
          font-family: 'Inter', sans-serif;
          font-size: 10pt;
          font-weight: 500;
          color: #0D0D0D;
          background: #F7F4F3;
          outline: none;
          transition: border-color 0.15s;
        }
        .guide-input:focus { border-color: #2B2D42; }
        .guide-input::placeholder { color: #8D99AE; }
        .guide-btn {
          height: 44px;
          padding: 0 22px;
          background: #2B2D42;
          color: white;
          font-family: 'Inter', sans-serif;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
        }
        .guide-btn:hover { background: #1e2035; }
        .guide-privacy {
          margin-top: 12px;
          font-size: 8.5pt;
          color: #8D99AE;
          line-height: 1.5;
        }
        @media (max-width: 500px) {
          .guide-card { padding: 36px 24px 32px; }
          .guide-h1 { font-size: 20pt; }
          .guide-row { flex-direction: column; }
          .guide-btn { width: 100%; }
        }
      `}</style>
      <div className="guide-wrap">
        <div className="guide-card">
          <div className="guide-brand"><strong>THE OCHRE TREE</strong> · Shivani Hari</div>
          <div className="guide-tag">Free Guide</div>
          <h1 className="guide-h1">Your thyroid<br />symptoms have <em>roots.</em></h1>
          <p className="guide-subtitle">Why treating the leaves isn't enough — and where to actually look.</p>
          <hr className="guide-divider" />

          <p className="guide-what-inside">What's inside</p>
          <ul className="guide-bullets">
            <li><span className="guide-dot">→</span><span>The 4 root drivers behind persistent thyroid symptoms</span></li>
            <li><span className="guide-dot">→</span><span>Why standard TSH testing misses the picture</span></li>
            <li><span className="guide-dot">→</span><span>Key nutrient depletions most doctors don't check</span></li>
            <li><span className="guide-dot">→</span><span>3 things you can do this week to start addressing the root</span></li>
          </ul>

          <form action={submitGuideAccess}>
            <input type="hidden" name="source" value="thyroid-guide-gate" />
            <label className="guide-label" htmlFor="email">Send the guide to</label>
            <div className="guide-row">
              <input
                className="guide-input"
                type="email"
                id="email"
                name="email"
                placeholder="your@email.com"
                required
                autoFocus
              />
              <button className="guide-btn" type="submit">Get the guide →</button>
            </div>
          </form>
          <p className="guide-privacy">No spam. Unsubscribe any time. Your email stays with Shivani.</p>
        </div>
      </div>
    </>
  )
}
