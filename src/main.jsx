import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// If anything on a page breaks, show a message with a way back instead of a blank white page
class SafeBox extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('CRM error:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    const home = () => { try { sessionStorage.removeItem('sk-nav'); sessionStorage.removeItem('sk-bill-draft'); } catch { /* ignore */ } window.location.reload(); };
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: 24, background: '#fff', borderRadius: 14, boxShadow: '0 6px 24px rgba(0,0,0,.08)', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ marginTop: 0 }}>Something went wrong on this page</h2>
        <p>Your data is safe. Click <b>Go to Dashboard</b> to continue. If it keeps happening, send a screenshot of this message.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#fff4f4', color: '#a12', padding: 10, borderRadius: 8, fontSize: 13 }}>{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={home} style={{ padding: '10px 16px', borderRadius: 10, border: 0, background: '#d6335a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Go to Dashboard</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SafeBox>
      <App />
    </SafeBox>
  </React.StrictMode>
);
